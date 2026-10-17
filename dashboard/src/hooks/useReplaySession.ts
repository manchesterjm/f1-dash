import { useRef, useState } from "react";

import { loadReplay, type ReplaySession } from "@/lib/replay/replaySession";

export type FeedSource =
	| { mode: "live" }
	| { mode: "replay"; name: string; session: ReplaySession | null; error: string | null };

// The dashboard opens on the live feed. The Replay button switches it to a recording and its Live button
// switches it back - in place, no reload. `clearDashboard` empties what the previous source left behind.
export const useReplaySession = (clearDashboard: () => void) => {
	const [source, setSource] = useState<FeedSource>({ mode: "live" });

	// Only the newest request may land - picking another session while one loads abandons the first.
	const requestRef = useRef(0);

	const startReplay = async (name: string) => {
		const request = ++requestRef.current;
		clearDashboard();
		setSource({ mode: "replay", name, session: null, error: null });
		try {
			const session = await loadReplay(name);
			if (request === requestRef.current) setSource({ mode: "replay", name, session, error: null });
		} catch (error) {
			if (request === requestRef.current)
				setSource({ mode: "replay", name, session: null, error: (error as Error).message });
		}
	};

	const goLive = () => {
		requestRef.current++;
		clearDashboard();
		setSource({ mode: "live" });
	};

	return { source, startReplay, goLive };
};
