import { useEffect, useRef, useState } from "react";

import type { FeedTimeMapper } from "@/hooks/useDataEngine";
import type { MessageInitial, MessageUpdate } from "@/types/message.type";
import type { ExtrapolatedClock } from "@/types/state.type";

import { merge } from "@/lib/merge";
import { CarMotion, DEFAULT_TIMING_WINDOW } from "@/lib/replay/carMotion";
import { PlaybackClock } from "@/lib/replay/playbackClock";
import { firstUpdateFrom, stateAt } from "@/lib/replay/stateAt";
import type { ReplaySession } from "@/lib/replay/replaySession";
import { useCarMotionStore } from "@/stores/useCarMotionStore";

const TICK_MS = 100;
const UI_REFRESH_MS = 250;
const CLOCK_REFRESH_MS = 1000;
const LEAD_IN_SECONDS = 60;

// `?fit=16` in the address bar compares another timing-fit size against the default 32 readings.
const timingWindowFromAddress = (): number => {
	const asked = Number(new URLSearchParams(window.location.search).get("fit"));
	return Number.isInteger(asked) && asked >= 4 && asked <= 128 ? asked : DEFAULT_TIMING_WINDOW;
};

// The parts of the data engine a replay drives - the same entry points the live feed uses.
export type ReplayTarget = {
	handleInitial: (data: MessageInitial) => void;
	handleUpdate: (data: MessageUpdate) => void;
	reset: () => void;
	setFeedTimeMapper: (mapper: FeedTimeMapper | null) => void;
};

type Anchor = { wallMs: number; offset: number };

const parseDuration = (hms: string) => hms.split(":").reduce((total, part) => total * 60 + parseFloat(part), 0);

const formatDuration = (seconds: number) => {
	const whole = Math.max(0, Math.round(seconds));
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${pad(Math.floor(whole / 3600))}:${pad(Math.floor((whole % 3600) / 60))}:${pad(whole % 60)}`;
};

export const useReplayPlayer = (session: ReplaySession, target: ReplayTarget) => {
	const recordingStartMs = Date.parse(session.recordingStartUtc);
	const leadIn = Math.max(0, (session.runningSpans[0]?.[0] ?? LEAD_IN_SECONDS) - LEAD_IN_SECONDS);

	const clockRef = useRef(new PlaybackClock(1));
	const anchorRef = useRef<Anchor>({ wallMs: 0, offset: leadIn });
	const playingRef = useRef(false);
	const speedRef = useRef(1);
	const nextIndexRef = useRef(0);
	const sessionClockRef = useRef<ExtrapolatedClock | null>(null);
	const lastClockSentRef = useRef(0);

	const [offset, setOffset] = useState(leadIn);
	const [playing, setPlaying] = useState(false);
	const [speed, setSpeedState] = useState(1);

	const currentOffset = (): number => {
		const { wallMs, offset } = anchorRef.current;
		if (!playingRef.current) return offset;
		const clock = clockRef.current;
		const reached = clock.offsetAt(clock.playbackSeconds(offset) + (Date.now() - wallMs) / 1000);
		return Math.min(reached, session.duration);
	};

	const reanchor = (at: number) => {
		anchorRef.current = { wallMs: Date.now(), offset: at };
		const clock = clockRef.current;
		const anchorPlayback = clock.playbackSeconds(at);
		// A recorded car/position timestamp lands on the wall-clock moment playback reaches it.
		target.setFeedTimeMapper((feedMs) => {
			const feedOffset = (feedMs - recordingStartMs) / 1000;
			return anchorRef.current.wallMs + (clock.playbackSeconds(feedOffset) - anchorPlayback) * 1000;
		});
	};

	// The session clock as the dashboard should show it right now. The dashboard counts it down
	// in real time between refreshes, so it is re-sent every second to stay right at any speed.
	const presentClock = (at: number): ExtrapolatedClock | null => {
		const recorded = sessionClockRef.current;
		if (!recorded?.Remaining) return recorded;
		const elapsed = recorded.Extrapolating ? (recordingStartMs + at * 1000 - Date.parse(recorded.Utc)) / 1000 : 0;
		return {
			Utc: new Date().toISOString(),
			Remaining: formatDuration(parseDuration(recorded.Remaining) - elapsed),
			Extrapolating: Boolean(recorded.Extrapolating) && playingRef.current && speedRef.current === 1,
		};
	};

	const sendClock = (at: number) => {
		const clock = presentClock(at);
		if (clock) target.handleUpdate({ ExtrapolatedClock: clock });
		lastClockSentRef.current = Date.now();
	};

	// Rebuild the dashboard's state as of `to` and park playback there.
	const jumpTo = (to: number): number => {
		const at = Math.max(0, Math.min(to, session.duration));
		const state = stateAt(session, at);
		sessionClockRef.current = (state.ExtrapolatedClock as ExtrapolatedClock | undefined) ?? null;
		nextIndexRef.current = firstUpdateFrom(session.updates, at);
		reanchor(at);
		target.reset();
		target.handleInitial({ ...state, ExtrapolatedClock: presentClock(at) } as MessageInitial);
		lastClockSentRef.current = Date.now();
		return at;
	};

	const seek = (to: number) => setOffset(jumpTo(to));

	const play = () => {
		const at = currentOffset() >= session.duration ? leadIn : currentOffset();
		if (at !== anchorRef.current.offset) seek(at);
		playingRef.current = true;
		reanchor(at);
		sendClock(at);
		setPlaying(true);
	};

	const pause = () => {
		const at = currentOffset();
		playingRef.current = false;
		reanchor(at);
		sendClock(at);
		setPlaying(false);
		setOffset(at);
	};

	const setSpeed = (next: number) => {
		const at = currentOffset();
		clockRef.current = new PlaybackClock(next);
		speedRef.current = next;
		reanchor(at);
		sendClock(at);
		setSpeedState(next);
	};

	const tick = () => {
		if (!playingRef.current) return;
		const at = currentOffset();
		const updates = session.updates;
		let clockChanged = false;
		while (nextIndexRef.current < updates.length && updates[nextIndexRef.current][0] <= at) {
			const [, topic, data] = updates[nextIndexRef.current++];
			if (topic === "ExtrapolatedClock") {
				sessionClockRef.current = merge(sessionClockRef.current ?? {}, data) as ExtrapolatedClock;
				clockChanged = true;
			} else {
				target.handleUpdate({ [topic]: data } as MessageUpdate);
			}
		}
		if (clockChanged || Date.now() - lastClockSentRef.current >= CLOCK_REFRESH_MS) sendClock(at);
		if (at >= session.duration) pause();
	};

	useEffect(() => {
		jumpTo(leadIn);
		const { attach, detach } = useCarMotionStore.getState();
		attach(
			CarMotion.fromSession(session, timingWindowFromAddress()),
			() => recordingStartMs + currentOffset() * 1000,
			true,
		);
		const ticker = setInterval(tick, TICK_MS);
		const ui = setInterval(() => playingRef.current && setOffset(currentOffset()), UI_REFRESH_MS);
		return () => {
			clearInterval(ticker);
			clearInterval(ui);
			target.setFeedTimeMapper(null);
			detach();
		};
		// The session is fixed for this player's lifetime; the handlers above only read refs.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [session]);

	return { offset, playing, speed, play, pause, seek, setSpeed };
};
