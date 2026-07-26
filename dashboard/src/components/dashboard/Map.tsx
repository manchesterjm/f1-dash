import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";

import type { PositionCar, TimingDataDriver } from "@/types/state.type";
import type { Map, TrackPosition } from "@/types/map.type";

import { fetchMap } from "@/lib/fetchMap";

import { useDataStore } from "@/stores/useDataStore";
import { useSettingsStore } from "@/stores/useSettingsStore";
import { getTrackStatusMessage } from "@/lib/getTrackStatusMessage";
import {
	createSectors,
	findYellowSectors,
	getSectorColor,
	type MapSector,
	prioritizeColoredSectors,
	rad,
	rotate,
} from "@/lib/map";

// This is basically fearlessly copied from
// https://github.com/tdjsnelling/monaco

const SPACE = 1000;
const ROTATION_FIX = 90;

// Function to calculate a driver's fractional index along the track points based on their segment progress
function getDriverTrackIndex(
	timingDriver: TimingDataDriver | undefined,
	originalTrackPoints: { x: number; y: number }[] | null,
): number | null {
	if (!timingDriver || !originalTrackPoints || originalTrackPoints.length === 0) {
		return null;
	}

	// Get all segments from all sectors
	const allSegments = timingDriver.Sectors.flatMap((sector) => sector.Segments);

	if (allSegments.length === 0) {
		// No segments available, position at start/finish line
		return 0;
	}

	// Find the furthest segment with a meaningful status
	// Status values: 0 = not started, 1 = in progress, 2+ = completed
	let furthestSegmentIndex = -1;
	for (let i = allSegments.length - 1; i >= 0; i--) {
		const status = allSegments[i].Status;
		if (status !== undefined && status > 0) {
			furthestSegmentIndex = i;
			break;
		}
	}

	// No completed segment: either the very start of a session, or the just-crossed-the-line reset
	// (a new lap zeroes every segment). Report "unknown" rather than snapping the car to the start
	// line — the playback buffer keeps the dot moving until the new lap's first checkpoint lands.
	if (furthestSegmentIndex === -1) {
		return null;
	}

	// Each mini-sector spans an equal 1/N of the lap, so segment i starts at i/N — not i/(N-1), which
	// stretches the field over the lap and places a car progressively later within its own segment as
	// the lap runs on (exact at the start, a full segment late by the last one). Checked against
	// gap-derived separations on a live race: i/N cut the pairwise RMS error from 227 m to 197 m,
	// i.e. down to the ~199 m mini-sector quantisation floor itself.
	//
	// There is no sub-segment information to add. The feed only ever reports Status 0, 2048, 2049 or
	// 2064, so the upstream `=== 1` "in progress" test could never fire. Nor does the feed settle
	// whether a lit segment means the car entered it or completed it, so the car is placed at the
	// segment MIDPOINT: at most half a segment out under either reading, where committing to a
	// boundary would be a full segment out under one of them.
	const segmentCount = Math.max(allSegments.length, 1);
	const adjustedRatio = (furthestSegmentIndex + 0.5) / segmentCount;

	const positionIndex = adjustedRatio * (originalTrackPoints.length - 1);

	// Ensure we don't go out of bounds
	return Math.min(Math.max(positionIndex, 0), originalTrackPoints.length - 1);
}

// Gap-based along-track refinement.
//
// A mini-sector crossing fixes a car's position only about once every 200 m, so cars a few tenths
// apart get drawn either stacked on the same segment boundary or a whole segment apart — neither is
// true, and relative spacing is what a track map is actually read for. Gaps are reported in
// thousandths of a second, which places a car along the track far more finely: at Hungaroring pace
// a 0.7 s gap is ~36 m, well inside one segment.
//
// This is only ever a REFINEMENT. If the gap-derived point disagrees with the car's own segment
// progress by more than a segment or so, segment progress wins — that keeps pit stops, lapped cars
// and safety-car periods, where a time gap no longer maps to track distance, from teleporting a dot.
const GAP_REFINEMENT_SEGMENT_TOLERANCE = 1.5;

// Feed lap times look like "1:24.536"; anything unparseable means we cannot convert seconds to
// track distance, and the caller falls back to segment progress.
function lapTimeSeconds(value: string | undefined): number | null {
	if (!value) return null;

	const parts = value.split(":");
	const seconds =
		parts.length === 2 ? parseInt(parts[0], 10) * 60 + parseFloat(parts[1]) : parseFloat(parts[0]);

	return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}

// Gaps look like "+1.234". Lap-based ("1 L"), blank and "LAP n" values carry no distance meaning.
function gapSeconds(value: string | undefined): number | null {
	if (!value || !/^\+?\d+(\.\d+)?$/.test(value.trim())) return null;

	const seconds = parseFloat(value.replace("+", ""));
	return Number.isFinite(seconds) ? seconds : null;
}

// The leader anchors the field: everyone else is placed at the leader's position minus their gap.
type GapReference = {
	leaderIndex: number;
	indexPerSecond: number;
};

function buildGapReference(
	timingLines: Record<string, TimingDataDriver> | undefined,
	trackPoints: { x: number; y: number }[] | null,
): GapReference | null {
	if (!timingLines || !trackPoints) return null;

	const leader = Object.values(timingLines).find((line) => line.Position === "1");
	if (!leader) return null;

	const leaderIndex = getDriverTrackIndex(leader, trackPoints);
	if (leaderIndex === null) return null;

	const lapSeconds = lapTimeSeconds(leader.LastLapTime?.Value);
	if (lapSeconds === null) return null;

	return { leaderIndex, indexPerSecond: trackPoints.length / lapSeconds };
}

function refineTrackIndexByGap(
	segmentIndex: number,
	timingDriver: TimingDataDriver,
	reference: GapReference | null,
	trackLength: number,
): number {
	// The leader is the anchor, and a car in the pit lane is not on the track at all.
	if (!reference || timingDriver.Position === "1" || timingDriver.InPit || timingDriver.PitOut) {
		return segmentIndex;
	}

	const gap = gapSeconds(timingDriver.GapToLeader);
	if (gap === null) return segmentIndex;

	// A gap of a whole lap or more has no single track position — it wraps, and the wrapped answer is
	// meaningless. This is not hypothetical: under the safety car on lap 57 of the 2026 Hungarian GP the
	// leader's lap stretched to 1:32 while cars still showing numeric gaps sat at +106 s to +111 s.
	const gapIndexOffset = gap * reference.indexPerSecond;
	if (gapIndexOffset >= trackLength) return segmentIndex;

	const rawIndex = reference.leaderIndex - gapIndexOffset;
	const gapIndex = ((rawIndex % trackLength) + trackLength) % trackLength;

	const segmentCount = timingDriver.Sectors.reduce((count, sector) => count + sector.Segments.length, 0);
	const tolerance = (trackLength / Math.max(segmentCount, 1)) * GAP_REFINEMENT_SEGMENT_TOLERANCE;

	return Math.abs(signedTrackDelta(segmentIndex, gapIndex, trackLength)) <= tolerance ? gapIndex : segmentIndex;
}

// Smallest signed distance from one track index to another, treating the lap as a loop.
// Positive = forward along the racing direction; small negative values allow estimate corrections.
function signedTrackDelta(from: number, to: number, trackLength: number): number {
	const raw = (((to - from) % trackLength) + trackLength) % trackLength;
	return raw <= trackLength / 2 ? raw : raw - trackLength;
}

// Point on the track polyline at a fractional index, interpolated between neighbouring points.
function pointAtTrackIndex(index: number, trackPoints: { x: number; y: number }[]): PositionCar {
	const wrapped = (((index % trackPoints.length) + trackPoints.length) % trackPoints.length);
	const lower = Math.floor(wrapped);
	const upper = (lower + 1) % trackPoints.length;
	const alpha = wrapped - lower;

	const a = trackPoints[lower];
	const b = trackPoints[upper];

	return {
		Status: "OnTrack",
		X: a.x + (b.x - a.x) * alpha,
		Y: a.y + (b.y - a.y) * alpha,
		Z: 0,
	};
}

// Along-track playback: segment-progress checkpoints are buffered with timestamps and replayed
// PLAYBACK_LAG_MS behind now, moving dots between checkpoints at their true measured pace.
const PLAYBACK_LAG_MS = 4000;
const MAX_EXTRAPOLATION_MS = 6000;
const SAMPLE_RETENTION_MS = 30000;

type TrackSample = { time: number; cumulativeIndex: number };

function pace(from: TrackSample, to: TrackSample): number {
	return (to.cumulativeIndex - from.cumulativeIndex) / Math.max(to.time - from.time, 1);
}

// Monotonicity-preserving (Fritsch-Butland) pace at a checkpoint, from its neighbouring secants.
// Keeps the interpolated motion free of overshoot and backwards wiggle.
function monotonePace(
	previous: TrackSample | undefined,
	current: TrackSample,
	next: TrackSample | undefined,
): number {
	if (!previous) return next ? pace(current, next) : 0;
	if (!next) return pace(previous, current);

	const paceIn = pace(previous, current);
	const paceOut = pace(current, next);
	if (paceIn * paceOut <= 0) return 0;

	const spanIn = current.time - previous.time;
	const spanOut = next.time - current.time;
	const weightIn = 2 * spanOut + spanIn;
	const weightOut = spanOut + 2 * spanIn;

	return (weightIn + weightOut) / (weightIn / paceIn + weightOut / paceOut);
}

// Cumulative (lap-unwrapped) track index at a moment in time: monotone cubic through the buffered
// checkpoints (pace varies smoothly instead of stepping at each checkpoint); briefly extrapolates
// at the recent pace when playback catches up to the newest one.
function indexAtTime(samples: TrackSample[], time: number): number {
	if (time <= samples[0].time) return samples[0].cumulativeIndex;

	for (let i = samples.length - 1; i >= 0; i--) {
		if (samples[i].time > time) continue;

		const current = samples[i];
		const next = samples[i + 1];

		if (next) {
			const span = next.time - current.time;
			if (span <= 0) return next.cumulativeIndex;

			const paceAtCurrent = monotonePace(samples[i - 1], current, next);
			const paceAtNext = monotonePace(current, next, samples[i + 2]);

			const s = (time - current.time) / span;
			const s2 = s * s;
			const s3 = s2 * s;

			return (
				current.cumulativeIndex * (2 * s3 - 3 * s2 + 1) +
				span * paceAtCurrent * (s3 - 2 * s2 + s) +
				next.cumulativeIndex * (-2 * s3 + 3 * s2) +
				span * paceAtNext * (s3 - s2)
			);
		}

		const previous = samples[i - 1];
		if (!previous) return current.cumulativeIndex;

		const recentPace = pace(previous, current);
		const extrapolatedMs = Math.min(time - current.time, MAX_EXTRAPOLATION_MS);
		return current.cumulativeIndex + Math.max(recentPace, 0) * extrapolatedMs;
	}

	return samples[0].cumulativeIndex;
}

type Corner = {
	number: number;
	pos: TrackPosition;
	labelPos: TrackPosition;
};

type Props = {
	filter?: string[];
};

export default function Map({ filter }: Props) {
	const showCornerNumbers = useSettingsStore((state) => state.showCornerNumbers);
	const favoriteDrivers = useSettingsStore((state) => state.favoriteDrivers);

	// const positions = useDataStore((state) => state.positions);
	const drivers = useDataStore((state) => state?.state?.DriverList);
	const trackStatus = useDataStore((state) => state?.state?.TrackStatus);
	const timingDrivers = useDataStore((state) => state?.state?.TimingData);
	const raceControlMessages = useDataStore((state) => state?.state?.RaceControlMessages?.Messages ?? undefined);
	const circuitKey = useDataStore((state) => state?.state?.SessionInfo?.Meeting.Circuit.Key);

	const [[minX, minY, widthX, widthY], setBounds] = useState<(null | number)[]>([null, null, null, null]);
	const [[centerX, centerY], setCenter] = useState<(null | number)[]>([null, null]);

	const [points, setPoints] = useState<null | { x: number; y: number }[]>(null);
	const [sectors, setSectors] = useState<MapSector[]>([]);
	const [corners, setCorners] = useState<Corner[]>([]);
	const [rotation, setRotation] = useState<number>(0);
	const [finishLine, setFinishLine] = useState<null | { x: number; y: number; startAngle: number }>(null);
	const [originalTrackPoints, setOriginalTrackPoints] = useState<null | { x: number; y: number }[]>(null);

	// Along-track dot playback: checkpoint samples per driver, rendered PLAYBACK_LAG_MS behind now
	const trackSamplesRef = useRef<Record<string, TrackSample[]>>({});
	// Forward-only guard: a data correction may pause a dot, but never drag it backwards
	const renderedIndexRef = useRef<Record<string, number>>({});
	const [, setAnimationFrame] = useState<number>(0);

	useEffect(() => {
		if (!originalTrackPoints) return;

		let rafId: number;

		const step = () => {
			setAnimationFrame((frame) => frame + 1);
			rafId = requestAnimationFrame(step);
		};

		rafId = requestAnimationFrame(step);
		return () => cancelAnimationFrame(rafId);
	}, [originalTrackPoints]);

	const recordTrackSample = (racingNumber: string, targetIndex: number, trackLength: number): TrackSample[] => {
		const now = performance.now();
		const samples = trackSamplesRef.current[racingNumber] ?? [{ time: now, cumulativeIndex: targetIndex }];
		trackSamplesRef.current[racingNumber] = samples;

		const newest = samples[samples.length - 1];
		const newestWrapped = ((newest.cumulativeIndex % trackLength) + trackLength) % trackLength;
		const delta = signedTrackDelta(newestWrapped, targetIndex, trackLength);

		if (Math.abs(delta) > 1e-6) {
			samples.push({ time: now, cumulativeIndex: newest.cumulativeIndex + delta });

			while (samples.length > 2 && samples[0].time < now - SAMPLE_RETENTION_MS) {
				samples.shift();
			}
		}

		return samples;
	};

	useEffect(() => {
		(async () => {
			if (!circuitKey) return;
			const mapJson = await fetchMap(circuitKey);

			if (!mapJson) return;

			const centerX = (Math.max(...mapJson.x) - Math.min(...mapJson.x)) / 2;
			const centerY = (Math.max(...mapJson.y) - Math.min(...mapJson.y)) / 2;

			const fixedRotation = mapJson.rotation + ROTATION_FIX;

			const sectors = createSectors(mapJson).map((s) => ({
				...s,
				start: rotate(s.start.x, s.start.y, fixedRotation, centerX, centerY),
				end: rotate(s.end.x, s.end.y, fixedRotation, centerX, centerY),
				points: s.points.map((p) => rotate(p.x, p.y, fixedRotation, centerX, centerY)),
			}));

			const cornerPositions: Corner[] = mapJson.corners.map((corner) => ({
				number: corner.number,
				pos: rotate(corner.trackPosition.x, corner.trackPosition.y, fixedRotation, centerX, centerY),
				labelPos: rotate(
					corner.trackPosition.x + 540 * Math.cos(rad(corner.angle)),
					corner.trackPosition.y + 540 * Math.sin(rad(corner.angle)),
					fixedRotation,
					centerX,
					centerY,
				),
			}));

			const rotatedPoints = mapJson.x.map((x, index) => rotate(x, mapJson.y[index], fixedRotation, centerX, centerY));

			const pointsX = rotatedPoints.map((item) => item.x);
			const pointsY = rotatedPoints.map((item) => item.y);

			const cMinX = Math.min(...pointsX) - SPACE;
			const cMinY = Math.min(...pointsY) - SPACE;
			const cWidthX = Math.max(...pointsX) - cMinX + SPACE * 2;
			const cWidthY = Math.max(...pointsY) - cMinY + SPACE * 2;

			const rotatedFinishLine = rotate(mapJson.x[0], mapJson.y[0], fixedRotation, centerX, centerY);

			const dx = rotatedPoints[3].x - rotatedPoints[0].x;
			const dy = rotatedPoints[3].y - rotatedPoints[0].y;
			const startAngle = Math.atan2(dy, dx) * (180 / Math.PI);

			// Store original track points for position calculation
			const originalPoints = mapJson.x.map((x, index) => ({ x, y: mapJson.y[index] }));

			setCenter([centerX, centerY]);
			setBounds([cMinX, cMinY, cWidthX, cWidthY]);
			setSectors(sectors);
			setPoints(rotatedPoints);
			setRotation(fixedRotation);
			setCorners(cornerPositions);
			setFinishLine({ x: rotatedFinishLine.x, y: rotatedFinishLine.y, startAngle });
			setOriginalTrackPoints(originalPoints);
		})();
	}, [circuitKey]);

	const yellowSectors = useMemo(() => findYellowSectors(raceControlMessages), [raceControlMessages]);

	// Recomputed each frame so the anchor tracks the leader; it is one find plus one index calc.
	const gapReference = buildGapReference(timingDrivers?.Lines, originalTrackPoints);

	const renderedSectors = useMemo(() => {
		const status = getTrackStatusMessage(trackStatus?.Status ? parseInt(trackStatus.Status) : undefined);

		return sectors
			.map((sector) => {
				const color = getSectorColor(sector, status?.bySector, status?.trackColor, yellowSectors);
				return {
					color,
					pulse: status?.pulse,
					number: sector.number,
					strokeWidth: color === "stroke-white" ? 60 : 120,
					d: `M${sector.points[0].x},${sector.points[0].y} ${sector.points.map((point) => `L${point.x},${point.y}`).join(" ")}`,
				};
			})
			.sort(prioritizeColoredSectors);
	}, [trackStatus, sectors, yellowSectors]);

	if (!points || !minX || !minY || !widthX || !widthY) {
		return (
			<div className="h-full w-full p-2" style={{ minHeight: "35rem" }}>
				<div className="h-full w-full animate-pulse rounded-lg bg-zinc-800" />
			</div>
		);
	}

	return (
		<svg
			viewBox={`${minX} ${minY} ${widthX} ${widthY}`}
			className="h-full w-full xl:max-h-screen"
			xmlns="http://www.w3.org/2000/svg"
		>
			<path
				className="stroke-gray-800"
				strokeWidth={300}
				strokeLinejoin="round"
				fill="transparent"
				d={`M${points[0].x},${points[0].y} ${points.map((point) => `L${point.x},${point.y}`).join(" ")}`}
			/>

			{renderedSectors.map((sector) => {
				const style = sector.pulse
					? {
							animation: `${sector.pulse * 100}ms linear infinite pulse`,
						}
					: {};
				return (
					<path
						key={`map.sector.${sector.number}`}
						className={sector.color}
						strokeWidth={sector.strokeWidth}
						strokeLinecap="round"
						strokeLinejoin="round"
						fill="transparent"
						d={sector.d}
						style={style}
					/>
				);
			})}

			{finishLine && (
				<rect
					x={finishLine.x - 75}
					y={finishLine.y}
					width={240}
					height={20}
					fill="red"
					stroke="red"
					strokeWidth={70}
					transform={`rotate(${finishLine.startAngle + 90}, ${finishLine.x + 25}, ${finishLine.y})`}
				/>
			)}

			{showCornerNumbers &&
				corners.map((corner) => (
					<CornerNumber
						key={`corner.${corner.number}`}
						number={corner.number}
						x={corner.labelPos.x}
						y={corner.labelPos.y}
					/>
				))}

			{centerX && centerY && drivers && timingDrivers && (
				<>
					{Object.values(drivers)
						.reverse()
						.filter((driver) => (filter ? filter.includes(driver.RacingNumber) : true))
						.map((driver) => {
							const timingDriver = timingDrivers?.Lines[driver.RacingNumber];
							const hidden = timingDriver
								? timingDriver.KnockedOut || timingDriver.Stopped || timingDriver.Retired
								: false;
							const pit = timingDriver ? timingDriver.InPit : false;

							const segmentIndex = getDriverTrackIndex(timingDriver, originalTrackPoints);

							// Segment progress says roughly where the car is; the gap says it precisely.
							const targetIndex =
								segmentIndex !== null && timingDriver && originalTrackPoints
									? refineTrackIndexByGap(
											segmentIndex,
											timingDriver,
											gapReference,
											originalTrackPoints.length,
										)
									: segmentIndex;

							// During the new-lap segment reset the target is unknown; keep playing the buffer
							const samples =
								targetIndex !== null && originalTrackPoints
									? recordTrackSample(driver.RacingNumber, targetIndex, originalTrackPoints.length)
									: trackSamplesRef.current[driver.RacingNumber];

							// Skip rendering if we can't determine position
							if (!samples || !originalTrackPoints) return null;

							const playbackIndex = indexAtTime(samples, performance.now() - PLAYBACK_LAG_MS);
							const forwardOnlyIndex = Math.max(
								playbackIndex,
								renderedIndexRef.current[driver.RacingNumber] ?? playbackIndex,
							);
							renderedIndexRef.current[driver.RacingNumber] = forwardOnlyIndex;
							const driverPosition = pointAtTrackIndex(forwardOnlyIndex, originalTrackPoints);

							return (
								<CarDot
									key={`map.driver.${driver.RacingNumber}`}
									favoriteDriver={favoriteDrivers.length > 0 ? favoriteDrivers.includes(driver.RacingNumber) : false}
									name={driver.Tla}
									color={driver.TeamColour}
									pit={pit}
									hidden={hidden}
									pos={driverPosition}
									rotation={rotation}
									centerX={centerX}
									centerY={centerY}
								/>
							);
						})}
				</>
			)}
		</svg>
	);
}

type CornerNumberProps = {
	number: number;
	x: number;
	y: number;
};

const CornerNumber: React.FC<CornerNumberProps> = ({ number, x, y }) => {
	return (
		<text x={x} y={y} className="fill-zinc-700" fontSize={300} fontWeight="semibold">
			{number}
		</text>
	);
};

type CarDotProps = {
	name: string;
	color: string | undefined;
	favoriteDriver: boolean;

	pit: boolean;
	hidden: boolean;

	pos: PositionCar;
	rotation: number;

	centerX: number;
	centerY: number;
};

const CarDot = ({ pos, name, color, favoriteDriver, pit, hidden, rotation, centerX, centerY }: CarDotProps) => {
	const rotatedPos = rotate(pos.X, pos.Y, rotation, centerX, centerY);
	const transform = [`translateX(${rotatedPos.x}px)`, `translateY(${rotatedPos.y}px)`].join(" ");

	return (
		<g
			className={clsx("fill-zinc-700", { "opacity-30": pit }, { "opacity-0!": hidden })}
			style={{
				transition: "opacity 1s linear",
				transform,
				...(color && { fill: `#${color}` }),
			}}
		>
			<circle id={`map.driver.circle`} r={120} />
			<text
				id={`map.driver.text`}
				fontWeight="bold"
				fontSize={120 * 3}
				style={{
					transform: "translateX(150px) translateY(-120px)",
				}}
			>
				{name}
			</text>

			{favoriteDriver && (
				<circle
					id={`map.driver.favorite`}
					className="stroke-sky-400"
					r={180}
					fill="transparent"
					strokeWidth={40}
					style={{ transition: "all 1s linear" }}
				/>
			)}
		</g>
	);
};
