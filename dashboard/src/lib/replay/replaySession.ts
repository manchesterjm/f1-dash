// Past sessions served by f1_replay.py's session library (see /mnt/win-d/Projects/f1-dash_replay),
// which the F1 Dash launcher runs beside the stack. The Replay button picks, downloads and loads them.

export const REPLAY_SERVER_URL = "http://localhost:8765";

// [offset in seconds since the recording began, topic, payload]
export type RecordedUpdate = [number, string, unknown];

export type ReplaySummary = {
	name: string;
	recordingStartUtc: string;
	duration: number;
	runningSpans: [number, number][];
};

export type ReplaySession = ReplaySummary & {
	snapshots: Record<string, unknown>;
	updates: RecordedUpdate[];
};

// A session in the sessions folder, or one F1's archive holds (with its folder name once downloaded).
export type DownloadedSession = { name: string; meeting: string; session: string; start: string | null };
export type ArchiveSession = { meeting: string; session: string; start: string | null; path: string; downloaded: string | null };

const askLibrary = async <T>(path: string, init?: RequestInit): Promise<T> => {
	let res: Response;
	try {
		res = await fetch(`${REPLAY_SERVER_URL}${path}`, init);
	} catch {
		throw new Error("The replay library is not running. Close F1 Dash with its desktop icon and open it again.");
	}
	if (!res.ok) throw new Error((await res.text()) || `The replay library answered ${res.status}`);
	return (await res.json()) as T;
};

export const listDownloaded = () => askLibrary<DownloadedSession[]>("/sessions");

export const listArchive = (year: number) => askLibrary<ArchiveSession[]>(`/archive?year=${year}`);

// Downloads one archive session into the sessions folder and answers its folder name.
export const download = async (year: number, path: string) =>
	(await askLibrary<{ name: string }>(`/download?year=${year}&path=${encodeURIComponent(path)}`, { method: "POST" })).name;

export const loadReplay = (name: string) => askLibrary<ReplaySession>(`/session?name=${encodeURIComponent(name)}`);

// "Q1"/"Q2"/"Q3" for qualifying (SQ for sprint qualifying), otherwise "Part n" when the session stopped and restarted.
export const runningSpanLabel = (session: ReplaySession, index: number): string => {
	const info = session.snapshots.SessionInfo as { Name?: string; Type?: string } | undefined;
	const qualifying = info?.Type === "Qualifying";
	if (qualifying) return `${info?.Name?.includes("Sprint") ? "SQ" : "Q"}${index + 1}`;
	return session.runningSpans.length > 1 ? `Part ${index + 1}` : (info?.Name ?? "Session");
};
