import { create } from "zustand";

import type { CarMotion } from "@/lib/replay/carMotion";

// The map reads each car's position straight from its smoothed path at `feedNowMs()`, every frame.
// A replay supplies the playback instant; the live feed supplies an instant a few seconds behind the
// newest reading, so the readings after it - which the smoothing needs - have already arrived.
type CarMotionStore = {
	motion: CarMotion | null;
	feedNowMs: (() => number) | null;
	replaying: boolean;

	attach: (motion: CarMotion, feedNowMs: () => number, replaying: boolean) => void;
	detach: () => void;
};

export const useCarMotionStore = create<CarMotionStore>()((set) => ({
	motion: null,
	feedNowMs: null,
	replaying: false,

	attach: (motion, feedNowMs, replaying) => {
		set({ motion, feedNowMs, replaying });
	},
	detach: () => {
		set({ motion: null, feedNowMs: null, replaying: false });
	},
}));

// True while a replay is playing. A replay is timed by its own bar, so the live-TV delay does not apply.
export const useReplayActive = () => useCarMotionStore((state) => state.replaying);
