import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";

import type { PositionCar } from "@/types/state.type";
import type { Map, TrackPosition } from "@/types/map.type";

import { fetchMap } from "@/lib/fetchMap";

import { useDataStore } from "@/stores/useDataStore";
import { useCarMotionStore } from "@/stores/useCarMotionStore";
import { parseLapTime } from "@/lib/replay/carMotion";
import { useSettingsStore } from "@/stores/useSettingsStore";
import { getTrackStatusMessage } from "@/lib/getTrackStatusMessage";
import {
	BUBBLE_HEIGHT,
	BUBBLE_LINE_PITCH,
	BUBBLE_WIDTH,
	layOutSpeedBubbles,
	type BubbleAnchor,
} from "@/lib/speedBubbles";
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

// The track polyline is NOT evenly spaced: consecutive points sit anywhere from 1 to 190 units apart
// (over 3x the median at every circuit checked). Treating a point index as if it were proportional to
// distance therefore misplaces a car by up to ~200 m at the Hungaroring and ~570 m at Spa. Everything
// positional goes through lap fraction — real arc length — instead of raw index.
type TrackGeometry = {
	// Arc length from the start/finish line to each polyline point, plus the full lap.
	cumulative: number[];
	total: number;
	// True mini-sector boundaries as polyline indices, when the circuit publishes them.
	boundaries: number[] | null;
};

function buildTrackGeometry(points: { x: number; y: number }[], boundaries: number[] | null): TrackGeometry {
	const cumulative: number[] = [0];

	for (let i = 1; i < points.length; i++) {
		cumulative.push(cumulative[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y));
	}

	const last = points[points.length - 1];
	const total = cumulative[cumulative.length - 1] + Math.hypot(points[0].x - last.x, points[0].y - last.y);

	return { cumulative, total, boundaries };
}

// Fractional polyline index at a given fraction of the lap measured by distance.
function trackIndexAtLapFraction(fraction: number, geometry: TrackGeometry): number {
	const { cumulative, total } = geometry;
	const target = (((fraction % 1) + 1) % 1) * total;

	let low = 0;
	let high = cumulative.length - 1;

	while (low < high) {
		const mid = Math.floor((low + high + 1) / 2);
		if (cumulative[mid] <= target) low = mid;
		else high = mid - 1;
	}

	const spanStart = cumulative[low];
	const spanEnd = low + 1 < cumulative.length ? cumulative[low + 1] : total;
	const span = spanEnd - spanStart;

	return span > 0 ? low + (target - spanStart) / span : low;
}

// Point on the track polyline at a fractional index, interpolated between neighbouring points.
function pointAtTrackIndex(index: number, trackPoints: { x: number; y: number }[]): PositionCar {
	const wrapped = ((index % trackPoints.length) + trackPoints.length) % trackPoints.length;
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

// Tick marks at the mini-sector boundaries, drawn across the track so the checkpoints the dots step
// between are visible. Uses the circuit's published boundaries where they exist — mini-sectors are
// markedly unequal in length — and an equal division by distance where they don't.
const MINI_SECTOR_TICK_WIDTH = 300;

type TickMark = { from: TrackPosition; to: TrackPosition };

function miniSectorTicks(
	segmentCount: number,
	trackPoints: { x: number; y: number }[],
	geometry: TrackGeometry,
): TickMark[] {
	// Prefer the circuit's published boundaries — mini-sectors are markedly unequal, so an even
	// division only ever approximates them. Falls back to an equal division by distance.
	const indexes =
		geometry.boundaries ??
		Array.from({ length: segmentCount }, (_, boundary) => trackIndexAtLapFraction(boundary / segmentCount, geometry));

	return indexes.map((index) => {
		const here = pointAtTrackIndex(index, trackPoints);
		const ahead = pointAtTrackIndex(index + 1, trackPoints);

		const runX = ahead.X - here.X;
		const runY = ahead.Y - here.Y;
		const run = Math.hypot(runX, runY) || 1;

		// Perpendicular to the racing direction, centred on the track line.
		const acrossX = (-runY / run) * (MINI_SECTOR_TICK_WIDTH / 2);
		const acrossY = (runX / run) * (MINI_SECTOR_TICK_WIDTH / 2);

		return {
			from: { x: here.X - acrossX, y: here.Y - acrossY },
			to: { x: here.X + acrossX, y: here.Y + acrossY },
		};
	});
}

// Live positions arrive about every 250 ms. Each dot glides to its newest sample over the same
// span, so it moves continuously instead of hopping four times a second.
const POSITION_GLIDE_MS = 250;

// Replay dots are recalculated at a fixed 60 per second of real time, whatever the screen's refresh rate.
const REPLAY_UPDATES_PER_SECOND = 60;
const REPLAY_UPDATE_MS = 1000 / REPLAY_UPDATES_PER_SECOND;
// Screen frames arrive a fraction of a millisecond early or late; without this slack a 60 Hz screen
// would skip about one update in four.
const FRAME_JITTER_MS = 2;

const KMH_PER_MPH = 1.609344;
// The tail runs from the bubble down to just above the dot.
const TAIL_CLEARANCE = 150;

type SpeedBubbleElements = {
	bubble: SVGGElement;
	tail: SVGLineElement;
	lap: SVGTextElement;
	projected: SVGTextElement;
	value: SVGTSpanElement;
};

// The projected lap is green when it beats the driver's best lap, red when it does not.
const PROJECTED_FASTER = "fill-emerald-500";
const PROJECTED_SLOWER = "fill-red-500";
// Shown, greyed, while there is nothing to project (no lap time set yet, out-lap, pit).
const NO_PROJECTION = "NO TIME";
const NO_PROJECTION_TONE = "fill-zinc-500";

// "1:32.45": time into the current lap, to the hundredth.
function formatLapTime(ms: number): string {
	const hundredths = Math.floor(ms / 10);
	const minutes = Math.floor(hundredths / 6000);
	const seconds = Math.floor(hundredths / 100) % 60;
	return `${minutes}:${String(seconds).padStart(2, "0")}.${String(hundredths % 100).padStart(2, "0")}`;
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
	const showMiniSectorTicks = useSettingsStore((state) => state.showMiniSectorTicks);
	const favoriteDrivers = useSettingsStore((state) => state.favoriteDrivers);
	const speedUnit = useSettingsStore((state) => state.speedUnit);

	const positions = useDataStore((state) => state.positions);
	const motion = useCarMotionStore((state) => state.motion);
	const feedNowMs = useCarMotionStore((state) => state.feedNowMs);
	const dotElements = useRef(new globalThis.Map<string, SVGGElement>());
	const speedBubbles = useRef(new globalThis.Map<string, SpeedBubbleElements>());
	// Cars in the pit lane or garage: their bubble shows no lap clock.
	const inPit = useRef(new Set<string>());
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
	const [trackGeometry, setTrackGeometry] = useState<null | TrackGeometry>(null);
	const [pitLane, setPitLane] = useState<null | { x: number; y: number }[]>(null);
	const [lapPace, setLapPace] = useState<null | { seconds: number[]; lapSeconds: number | null }>(null);

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
			setPitLane(
				mapJson.pitLane?.x.map((x, index) => rotate(x, mapJson.pitLane!.y[index], fixedRotation, centerX, centerY)) ??
					null,
			);
			setRotation(fixedRotation);
			setCorners(cornerPositions);
			setFinishLine({ x: rotatedFinishLine.x, y: rotatedFinishLine.y, startAngle });
			setOriginalTrackPoints(originalPoints);
			setLapPace({ seconds: mapJson.trackPositionTime, lapSeconds: mapJson.candidateLap?.lapTime ?? null });
			setTrackGeometry(buildTrackGeometry(originalPoints, mapJson.miniSectorsIndexes ?? null));
		})();
	}, [circuitKey]);

	// The lap clocks start at the timing line: the map's first point, crossed heading towards its fourth.
	useEffect(() => {
		if (!motion || !originalTrackPoints || originalTrackPoints.length < 4) return;
		const [start, , , ahead] = originalTrackPoints;
		const length = Math.hypot(ahead.x - start.x, ahead.y - start.y) || 1;
		motion.setFinishLine({
			x: start.x,
			y: start.y,
			dx: (ahead.x - start.x) / length,
			dy: (ahead.y - start.y) / length,
		});
	}, [motion, originalTrackPoints]);

	// The map's own lap paces a projected lap until a lap has been seen whole.
	useEffect(() => {
		if (!motion || !originalTrackPoints || !lapPace) return;
		motion.setLapProfile(originalTrackPoints, lapPace.seconds, lapPace.lapSeconds);
	}, [motion, originalTrackPoints, lapPace]);

	const yellowSectors = useMemo(() => findYellowSectors(raceControlMessages), [raceControlMessages]);

	// Taken from the feed rather than hardcoded — the count varies by circuit.
	const miniSectorCount = timingDrivers
		? Object.values(timingDrivers.Lines).reduce(
				(most, line) => Math.max(most, line.Sectors?.reduce((count, sector) => count + sector.Segments.length, 0) ?? 0),
				0,
			)
		: 0;

	const miniSectorTickMarks = useMemo(
		() =>
			showMiniSectorTicks && originalTrackPoints && trackGeometry && miniSectorCount > 0
				? miniSectorTicks(miniSectorCount, originalTrackPoints, trackGeometry)
				: [],
		[showMiniSectorTicks, originalTrackPoints, trackGeometry, miniSectorCount],
	);

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

	// Replay: place every dot on its recorded path at the playback instant, so cars move continuously
	// instead of jumping once per ~1 s bundle of samples. The screen's frame callback only offers a
	// chance to draw; dots move only when the next 1/60 s update is due, so the rate is the same on a
	// 60 Hz or a 144 Hz screen.
	useEffect(() => {
		if (!motion || !feedNowMs || centerX === null || centerY === null) return;
		let nextUpdateMs = 0;
		let frame = requestAnimationFrame(function place(frameMs) {
			frame = requestAnimationFrame(place);
			if (frameMs < nextUpdateMs - FRAME_JITTER_MS) return;
			// Stay on the 60 Hz beat, but never try to catch up after the tab was hidden or stalled.
			nextUpdateMs = Math.max(nextUpdateMs + REPLAY_UPDATE_MS, frameMs + REPLAY_UPDATE_MS / 2);
			const now = feedNowMs();
			const anchors: BubbleAnchor[] = [];
			dotElements.current.forEach((element, driver) => {
				const at = motion.positionAt(driver, now);
				if (!at) return;
				const { x, y } = rotate(at.X, at.Y, rotation, centerX, centerY);
				element.style.transform = `translateX(${x}px) translateY(${y}px)`;
				if (speedBubbles.current.has(driver) && motion.speedAt(driver, now) !== null) anchors.push({ driver, x, y });
			});
			placeSpeedBubbles(anchors, now);
		});

		function placeSpeedBubbles(anchors: BubbleAnchor[], now: number) {
			const metric = useSettingsStore.getState().speedUnit === "metric";
			const placed = new Set<string>();
			for (const { driver, x, y } of layOutSpeedBubbles(anchors)) {
				const elements = speedBubbles.current.get(driver);
				const anchor = anchors.find((a) => a.driver === driver);
				const kmh = motion!.speedAt(driver, now);
				if (!elements || !anchor || kmh === null) continue;
				placed.add(driver);
				elements.bubble.style.display = "";
				elements.bubble.style.transform = `translateX(${x}px) translateY(${y}px)`;
				elements.tail.style.display = "";
				elements.tail.setAttribute("x1", `${x}`);
				elements.tail.setAttribute("y1", `${y + BUBBLE_HEIGHT / 2}`);
				elements.tail.setAttribute("x2", `${anchor.x}`);
				elements.tail.setAttribute("y2", `${anchor.y - TAIL_CLEARANCE}`);
				const shown = `${Math.round(metric ? kmh : kmh / KMH_PER_MPH)}`;
				if (elements.value.textContent !== shown) elements.value.textContent = shown;
				const lapMs = inPit.current.has(driver) ? null : motion!.lapTimeAt(driver, now);
				const lap = lapMs === null ? "" : formatLapTime(lapMs);
				if (elements.lap.textContent !== lap) elements.lap.textContent = lap;
				const officialBest = parseLapTime(useDataStore.getState().state?.TimingData?.Lines[driver]?.BestLapTime?.Value);
				const projection = lapMs === null ? null : motion!.projectedLapAt(driver, now, officialBest);
				const projected = projection ? formatLapTime(projection.projectedMs) : NO_PROJECTION;
				if (elements.projected.textContent !== projected) elements.projected.textContent = projected;
				const tone = !projection
					? NO_PROJECTION_TONE
					: projection.projectedMs < projection.bestMs
						? PROJECTED_FASTER
						: PROJECTED_SLOWER;
				if (elements.projected.getAttribute("class") !== tone) elements.projected.setAttribute("class", tone);
			}
			// No position or no speed at this instant (garage, data gap): no bubble.
			speedBubbles.current.forEach((elements, driver) => {
				if (placed.has(driver)) return;
				elements.bubble.style.display = "none";
				elements.tail.style.display = "none";
			});
		}
		return () => cancelAnimationFrame(frame);
	}, [motion, feedNowMs, rotation, centerX, centerY]);

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

			{pitLane && (
				<path
					className="stroke-emerald-500"
					strokeWidth={60}
					strokeLinecap="round"
					strokeLinejoin="round"
					fill="transparent"
					d={`M${pitLane[0].x},${pitLane[0].y} ${pitLane.map((point) => `L${point.x},${point.y}`).join(" ")}`}
				/>
			)}

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

			{centerX !== null &&
				centerY !== null &&
				miniSectorTickMarks.map((tick, index) => {
					const from = rotate(tick.from.x, tick.from.y, rotation, centerX, centerY);
					const to = rotate(tick.to.x, tick.to.y, rotation, centerX, centerY);

					return (
						<line
							key={`map.minisector.${index}`}
							className="stroke-zinc-500"
							x1={from.x}
							y1={from.y}
							x2={to.x}
							y2={to.y}
							strokeWidth={30}
							strokeLinecap="round"
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
							if (pit) inPit.current.add(driver.RacingNumber);
							else inPit.current.delete(driver.RacingNumber);

							const driverPosition = positions?.[driver.RacingNumber];
							if (!driverPosition) return null;

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
									smooth={motion?.has(driver.RacingNumber) ?? false}
									dotRef={(element) => {
										if (element) dotElements.current.set(driver.RacingNumber, element);
										else dotElements.current.delete(driver.RacingNumber);
									}}
								/>
							);
						})}

					{/* After every dot, so a bubble is never hidden under another car. */}
					{motion &&
						Object.values(drivers)
							.filter((driver) => favoriteDrivers.includes(driver.RacingNumber))
							.filter((driver) => (filter ? filter.includes(driver.RacingNumber) : true))
							.filter((driver) => {
								const timingDriver = timingDrivers?.Lines[driver.RacingNumber];
								return !(timingDriver?.KnockedOut || timingDriver?.Stopped || timingDriver?.Retired);
							})
							.map((driver) => (
								<SpeedBubble
									key={`map.speed.${driver.RacingNumber}`}
									color={driver.TeamColour}
									unit={speedUnit === "metric" ? "km/h" : "mph"}
									elementsRef={(elements) => {
										if (elements) speedBubbles.current.set(driver.RacingNumber, elements);
										else speedBubbles.current.delete(driver.RacingNumber);
									}}
								/>
							))}
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

	// Replay: the map moves this dot every frame itself, so React must leave its transform alone.
	smooth: boolean;
	dotRef: (element: SVGGElement | null) => void;
};

const CarDot = (props: CarDotProps) => {
	const { pos, name, color, favoriteDriver, pit, hidden, rotation, centerX, centerY, smooth, dotRef } = props;
	const rotatedPos = rotate(pos.X, pos.Y, rotation, centerX, centerY);
	const transform = [`translateX(${rotatedPos.x}px)`, `translateY(${rotatedPos.y}px)`].join(" ");
	const motionStyle = smooth
		? { transition: "opacity 1s linear" }
		: { transition: `opacity 1s linear, transform ${POSITION_GLIDE_MS}ms linear`, transform };

	return (
		<g
			ref={dotRef}
			className={clsx("fill-zinc-700", { "opacity-30": pit }, { "opacity-0!": hidden })}
			style={{
				...motionStyle,
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

type SpeedBubbleProps = {
	color: string | undefined;
	unit: string;
	// The map places the bubble and writes its number every update itself.
	elementsRef: (elements: SpeedBubbleElements | null) => void;
};

const SpeedBubble = ({ color, unit, elementsRef }: SpeedBubbleProps) => {
	const bubble = useRef<SVGGElement>(null);
	const tail = useRef<SVGLineElement>(null);
	const lap = useRef<SVGTextElement>(null);
	const projected = useRef<SVGTextElement>(null);
	const value = useRef<SVGTSpanElement>(null);
	const stroke = color ? `#${color}` : "#a1a1aa";

	useEffect(() => {
		if (bubble.current && tail.current && lap.current && projected.current && value.current) {
			elementsRef({
				bubble: bubble.current,
				tail: tail.current,
				lap: lap.current,
				projected: projected.current,
				value: value.current,
			});
		}
		return () => elementsRef(null);
		// Registered once per mounted bubble; the map owns its position from then on.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	return (
		<>
			<line ref={tail} stroke={stroke} strokeWidth={30} style={{ display: "none" }} />
			<g ref={bubble} style={{ display: "none" }}>
				<rect
					x={-BUBBLE_WIDTH / 2}
					y={-BUBBLE_HEIGHT / 2}
					width={BUBBLE_WIDTH}
					height={BUBBLE_HEIGHT}
					rx={BUBBLE_WIDTH / 5}
					className="fill-zinc-900"
					stroke={stroke}
					strokeWidth={40}
				/>
				{/* Fixed-width digits, so the ticking hundredths do not make the line shuffle. */}
				<text
					ref={lap}
					y={-BUBBLE_LINE_PITCH}
					textAnchor="middle"
					dominantBaseline="central"
					className="fill-white"
					fontWeight="bold"
					fontSize={260}
					style={{ fontVariantNumeric: "tabular-nums" }}
				/>
				{/* The map sets its colour along with its text. */}
				<text
					ref={projected}
					textAnchor="middle"
					dominantBaseline="central"
					className={NO_PROJECTION_TONE}
					fontWeight="bold"
					fontSize={260}
					style={{ fontVariantNumeric: "tabular-nums" }}
				/>
				<text
					y={BUBBLE_LINE_PITCH}
					textAnchor="middle"
					dominantBaseline="central"
					className="fill-white"
					fontWeight="bold"
				>
					<tspan ref={value} fontSize={300} />
					<tspan fontSize={150} className="fill-zinc-400" dx={40}>
						{unit}
					</tspan>
				</text>
			</g>
		</>
	);
};
