"use client";

import { useEffect, useState } from "react";

import Modal from "@/components/ui/Modal";

import {
	download,
	listArchive,
	listDownloaded,
	type ArchiveSession,
	type DownloadedSession,
} from "@/lib/replay/replaySession";

const FIRST_ARCHIVE_YEAR = 2018;

type Props = {
	open: boolean;
	onClose: () => void;
	onPick: (name: string) => void;
};

// F1's archive dates are the circuit's local time with no zone, so only the calendar day is shown.
const dayText = (start: string | null) =>
	start
		? new Date(`${start.slice(0, 10)}T12:00:00`).toLocaleDateString(undefined, {
				weekday: "short",
				day: "numeric",
				month: "short",
			})
		: "";

// The archive's sessions, newest meeting first, sessions in running order within each.
const byMeetingNewestFirst = (sessions: ArchiveSession[]): [string, ArchiveSession[]][] => {
	const meetings: [string, ArchiveSession[]][] = [];
	for (const session of sessions) {
		const last = meetings[meetings.length - 1];
		if (last?.[0] === session.meeting) last[1].push(session);
		else meetings.push([session.meeting, [session]]);
	}
	return meetings.reverse();
};

const rowClass = "flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm";
const actionClass = "shrink-0 rounded-md bg-zinc-800 px-2 py-1 text-xs font-medium hover:bg-zinc-700 disabled:opacity-40";

export default function ReplayPicker({ open, onClose, onPick }: Props) {
	const thisYear = new Date().getFullYear();

	const [year, setYear] = useState(thisYear);
	const [downloaded, setDownloaded] = useState<DownloadedSession[]>([]);
	const [archive, setArchive] = useState<ArchiveSession[] | null>(null);
	const [downloading, setDownloading] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	// Each list is fetched when the picker opens (and the archive again on a year change); the
	// stale-list and error resets happen in the handlers that open, close and re-year it.
	useEffect(() => {
		if (!open) return;
		listDownloaded()
			.then(setDownloaded)
			.catch((failure: Error) => setError(failure.message));
	}, [open]);

	useEffect(() => {
		if (!open) return;
		listArchive(year)
			.then(setArchive)
			.catch((failure: Error) => setError(failure.message));
	}, [open, year]);

	const close = () => {
		setArchive(null);
		setError(null);
		onClose();
	};

	const changeYear = (next: number) => {
		setArchive(null);
		setError(null);
		setYear(next);
	};

	const pick = (name: string) => {
		onPick(name);
		close();
	};

	const downloadAndPlay = async (session: ArchiveSession) => {
		setDownloading(session.path);
		setError(null);
		try {
			pick(await download(year, session.path));
		} catch (failure) {
			setError((failure as Error).message);
		} finally {
			setDownloading(null);
		}
	};

	return (
		<Modal open={open}>
			<div className="flex w-[min(90vw,36rem)] flex-col gap-3 text-left">
				<div className="flex items-center justify-between">
					<h2 id="modal-title" className="text-lg font-semibold">
						Replay a session
					</h2>
					<button onClick={close} className={actionClass}>
						Close
					</button>
				</div>

				{error && <p className="rounded-lg bg-red-950 px-3 py-2 text-sm text-red-300">{error}</p>}

				<div className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto">
					<section>
						<h3 className="mb-1 text-xs font-semibold tracking-wide text-zinc-500 uppercase">Downloaded</h3>
						{downloaded.length === 0 && <p className="px-3 text-sm text-zinc-500">Nothing yet.</p>}
						{downloaded.map((session) => (
							<button
								key={`replay.downloaded.${session.name}`}
								onClick={() => pick(session.name)}
								className={`${rowClass} hover:bg-zinc-800`}
							>
								<span>
									{session.meeting} · <span className="font-medium">{session.session}</span>
								</span>
								<span className="text-zinc-500">{dayText(session.start)}</span>
							</button>
						))}
					</section>

					<section>
						<div className="mb-1 flex items-center justify-between">
							<h3 className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">
								From F1&apos;s archive
							</h3>
							<select
								value={year}
								onChange={(event) => changeYear(Number(event.target.value))}
								className="rounded-md bg-zinc-800 px-2 py-1 text-sm"
							>
								{Array.from({ length: thisYear - FIRST_ARCHIVE_YEAR + 1 }, (_, i) => thisYear - i).map(
									(option) => (
										<option key={`replay.year.${option}`} value={option}>
											{option}
										</option>
									),
								)}
							</select>
						</div>

						{archive === null && !error && <p className="px-3 text-sm text-zinc-500">Loading…</p>}

						{archive &&
							byMeetingNewestFirst(archive).map(([meeting, sessions]) => (
								<div key={`replay.meeting.${meeting}`} className="mb-2">
									<p className="px-3 pt-1 text-sm font-medium text-zinc-300">{meeting}</p>
									{sessions.map((session) => (
										<div key={`replay.archive.${session.path}`} className={rowClass}>
											<span className="text-zinc-400">
												{session.session} <span className="text-zinc-600">{dayText(session.start)}</span>
											</span>
											{session.downloaded ? (
												<button onClick={() => pick(session.downloaded!)} className={actionClass}>
													Play
												</button>
											) : (
												<button
													onClick={() => downloadAndPlay(session)}
													disabled={downloading !== null}
													className={actionClass}
												>
													{downloading === session.path ? "Downloading…" : "Download & play"}
												</button>
											)}
										</div>
									))}
								</div>
							))}
					</section>
				</div>
			</div>
		</Modal>
	);
}
