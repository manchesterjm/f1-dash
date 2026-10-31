"use client";

import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

import { useReplayPlayer, type ReplayTarget } from "@/hooks/useReplayPlayer";
import type { ReplayPlace } from "@/lib/replay/replayBookmark";
import { runningSpanLabel, type ReplaySession } from "@/lib/replay/replaySession";

import LiveButton from "@/components/LiveButton";

const SPEEDS = [1, 2, 4];
const KEY_STEP_SECONDS = 10;

type Props = {
	session: ReplaySession;
	target: ReplayTarget;
	resume: ReplayPlace | null;
	onPlace: (place: ReplayPlace) => void;
	onLive: () => void;
};

const clockText = (seconds: number) => {
	const whole = Math.max(0, Math.floor(seconds));
	const h = Math.floor(whole / 3600);
	const m = String(Math.floor((whole % 3600) / 60)).padStart(h ? 2 : 1, "0");
	const s = String(whole % 60).padStart(2, "0");
	return h ? `${h}:${m}:${s}` : `${m}:${s}`;
};

// Where in the session an offset falls: "Q2 4:31", or "before Q3" during a break.
const positionText = (session: ReplaySession, offset: number) => {
	const spans = session.runningSpans;
	const inside = spans.findIndex(([start, end]) => offset >= start && offset < end);
	if (inside >= 0) return `${runningSpanLabel(session, inside)} ${clockText(offset - spans[inside][0])}`;
	const next = spans.findIndex(([start]) => offset < start);
	return next >= 0 ? `before ${runningSpanLabel(session, next)}` : "finished";
};

export default function ReplayBar({ session, target, resume, onPlace, onLive }: Props) {
	const { offset, playing, speed, play, pause, seek, setSpeed } = useReplayPlayer(session, target, resume, onPlace);

	const trackRef = useRef<HTMLDivElement>(null);
	const [dragging, setDragging] = useState<number | null>(null);

	const shown = dragging ?? offset;
	const percent = (at: number) => `${(at / session.duration) * 100}%`;

	const offsetFromPointer = (event: PointerEvent<HTMLDivElement>) => {
		const box = trackRef.current!.getBoundingClientRect();
		const fraction = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width));
		return fraction * session.duration;
	};

	const startDrag = (event: PointerEvent<HTMLDivElement>) => {
		event.currentTarget.setPointerCapture(event.pointerId);
		setDragging(offsetFromPointer(event));
	};

	const drag = (event: PointerEvent<HTMLDivElement>) => {
		if (dragging !== null) setDragging(offsetFromPointer(event));
	};

	const drop = (event: PointerEvent<HTMLDivElement>) => {
		if (dragging === null) return;
		seek(offsetFromPointer(event));
		setDragging(null);
	};

	const nudge = (event: KeyboardEvent<HTMLDivElement>) => {
		const step = { ArrowLeft: -KEY_STEP_SECONDS, ArrowRight: KEY_STEP_SECONDS }[event.key];
		if (step) seek(offset + step);
		if (event.key === " ") (playing ? pause : play)();
	};

	return (
		<div className="flex w-full items-center gap-3 rounded-lg border border-zinc-800 px-3 py-2">
			<button
				onClick={playing ? pause : play}
				className="w-16 shrink-0 rounded-md bg-zinc-800 px-2 py-1 text-sm font-medium hover:bg-zinc-700"
			>
				{playing ? "Pause" : "Play"}
			</button>

			<div className="w-24 shrink-0 text-sm text-zinc-300 tabular-nums">{positionText(session, shown)}</div>

			<div
				ref={trackRef}
				role="slider"
				tabIndex={0}
				aria-label="Replay position"
				aria-valuemin={0}
				aria-valuemax={session.duration}
				aria-valuenow={Math.round(shown)}
				onPointerDown={startDrag}
				onPointerMove={drag}
				onPointerUp={drop}
				onKeyDown={nudge}
				className="relative h-6 flex-1 cursor-pointer touch-none outline-none"
			>
				<div className="absolute top-1/2 h-1.5 w-full -translate-y-1/2 rounded-full bg-zinc-800" />

				{session.runningSpans.map(([start, end], index) => (
					<div
						key={`replay.span.${index}`}
						className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-zinc-500"
						style={{ left: percent(start), width: `calc(${percent(end)} - ${percent(start)})` }}
					>
						<span className="absolute -top-4 left-0 text-[10px] leading-none text-zinc-400">
							{runningSpanLabel(session, index)}
						</span>
					</div>
				))}

				<div
					className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-red-600/70"
					style={{ width: percent(shown) }}
				/>

				<div
					className="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-red-600 shadow"
					style={{ left: percent(shown) }}
				/>
			</div>

			<div className="flex shrink-0 gap-1">
				{SPEEDS.map((option) => (
					<button
						key={`replay.speed.${option}`}
						onClick={() => setSpeed(option)}
						className={`rounded-md px-2 py-1 text-xs ${option === speed ? "bg-zinc-600 text-white" : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"}`}
					>
						{option}×
					</button>
				))}
			</div>

			<LiveButton onClick={onLive} />
		</div>
	);
}
