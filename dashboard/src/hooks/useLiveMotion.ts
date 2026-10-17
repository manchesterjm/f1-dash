import { useEffect, useRef } from "react";

import { CarMotion } from "@/lib/replay/carMotion";
import { useCarMotionStore } from "@/stores/useCarMotionStore";
import { useSettingsStore } from "@/stores/useSettingsStore";

// How far behind the newest reading the live map draws. Each moment needs the 16 readings after it
// (half the 32-reading timing fit) plus the blend; in a recorded qualifying session that took 5.3 s
// typically and 6.7 s at worst (99th percentile), counted from when F1 sent the readings.
const SMOOTHING_LAG_MS = 7000;

// How long the live map keeps readings for (beyond the moment it is drawing): a whole lap and then
// some, so a finished lap can still be traced as the driver's best when its official time arrives.
const KEEP_MS = 4 * 60_000;
const FORGET_EVERY_MS = 10_000;

// The feed's lateness - how long after F1 timestamps a reading it reaches this computer - is learnt
// from the last few dozen bundles. Changes are eased in at no more than 2% of real time, so the cars
// never visibly speed up or slow down; only a big change (a reconnect, a clock jump) is taken at once.
const LATENESS_SAMPLES = 60;
const LATENESS_PERCENTILE = 0.9;
const LATENESS_EASE = 0.02;
const LATENESS_SNAP_MS = 3000;

class FeedLateness {
	private samples: number[] = [];
	private target: number | null = null;
	private applied = 0;
	private easedAt = 0;

	observe(newestFeedMs: number): void {
		this.samples.push(Date.now() - newestFeedMs);
		if (this.samples.length > LATENESS_SAMPLES) this.samples.shift();
		const sorted = [...this.samples].sort((a, b) => a - b);
		this.target = sorted[Math.floor((sorted.length - 1) * LATENESS_PERCENTILE)];
	}

	// The current lateness in ms, eased towards the latest estimate.
	now(): number {
		const wallMs = Date.now();
		if (this.target === null) return this.applied;
		const gap = this.target - this.applied;
		const allowed = (wallMs - this.easedAt) * LATENESS_EASE;
		this.applied = Math.abs(gap) > LATENESS_SNAP_MS ? this.target : this.applied + Math.max(-allowed, Math.min(allowed, gap));
		this.easedAt = wallMs;
		return this.applied;
	}
}

// Smooths the live cars exactly as a replay does, a few seconds behind the feed (and never ahead of
// the live-TV delay, when one is set). Returns the function that takes each message's Position.z
// and CarData.z (the speed shown above favourite drivers), plus its TimingData (official lap times,
// pit exits and sector times, which set the lap clock in those bubbles).
export const useLiveMotion = (enabled: boolean) => {
	const liveRef = useRef<{ motion: CarMotion; lateness: FeedLateness; feedNowMs: () => number } | null>(null);
	const forgotAtRef = useRef(0);

	useEffect(() => {
		if (!enabled) return;
		const motion = new CarMotion();
		const lateness = new FeedLateness();
		const feedNowMs = () => {
			const smoothed = Date.now() - lateness.now() - SMOOTHING_LAG_MS;
			const delayed = Date.now() - useSettingsStore.getState().delay * 1000;
			return Math.min(smoothed, delayed);
		};
		liveRef.current = { motion, lateness, feedNowMs };

		const { attach, detach } = useCarMotionStore.getState();
		attach(motion, feedNowMs, false);
		return () => {
			liveRef.current = null;
			detach();
		};
	}, [enabled]);

	// `fromInitialState`: the message is the session's state at connection, whose lap times and pit
	// flags are old news - only its first sectors are read, to place laps already under way.
	return (encoded: string | undefined, carData?: string, timingData?: unknown, fromInitialState = false) => {
		const live = liveRef.current;
		if (!live) return;
		live.motion.addCarData(carData);
		// On F1's clock, where the lap times will be matched against the cars' line crossings.
		const arrivedMs = Date.now() - live.lateness.now();
		if (timingData && fromInitialState) live.motion.seedSectors(timingData, arrivedMs);
		else if (timingData) live.motion.addLapTimes(timingData, arrivedMs);
		if (!encoded) return;

		const newest = live.motion.addPositions(encoded);
		if (newest !== null) live.lateness.observe(newest);

		if (Date.now() - forgotAtRef.current >= FORGET_EVERY_MS) {
			forgotAtRef.current = Date.now();
			live.motion.forgetBefore(live.feedNowMs() - KEEP_MS);
		}
	};
};
