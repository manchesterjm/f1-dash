// Where Josh is in a replay, kept for this tab only. Anything that reloads the page - a dashboard update
// landing mid-replay turns the next page click into a full reload, F5 does it outright - would otherwise
// open on the live feed and lose his place (2026-10-24, Josh: "I clicked on the track map and it stopped
// doing the replay"). A new tab still opens on live.

export type ReplayPlace = { offset: number; playing: boolean };
export type ReplayBookmark = ReplayPlace & { name: string };

const KEY = "f1-dash.replay-bookmark";

export const readBookmark = (): ReplayBookmark | null => {
	try {
		const saved = JSON.parse(sessionStorage.getItem(KEY) ?? "null") as Partial<ReplayBookmark> | null;
		if (typeof saved?.name !== "string" || typeof saved.offset !== "number" || !Number.isFinite(saved.offset))
			return null;
		return { name: saved.name, offset: saved.offset, playing: saved.playing === true };
	} catch {
		return null;
	}
};

// Just the replay's name: a string, so React can compare it between renders (useSyncExternalStore).
export const bookmarkedName = (): string | null => readBookmark()?.name ?? null;

export const saveBookmark = (bookmark: ReplayBookmark) => {
	try {
		sessionStorage.setItem(KEY, JSON.stringify(bookmark));
	} catch {
		// Storage blocked (private window, site data off): the replay still plays, it just won't survive a reload.
	}
};

export const clearBookmark = () => {
	try {
		sessionStorage.removeItem(KEY);
	} catch {
		// Nothing was saved if storage is blocked, so there is nothing to clear.
	}
};
