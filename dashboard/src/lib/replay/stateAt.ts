import { merge } from "@/lib/merge";

import type { RecordedUpdate, ReplaySession } from "@/lib/replay/replaySession";

// Compressed topics carry a complete frame each time, so only the latest one counts.
const isCompressed = (topic: string) => topic.endsWith(".z");

// The feed as it stood at `offset`: every topic's opening snapshot with all earlier updates folded in.
export const stateAt = (session: ReplaySession, offset: number): Record<string, unknown> => {
	const state: Record<string, unknown> = structuredClone(session.snapshots);
	const updates = session.updates;
	for (let i = 0; i < updates.length && updates[i][0] < offset; i++) {
		const [, topic, data] = updates[i];
		state[topic] = isCompressed(topic) ? data : merge(state[topic] ?? null, data);
	}
	return state;
};

// Index of the first update at or after `offset`.
export const firstUpdateFrom = (updates: RecordedUpdate[], offset: number): number => {
	let low = 0;
	let high = updates.length;
	while (low < high) {
		const mid = (low + high) >> 1;
		if (updates[mid][0] < offset) low = mid + 1;
		else high = mid;
	}
	return low;
};
