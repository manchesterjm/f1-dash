import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import {
	bookmarkedName,
	clearBookmark,
	readBookmark,
	saveBookmark,
	type ReplayPlace,
} from "@/lib/replay/replayBookmark";
import { loadReplay, type ReplaySession } from "@/lib/replay/replaySession";

type Replay = {
	mode: "replay";
	name: string;
	session: ReplaySession | null;
	error: string | null;
	resume: ReplayPlace | null;
};

export type FeedSource = { mode: "starting" } | { mode: "live" } | Replay;

const STARTING: FeedSource = { mode: "starting" };
const LIVE: FeedSource = { mode: "live" };

// Only this tab writes the bookmark, so there is nothing to listen for.
const noOutsideChanges = () => () => {};

// The dashboard opens on the live feed. The Replay button switches it to a recording and its Live button
// switches it back - in place, no reload. `clearDashboard` empties what the previous source left behind.
// A page that loads in the middle of a replay picks it back up where it was (see replayBookmark), and it
// decides that before the live feed connects, so live never flashes up first.
export const useReplaySession = (clearDashboard: () => void) => {
	// undefined on the server and while the page hydrates: the tab's storage isn't readable yet.
	const savedName = useSyncExternalStore(noOutsideChanges, bookmarkedName, () => undefined);
	// What Josh picked since this page opened; until he picks, the bookmark decides.
	const [chosen, setChosen] = useState<FeedSource | null>(null);
	const [resumed, setResumed] = useState<Replay | null>(null);

	// Only the newest request may land - picking another session while one loads abandons the first.
	const requestRef = useRef(0);

	const startReplay = async (name: string) => {
		const request = ++requestRef.current;
		clearDashboard();
		setChosen({ mode: "replay", name, session: null, error: null, resume: null });
		try {
			const session = await loadReplay(name);
			if (request === requestRef.current) setChosen({ mode: "replay", name, session, error: null, resume: null });
		} catch (error) {
			if (request === requestRef.current)
				setChosen({ mode: "replay", name, session: null, error: (error as Error).message, resume: null });
		}
	};

	const goLive = () => {
		requestRef.current++;
		clearBookmark();
		clearDashboard();
		setChosen(LIVE);
	};

	// The player reports where it is; the tab keeps it for the next page load.
	const keepPlace = (name: string, place: ReplayPlace) => saveBookmark({ name, ...place });

	useEffect(() => {
		if (chosen || !savedName) return;
		const request = ++requestRef.current;
		const landed = (outcome: Pick<Replay, "session" | "error">) => {
			if (request !== requestRef.current) return;
			const place = readBookmark();
			setResumed({
				mode: "replay",
				name: savedName,
				resume: place && { offset: place.offset, playing: place.playing },
				...outcome,
			});
		};
		loadReplay(savedName).then(
			(session) => landed({ session, error: null }),
			(error: Error) => landed({ session: null, error: error.message }),
		);
	}, [chosen, savedName]);

	const fromBookmark = (): FeedSource => {
		if (savedName === undefined) return STARTING;
		if (savedName === null) return LIVE;
		if (resumed?.name === savedName) return resumed;
		return { mode: "replay", name: savedName, session: null, error: null, resume: null };
	};

	return { source: chosen ?? fromBookmark(), startReplay, goLive, keepPlace };
};
