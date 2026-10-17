import { inflate } from "@/lib/inflate";

import type { ReplaySession } from "@/lib/replay/replaySession";
import type { CarData, Position } from "@/types/state.type";

// Beyond this gap between readings (garage, lost signal) a car jumps rather than glides.
const MAX_GLIDE_GAP_MS = 2000;

// How many of F1's readings (~4 a second) each timing fit looks at. 32 is about 8 s of driving.
export const DEFAULT_TIMING_WINDOW = 32;

const FIT_DEGREE = 3;

// Neighbouring fits are blended over this much time either side, so the hand-over from one fit to
// the next is equally gentle whether the readings are 40 ms or 400 ms apart.
const BLEND_MS = 500;

// Readings either side that a distance may never stray beyond - a guard against a broken fit only.
const GUARD_READINGS = 8;

export type CarPoint = { X: number; Y: number };

// The timing line, in the feed's own X/Y: a point on it and the unit direction of travel across it.
export type FinishLine = { x: number; y: number; dx: number; dy: number };

// Every car's path, so its position can be read at any instant - built whole from a recorded
// session, or grown reading by reading from the live feed.
//
// F1's readings put each car accurately on the track, but their timestamps wobble by tens of
// milliseconds, so the speed implied between two neighbouring readings swings wildly. Each car
// therefore separates WHERE it is from WHEN it gets there:
//   - where: a smooth path through the readings, measured by distance travelled along it;
//   - when:  a weighted least-squares cubic of distance against time over `timingWindow` readings,
//            which averages the timestamp wobble out while keeping real braking and acceleration.
export class CarMotion {
	private readonly cars = new Map<string, CarTrack>();
	private readonly speeds = new Map<string, SpeedTrace>();
	private readonly laps = new Map<string, LapClock>();
	// Each driver's best lap so far, traced, so a lap under way can be compared with it point by point.
	private readonly bestLaps = new Map<string, { lap: TimedLap; trace: LapTrace | null }>();
	// Other cars' laps traced as pace references, by driver and lap start; null = could not be traced.
	private readonly paceTraces = new Map<string, LapTrace | null>();
	private finishLine: FinishLine | null = null;
	private lapProfile: LapProfile | null = null;

	constructor(private readonly timingWindow = DEFAULT_TIMING_WINDOW) {}

	static fromSession(session: ReplaySession, timingWindow = DEFAULT_TIMING_WINDOW): CarMotion {
		const motion = new CarMotion(timingWindow);
		readingsByCar(session).forEach((readings, driver) => {
			motion.cars.set(driver, CarTrack.recorded(readings, timingWindow));
		});
		motion.addCarData(session.snapshots["CarData.z"]);
		const recordingStartMs = Date.parse(session.recordingStartUtc);
		for (const [offset, topic, data] of session.updates) {
			if (topic === "CarData.z") motion.addCarData(data);
			if (topic === "TimingData") motion.addLapTimes(data, recordingStartMs + offset * 1000);
		}
		return motion;
	}

	// Adds one live Position.z message; returns its newest reading's time (F1's clock), if any.
	addPositions(encoded: string): number | null {
		let newest: number | null = null;
		for (const frame of inflate<Position>(encoded).Position) {
			const t = Date.parse(frame.Timestamp);
			newest = Math.max(newest ?? t, t);
			for (const [driver, car] of Object.entries(frame.Entries)) {
				if (!car.X && !car.Y) continue;
				const track = this.cars.get(driver) ?? new CarTrack(this.timingWindow);
				track.append({ t, x: car.X, y: car.Y });
				this.cars.set(driver, track);
			}
		}
		return newest;
	}

	// Adds one CarData.z message - the car's own telemetry, which carries its speed.
	addCarData(encoded: unknown): void {
		if (typeof encoded !== "string") return;
		for (const entry of inflate<CarData>(encoded).Entries) {
			const t = Date.parse(entry.Utc);
			for (const [driver, car] of Object.entries(entry.Cars)) {
				const trace = this.speeds.get(driver) ?? new SpeedTrace();
				trace.append(t, car.Channels[SPEED_CHANNEL]);
				this.speeds.set(driver, trace);
			}
		}
	}

	// Adds the official lap times in one TimingData update, which reached the feed at `arrivedMs`,
	// and the cars it reports leaving their pit box (PitOut), whose out-laps start there.
	addLapTimes(timingData: unknown, arrivedMs: number): void {
		const lines = (timingData as { Lines?: Record<string, TimingLine> } | null)?.Lines;
		if (!lines || typeof lines !== "object") return;
		for (const [driver, line] of Object.entries(lines)) {
			const lapMs = parseLapTime(line?.LastLapTime?.Value);
			const leftPit = line?.PitOut === true;
			const sectors = line?.Sectors;
			if (lapMs === null && !leftPit && !sectors) continue;
			const clock = this.laps.get(driver) ?? new LapClock();
			if (lapMs !== null) clock.addOfficialLap(arrivedMs, lapMs);
			if (leftPit) clock.addPitOut(arrivedMs);
			if (sectors && typeof sectors === "object") clock.addSectors(sectors, arrivedMs);
			this.laps.set(driver, clock);
		}
	}

	// The first sectors in the session's state when the page loads (live only).
	seedSectors(timingData: unknown, arrivedMs: number): void {
		const lines = (timingData as { Lines?: Record<string, TimingLine> } | null)?.Lines;
		if (!lines || typeof lines !== "object") return;
		for (const [driver, line] of Object.entries(lines)) {
			if (!line?.Sectors || typeof line.Sectors !== "object") continue;
			const clock = this.laps.get(driver) ?? new LapClock();
			clock.seedFirstSector(line.Sectors, arrivedMs);
			this.laps.set(driver, clock);
		}
	}

	// The circuit map's outline and how far into its lap the car that drew it was at each point: the
	// pace through a lap before any lap has been seen whole (just after the page loads).
	setLapProfile(points: { x: number; y: number }[], seconds: number[], lapSeconds: number | null): void {
		this.lapProfile = LapProfile.of(points, seconds, lapSeconds);
	}

	// Where the timing line is; lap clocks start counting from the first crossing found after this.
	setFinishLine(line: FinishLine): void {
		const same =
			this.finishLine &&
			this.finishLine.x === line.x &&
			this.finishLine.y === line.y &&
			this.finishLine.dx === line.dx &&
			this.finishLine.dy === line.dy;
		if (same) return;
		this.finishLine = line;
		this.laps.forEach((clock) => clock.forgetCrossings());
	}

	// How long the car has been on its current lap at `feedMs`, in ms; null when unknown.
	lapTimeAt(driver: string, feedMs: number): number | null {
		return this.clockOf(driver)?.clock.elapsedAt(feedMs) ?? null;
	}

	// What the lap under way at `feedMs` will come to, and the best lap it is measured against: that
	// best plus however far ahead of or behind it the car is now, at the same distance into the lap.
	// `officialBestMs` is F1's own personal best for the driver (deleted laps already left out), known
	// from the moment the page loads. When the driver's own best lap was seen and traced, the car is
	// compared with it point by point; otherwise (a best set before the page loaded, live) the best
	// is paced through the lap like the fastest lap traced from any car. Null when there is no best,
	// no lap clock, or nothing traced yet.
	projectedLapAt(
		driver: string,
		feedMs: number,
		officialBestMs: number | null,
	): { projectedMs: number; bestMs: number } | null {
		const timing = this.clockOf(driver);
		if (!timing) return null;
		const { clock, track } = timing;
		const start = clock.startAt(feedMs);
		const along = start === null ? null : this.distanceIntoLap(track, start, feedMs);
		if (start === null || along === null) return null;

		const own = clock.bestLapBy(feedMs);
		const ownTrace = own ? this.traceOfBest(driver, track, own) : null;
		const bestMs = officialBestMs ?? own?.lapMs ?? null;
		if (bestMs === null) return null;

		let bestMsHere: number;
		const pace = this.paceLapBy(feedMs);
		if (own && ownTrace && Math.abs(own.lapMs - bestMs) < SAME_LAP_MS) {
			bestMsHere = ownTrace.timeAtDistance(along);
		} else if (pace) {
			bestMsHere = (pace.trace.timeAtDistance(along) * bestMs) / pace.lapMs;
		} else if (this.lapProfile) {
			bestMsHere = this.lapProfile.shareOfLapAt(along) * bestMs;
		} else {
			return null;
		}
		return { projectedMs: bestMs + (feedMs - start - bestMsHere), bestMs };
	}

	// How far the car has come since `start`: by its own readings when they reach back that far,
	// otherwise (a lap that began before the page loaded) by where it now is on the circuit map.
	private distanceIntoLap(track: CarTrack, start: number, feedMs: number): number | null {
		const here = track.odometerAt(feedMs);
		const from = track.odometerAt(start);
		if (here !== null && from !== null) return here - from;
		if (here === null || !this.lapProfile || track.oldestMs() <= start) return null;
		const point = track.positionAt(feedMs);
		return this.lapProfile.distanceFromLineTo({ x: point.X, y: point.Y });
	}

	// The fastest lap any car has finished by `feedMs` that could be traced: its shape stands in for a
	// best lap set before the page loaded. Every car is scanned, not only the favourites.
	private paceLapBy(feedMs: number): { trace: LapTrace; lapMs: number } | null {
		const laps: { driver: string; lap: TimedLap; track: CarTrack }[] = [];
		this.cars.forEach((_, driver) => {
			const timing = this.clockOf(driver);
			const lap = timing?.clock.bestLapBy(feedMs);
			if (timing && lap) laps.push({ driver, lap, track: timing.track });
		});
		laps.sort((a, b) => a.lap.lapMs - b.lap.lapMs);
		for (const { driver, lap, track } of laps) {
			const key = `${driver}@${lap.start}`;
			if (!this.paceTraces.has(key)) this.paceTraces.set(key, LapTrace.of(track, lap));
			const trace = this.paceTraces.get(key);
			if (trace) return { trace, lapMs: lap.lapMs };
		}
		return null;
	}

	private clockOf(driver: string): { clock: LapClock; track: CarTrack } | null {
		const track = this.cars.get(driver);
		if (!this.finishLine || !track?.ready()) return null;
		const clock = this.laps.get(driver) ?? new LapClock();
		this.laps.set(driver, clock);
		clock.scan(track, this.finishLine);
		return { clock, track };
	}

	// Traced once per best lap; a lap whose readings are gone or broken by a gap stays untraced.
	private traceOfBest(driver: string, track: CarTrack, best: TimedLap): LapTrace | null {
		const known = this.bestLaps.get(driver);
		if (known && known.lap.start === best.start && known.lap.lapMs === best.lapMs) return known.trace;
		const trace = LapTrace.of(track, best);
		this.bestLaps.set(driver, { lap: best, trace });
		return trace;
	}

	// Drops readings from before `feedMs`, so a live race does not pile up hours of them.
	forgetBefore(feedMs: number): void {
		this.cars.forEach((track) => track.forgetBefore(feedMs));
		this.speeds.forEach((trace) => trace.forgetBefore(feedMs));
	}

	has(driver: string): boolean {
		return this.cars.get(driver)?.ready() ?? false;
	}

	// Where the car was at `feedMs` (F1's own clock).
	positionAt(driver: string, feedMs: number): CarPoint | null {
		const track = this.cars.get(driver);
		return track?.ready() ? track.positionAt(feedMs) : null;
	}

	// The car's speed in km/h at `feedMs` (F1's own clock), read on the same clock as its position.
	speedAt(driver: string, feedMs: number): number | null {
		return this.speeds.get(driver)?.at(feedMs) ?? null;
	}
}

// How far either side of the timing line's centre a crossing still counts: 40 m, the track's width
// with margin. (At Singapore no car crossed 40-200 m out, so the pit lane needs no wider reach.)
const FINISH_LINE_REACH = 400;

// An official lap time is matched to the crossing that ended it. Measured against the recording's
// clock it usually lands from 0.7 s before that crossing to 1.2 s after (the recording's and the
// positions' clocks differ by a couple of seconds), and now and then up to 8.3 s after. The window is
// wide because crossings are a minute or more apart.
const LAP_TIME_ARRIVES_FROM_MS = -3000;
const LAP_TIME_ARRIVES_UNTIL_MS = 10000;
// ...and only if the crossings either side agree with it, so a missed crossing cannot pair it wrongly.
const LAP_TIME_AGREES_WITHIN_MS = 1000;
// Past this the car is parked, not lapping.
const LONGEST_LAP_MS = 10 * 60 * 1000;

// F1 reports a car leaving its pit box (PitOut) a second or two after its readings show it moving
// off - in Singapore Sprint Qualifying the report reached the feed about 1.4 s later. The moment is
// read from the readings once those up to PIT_OUT_ARRIVES_UNTIL_MS after the report are in, looking
// back as far as PIT_OUT_LOOKBACK_MS for where the car last stood still.
const PIT_OUT_ARRIVES_UNTIL_MS = 5000;
const PIT_OUT_LOOKBACK_MS = 30_000;
// Under 1 m between neighbouring readings (about a quarter of a second apart) is standing still.
const STANDING_STILL = 10;
// A car leaving its box within this long of crossing the timing line in the pit lane is on the lap
// that crossing started (a race pit stop), not on an out-lap of its own.
const LONGEST_PIT_STOP_MS = 2 * 60 * 1000;

// A lap start worked back from sector times is out by however late the sector time reached the feed
// (usually about a second, at Singapore up to 11 s); a start this close before it is the same lap's.
const SECTOR_START_AGREES_WITHIN_MS = 15_000;

// F1's lap times are to the millisecond; two that agree this closely are the same lap.
const SAME_LAP_MS = 1;

// A completed lap with its official time: when it started on the feed's clock, and how long it took.
type TimedLap = { start: number; lapMs: number };

// The parts of one driver's TimingData line the lap clock reads.
type TimingLine = {
	LastLapTime?: { Value?: string };
	PitOut?: boolean;
	Sectors?: Record<string, { Value?: string }> | { Value?: string }[];
};

// A best lap traced every TRACE_STEP_MS: how far into the lap the car was at each moment.
const TRACE_STEP_MS = 100;

class LapTrace {
	private constructor(
		private readonly ms: number[],
		private readonly distance: number[],
	) {}

	static of(track: CarTrack, lap: TimedLap): LapTrace | null {
		const from = track.odometerAt(lap.start);
		if (from === null) return null;
		const ms: number[] = [];
		const distance: number[] = [];
		for (let into = 0; ; into = Math.min(into + TRACE_STEP_MS, lap.lapMs)) {
			const at = track.odometerAt(lap.start + into);
			if (at === null) return null;
			ms.push(into);
			// Never backwards, so it can be searched by distance.
			distance.push(Math.max(at - from, distance[distance.length - 1] ?? 0));
			if (into === lap.lapMs) return new LapTrace(ms, distance);
		}
	}

	// How long into the lap the car took to cover `along`.
	timeAtDistance(along: number): number {
		const { ms, distance } = this;
		const last = distance.length - 1;
		if (along <= 0) return 0;
		if (along >= distance[last]) return ms[last];
		const i = indexAtOrBefore(distance, along);
		const span = distance[i + 1] - distance[i];
		return span > 0 ? ms[i] + ((ms[i + 1] - ms[i]) * (along - distance[i])) / span : ms[i];
	}
}

// The circuit map's outline (MultiViewer traced it from one real lap) with how far into that lap
// the car was at each point. Only the shape of the pace is used - the lap itself was slow - scaled to
// the driver's best.
class LapProfile {
	private constructor(
		private readonly points: { x: number; y: number }[],
		private readonly distance: number[],
		private readonly share: number[],
	) {}

	static of(points: { x: number; y: number }[], seconds: number[], lapSeconds: number | null): LapProfile | null {
		if (points.length < 2) return null;
		const distance = [0];
		for (let i = 1; i < points.length; i++) {
			distance.push(distance[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y));
		}
		const last = points.length - 1;
		const lapLength = distance[last] + Math.hypot(points[0].x - points[last].x, points[0].y - points[last].y);
		const outline = [...points, points[0]];
		// A map without timings (the locally built fallbacks) is paced evenly by distance.
		if (seconds.length !== points.length) {
			return new LapProfile(outline, [...distance, lapLength], [...distance.map((d) => d / lapLength), 1]);
		}
		// The map stops short of the line; the last stretch back to it is paced like the one before.
		const lastStep = (seconds[last] - seconds[last - 1]) / (distance[last] - distance[last - 1] || 1);
		const lapTime = lapSeconds ?? seconds[last] + (lapLength - distance[last]) * lastStep;
		if (!(lapTime > 0)) return null;
		return new LapProfile(outline, [...distance, lapLength], [...seconds.map((ms) => ms / lapTime), 1]);
	}

	// The share of a lap's time taken to cover `along` from the line.
	shareOfLapAt(along: number): number {
		const { distance, share } = this;
		const last = distance.length - 1;
		if (along <= 0) return 0;
		if (along >= distance[last]) return 1;
		const i = indexAtOrBefore(distance, along);
		const span = distance[i + 1] - distance[i];
		return span > 0 ? share[i] + ((share[i + 1] - share[i]) * (along - distance[i])) / span : share[i];
	}

	// How far round the outline from the line the nearest point to `point` is.
	distanceFromLineTo(point: { x: number; y: number }): number {
		const { points, distance } = this;
		let best = Infinity;
		let along = 0;
		for (let i = 0; i < points.length - 1; i++) {
			const a = points[i];
			const b = points[i + 1];
			const dx = b.x - a.x;
			const dy = b.y - a.y;
			const length2 = dx * dx + dy * dy || 1;
			const k = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length2));
			const gap = Math.hypot(a.x + dx * k - point.x, a.y + dy * k - point.y);
			if (gap < best) {
				best = gap;
				along = distance[i] + (distance[i + 1] - distance[i]) * k;
			}
		}
		return along;
	}
}

// "1:32.456" or "32.456" in ms; null for a blank or unreadable value.
export const parseLapTime = (value: string | undefined): number | null => {
	if (!value) return null;
	const [minutes, seconds] = value.includes(":") ? value.split(":") : ["0", value];
	const ms = (Number(minutes) * 60 + Number(seconds)) * 1000;
	return Number.isFinite(ms) && ms > 0 ? ms : null;
};

// One car's lap starts. A single crossing is timed to within about 0.05 s, but now and then one is
// out by up to 0.6 s. So the gaps between lap starts are F1's official lap times (exact to the
// millisecond), and the crossings only decide where a run of officially-timed laps sits on the clock:
// at the median of all of them, which one bad crossing cannot move. Measured on 2026 Singapore Sprint
// Qualifying, a run lands within about 0.05 s.
class LapClock {
	private crossings: number[] = [];
	private scannedTo = 0;
	private official: { arrivedMs: number; lapMs: number }[] = [];
	// When F1 reported the car leaving its pit box, and the moment its readings show it moving off
	// (null until readings from after the report have arrived).
	private pitOuts: { arrivedMs: number; leftMs: number | null }[] = [];
	// Lap starts worked back from sector times (the time a sector arrived less the lap's sectors so
	// far), for a lap that began before the page loaded. Its first sector, while the lap is under way.
	private sectorStarts: { start: number; arrivedMs: number }[] = [];
	private firstSector: { ms: number; arrivedMs: number } | null = null;
	private starts: number[] = [];
	private timed: TimedLap[] = [];
	private stale = true;

	addOfficialLap(arrivedMs: number, lapMs: number): void {
		this.official.push({ arrivedMs, lapMs });
		this.stale = true;
	}

	addPitOut(arrivedMs: number): void {
		this.pitOuts.push({ arrivedMs, leftMs: null });
		this.stale = true;
	}

	// One TimingData update's sector times for this car. A first-sector time arrives as the car
	// finishes it, with the other two blanked; a second-sector time follows.
	addSectors(sectors: NonNullable<TimingLine["Sectors"]>, arrivedMs: number): void {
		const sector = (k: number) => parseLapTime((Array.isArray(sectors) ? sectors[k] : sectors[String(k)])?.Value);
		const first = sector(0);
		const second = sector(1);
		if (first !== null) {
			this.firstSector = { ms: first, arrivedMs };
			this.sectorStarts.push({ start: arrivedMs - first, arrivedMs });
			this.stale = true;
		} else if (second !== null && this.firstSector && arrivedMs - this.firstSector.arrivedMs <= LONGEST_LAP_MS) {
			this.sectorStarts.push({ start: arrivedMs - this.firstSector.ms - second, arrivedMs });
			this.stale = true;
		}
	}

	// The first sector of the lap under way when the page loaded (its arrival unknown, so it starts
	// nothing itself): with it, the second sector's time places that lap.
	seedFirstSector(sectors: NonNullable<TimingLine["Sectors"]>, arrivedMs: number): void {
		const sector = (k: number) => parseLapTime((Array.isArray(sectors) ? sectors[k] : sectors[String(k)])?.Value);
		const first = sector(0);
		if (first !== null && sector(1) === null) this.firstSector = { ms: first, arrivedMs };
	}

	forgetCrossings(): void {
		this.crossings = [];
		this.scannedTo = 0;
		this.stale = true;
	}

	scan(track: CarTrack, line: FinishLine): void {
		const { times, next } = track.crossingsSince(line, this.scannedTo);
		this.scannedTo = next;
		if (times.length) {
			this.crossings.push(...times);
			this.stale = true;
		}
		for (const pitOut of this.pitOuts) {
			const settledBy = pitOut.arrivedMs + PIT_OUT_ARRIVES_UNTIL_MS;
			if (pitOut.leftMs !== null || track.newestMs() < settledBy) continue;
			pitOut.leftMs = track.movedOffAt(settledBy, PIT_OUT_ARRIVES_UNTIL_MS + PIT_OUT_LOOKBACK_MS) ?? pitOut.arrivedMs;
			this.stale = true;
		}
	}

	elapsedAt(feedMs: number): number | null {
		const start = this.startAt(feedMs);
		return start === null ? null : feedMs - start;
	}

	// When the lap under way at `feedMs` began; null when unknown or the car is parked.
	startAt(feedMs: number): number | null {
		if (this.stale) this.settleStarts();
		// Not indexAtOrBefore: it never answers the last entry, and live the lap under way is always the last.
		const lap = this.starts.findLastIndex((start) => start <= feedMs);
		if (lap < 0) return null;
		return feedMs - this.starts[lap] <= LONGEST_LAP_MS ? this.starts[lap] : null;
	}

	// The fastest officially-timed lap finished by `feedMs`. A replay holds the whole session, so a
	// lap still to come must not count.
	bestLapBy(feedMs: number): TimedLap | null {
		if (this.stale) this.settleStarts();
		let best: TimedLap | null = null;
		for (const lap of this.timed) {
			if (lap.start + lap.lapMs <= feedMs && (!best || lap.lapMs < best.lapMs)) best = lap;
		}
		return best;
	}

	// Lap starts come from three places:
	//   - the timing line crossed on track, placed by official lap times (lapsThrough);
	//   - the timing line crossed in the pit lane, which the readings never show: the lap before it
	//     started at a known moment and its official time says when it ended;
	//   - the car moving off from its pit box, for an out-lap that never crossed the line at all (the
	//     garages sit past it). Not after a pit-lane crossing, which already started that lap.
	private settleStarts(): void {
		const crossings = [...this.crossings];
		const inPitLane: number[] = [];
		let laps = this.lapsThrough(crossings);
		// Each pass adds one crossing for one official lap, so there are never more passes than laps.
		for (let pass = 0; pass < this.official.length; pass++) {
			const found = this.pitLaneCrossing(laps.runEnds, crossings);
			if (found === null) break;
			inPitLane.push(found);
			crossings.push(found);
			crossings.sort((a, b) => a - b);
			laps = this.lapsThrough(crossings);
		}

		const starts = [...laps.starts];
		for (const { arrivedMs, leftMs } of this.pitOuts) {
			const movedOff = leftMs ?? arrivedMs;
			const afterPitLaneCrossing = inPitLane.some(
				(crossed) => crossed <= movedOff && movedOff - crossed <= LONGEST_PIT_STOP_MS,
			);
			if (!afterPitLaneCrossing) starts.push(movedOff);
		}
		// A sector-time start only stands in where no other start falls between it and the sector time
		// arriving (that one already places the lap), and never across a stop in the pits (an
		// out-lap's sectors are timed from the pit lane).
		for (const { start, arrivedMs } of this.sectorStarts) {
			const known = starts.some((other) => other >= start - SECTOR_START_AGREES_WITHIN_MS && other <= arrivedMs);
			const pitted = this.pitOuts.some(
				({ arrivedMs: left }) => left >= start - SECTOR_START_AGREES_WITHIN_MS && left <= arrivedMs,
			);
			if (!known && !pitted) starts.push(start);
		}
		this.starts = starts.sort((a, b) => a - b);
		this.timed = laps.timed;
		this.stale = false;
	}

	// A lap that ended in the pit lane: an official time arriving as the last lap of a run would have
	// ended had it lasted that long, with no crossing near that moment. Its end, or null.
	private pitLaneCrossing(runEnds: number[], crossings: number[]): number | null {
		for (const lastStart of runEnds) {
			const next = crossings.find((crossed) => crossed > lastStart) ?? Infinity;
			const lap = this.official.find(({ arrivedMs, lapMs }) => {
				const ended = lastStart + lapMs;
				return (
					arrivedMs - ended >= LAP_TIME_ARRIVES_FROM_MS &&
					arrivedMs - ended <= LAP_TIME_ARRIVES_UNTIL_MS &&
					next - ended > LAP_TIME_AGREES_WITHIN_MS
				);
			});
			if (lap) return lastStart + lap.lapMs;
		}
		return null;
	}

	// Lap starts and timed laps through `crossings` (sorted), and the last lap start of each run.
	private lapsThrough(crossings: number[]): { starts: number[]; timed: TimedLap[]; runEnds: number[] } {
		// The official time of the lap that ended at crossing j, where one fits.
		const lapEnding = (j: number): number | null => {
			if (j < 1) return null;
			const match = this.official.find(
				({ arrivedMs, lapMs }) =>
					arrivedMs - crossings[j] >= LAP_TIME_ARRIVES_FROM_MS &&
					arrivedMs - crossings[j] <= LAP_TIME_ARRIVES_UNTIL_MS &&
					Math.abs(crossings[j] - crossings[j - 1] - lapMs) <= LAP_TIME_AGREES_WITHIN_MS,
			);
			return match?.lapMs ?? null;
		};

		const starts: number[] = [];
		const timed: TimedLap[] = [];
		const runEnds: number[] = [];
		for (let first = 0; first < crossings.length; ) {
			const sinceFirst = [0];
			const lapTimes: number[] = [];
			let last = first;
			for (let lapMs = lapEnding(last + 1); lapMs !== null; lapMs = lapEnding(last + 1)) {
				last++;
				lapTimes.push(lapMs);
				sinceFirst.push(sinceFirst[sinceFirst.length - 1] + lapMs);
			}
			const placings = sinceFirst.map((ms, k) => crossings[first + k] - ms).sort((a, b) => a - b);
			const middle = placings.length >> 1;
			const runStart = placings.length % 2 ? placings[middle] : (placings[middle - 1] + placings[middle]) / 2;
			starts.push(...sinceFirst.map((ms) => runStart + ms));
			timed.push(...lapTimes.map((lapMs, k) => ({ start: runStart + sinceFirst[k], lapMs })));
			runEnds.push(starts[starts.length - 1]);
			first = last + 1;
		}
		return { starts, timed, runEnds };
	}
}

// CarData channel 2 is speed in km/h.
const SPEED_CHANNEL = "2";

// One car's telemetry speed over time, about four readings a second.
class SpeedTrace {
	private t: number[] = [];
	private kmh: number[] = [];

	append(t: number, kmh: number | undefined): void {
		if (typeof kmh !== "number" || t <= (this.t[this.t.length - 1] ?? -Infinity)) return;
		this.t.push(t);
		this.kmh.push(kmh);
	}

	forgetBefore(feedMs: number): void {
		const drop = indexAtOrBefore(this.t, feedMs);
		if (drop < 1) return;
		this.t.splice(0, drop);
		this.kmh.splice(0, drop);
	}

	// Blended between the readings either side; unknown outside the readings or across a data gap.
	at(feedMs: number): number | null {
		const { t, kmh } = this;
		if (!t.length || feedMs < t[0] || feedMs > t[t.length - 1]) return null;
		const i = Math.min(indexAtOrBefore(t, feedMs), t.length - 2);
		if (i < 0) return kmh[0];
		if (t[i + 1] - t[i] > MAX_GLIDE_GAP_MS) return kmh[i];
		return kmh[i] + ((kmh[i + 1] - kmh[i]) * (feedMs - t[i])) / (t[i + 1] - t[i]);
	}
}

type Readings = { t: number[]; x: number[]; y: number[] };
type Reading = { t: number; x: number; y: number };

const readingsByCar = (session: ReplaySession): Map<string, Readings> => {
	const cars = new Map<string, Readings>();
	const add = (encoded: unknown) => {
		if (typeof encoded !== "string") return;
		for (const frame of inflate<Position>(encoded).Position) {
			const t = Date.parse(frame.Timestamp);
			for (const [driver, car] of Object.entries(frame.Entries)) {
				if (!car.X && !car.Y) continue;
				const readings = cars.get(driver) ?? { t: [], x: [], y: [] };
				if (readings.t.length && t <= readings.t[readings.t.length - 1]) continue;
				readings.t.push(t);
				readings.x.push(car.X);
				readings.y.push(car.Y);
				cars.set(driver, readings);
			}
		}
	};

	add(session.snapshots["Position.z"]);
	for (const [, topic, data] of session.updates) if (topic === "Position.z") add(data);
	return cars;
};

// One car: its path, and a timing fit centred on every reading.
class CarTrack {
	private t: number[] = [];
	private x: number[] = [];
	private y: number[] = [];
	private distance: number[] = [];
	private fits: (number[] | null)[] = [];
	// The newest live reading waits here until the one after it shows whether it stepped backwards.
	private pending: Reading | null = null;
	// Readings dropped by forgetBefore, so a reading keeps one number for the whole session.
	private dropped = 0;

	constructor(private readonly timingWindow: number) {}

	static recorded(recorded: Readings, timingWindow: number): CarTrack {
		const track = new CarTrack(timingWindow);
		const readings = withoutBackwardSteps(recorded);
		track.t = readings.t;
		track.x = readings.x;
		track.y = readings.y;
		track.distance = distanceAlongPath(readings.x, readings.y);
		track.fits = readings.t.map((_, i) => track.fitAt(i));
		return track;
	}

	ready(): boolean {
		return this.t.length > 0;
	}

	append(reading: Reading): void {
		if (reading.t <= (this.pending?.t ?? this.t[this.t.length - 1] ?? -Infinity)) return;

		const waiting = this.pending;
		this.pending = reading;
		if (!this.t.length) {
			this.keep(reading);
			this.pending = null;
			return;
		}
		if (!waiting || steppedBack(this.lastKept(), waiting, reading)) return;

		this.keep(waiting);
		// Only the fits whose window reaches the new reading change.
		const added = this.t.length - 1;
		const half = Math.floor(this.timingWindow / 2);
		for (let i = Math.max(0, added - half); i <= added; i++) this.fits[i] = this.fitAt(i);
	}

	forgetBefore(feedMs: number): void {
		if (this.t.length <= this.timingWindow) return;
		const drop = Math.min(indexAtOrBefore(this.t, feedMs), this.t.length - this.timingWindow);
		if (drop < 1) return;
		for (const list of [this.t, this.x, this.y, this.distance, this.fits]) list.splice(0, drop);
		this.dropped += drop;
	}

	// Times the car crossed `line`, scanning readings numbered from `from` on; answers them and the
	// number to scan from next time. The crossing point comes from the readings' places, which are
	// accurate; the moment comes from the timing fit, which irons out the timestamps' wobble.
	crossingsSince(line: FinishLine, from: number): { times: number[]; next: number } {
		const { t, x, y, distance } = this;
		// The newest readings' fits still wait on readings to come, so they are left for later.
		const settled = t.length - 1 - Math.floor(this.timingWindow / 2);
		const times: number[] = [];
		let i = Math.max(0, from - this.dropped);
		for (; i < settled; i++) {
			const before = (x[i] - line.x) * line.dx + (y[i] - line.y) * line.dy;
			const after = (x[i + 1] - line.x) * line.dx + (y[i + 1] - line.y) * line.dy;
			if (!(before < 0 && after >= 0) || t[i + 1] - t[i] > MAX_GLIDE_GAP_MS) continue;
			const across = Math.abs(-(x[i] - line.x) * line.dy + (y[i] - line.y) * line.dx);
			if (across > FINISH_LINE_REACH) continue;
			const along = distance[i] + ((distance[i + 1] - distance[i]) * -before) / (after - before);
			times.push(this.timeAtDistance(along, i));
		}
		return { times, next: Math.max(from, i + this.dropped) };
	}

	// The moment the timing fit puts the car `along` down its path, between readings i and i+1.
	private timeAtDistance(along: number, i: number): number {
		const { t } = this;
		const reached = (ms: number) => this.distanceAt(ms, indexAtOrBefore(t, ms)) - along;
		for (let widen = 0; widen <= 2; widen++) {
			let low = t[Math.max(0, i - widen)];
			let high = t[Math.min(t.length - 1, i + 1 + widen)];
			if (reached(low) > 0 || reached(high) < 0) continue;
			for (let step = 0; step < 30; step++) {
				const mid = (low + high) / 2;
				if (reached(mid) < 0) low = mid;
				else high = mid;
			}
			return (low + high) / 2;
		}
		const share = (along - this.distance[i]) / (this.distance[i + 1] - this.distance[i] || 1);
		return t[i] + (t[i + 1] - t[i]) * share;
	}

	// When the car's oldest kept reading was taken; Infinity before any.
	oldestMs(): number {
		return this.t[0] ?? Infinity;
	}

	// When the car's newest reading was taken; -Infinity before any.
	newestMs(): number {
		return this.t[this.t.length - 1] ?? -Infinity;
	}

	// The last moment, at or before `byMs` and no more than `lookbackMs` before it, that the car stood
	// still: the moment it moved off. Null when it never stood still in that time.
	movedOffAt(byMs: number, lookbackMs: number): number | null {
		const { t, distance } = this;
		for (let i = Math.min(indexAtOrBefore(t, byMs), t.length - 2); i >= 0 && t[i] >= byMs - lookbackMs; i--) {
			if (t[i] <= byMs && distance[i + 1] - distance[i] < STANDING_STILL) return t[i];
		}
		return null;
	}

	// How far the car had driven by `feedMs`, counted from its first reading of the session (readings
	// forgotten later keep their numbers). Null outside the readings kept or across a data gap.
	odometerAt(feedMs: number): number | null {
		const { t } = this;
		if (t.length < 2 || feedMs < t[0] || feedMs > t[t.length - 1]) return null;
		const i = indexAtOrBefore(t, feedMs);
		return t[i + 1] - t[i] > MAX_GLIDE_GAP_MS ? null : this.distanceAt(feedMs, i);
	}

	positionAt(feedMs: number): CarPoint {
		const { t, x, y } = this;
		const last = t.length - 1;
		if (feedMs <= t[0]) return { X: x[0], Y: y[0] };
		if (feedMs >= t[last]) return { X: x[last], Y: y[last] };

		const i = indexAtOrBefore(t, feedMs);
		if (t[i + 1] - t[i] > MAX_GLIDE_GAP_MS) return { X: x[i], Y: y[i] };

		return this.pointAtDistance(this.distanceAt(feedMs, i));
	}

	private lastKept(): Reading {
		const last = this.t.length - 1;
		return { t: this.t[last], x: this.x[last], y: this.y[last] };
	}

	private keep(reading: Reading): void {
		const { t, x, y, distance } = this;
		const last = t.length - 1;
		distance.push(last < 0 ? 0 : distance[last] + Math.hypot(reading.x - x[last], reading.y - y[last]));
		t.push(reading.t);
		x.push(reading.x);
		y.push(reading.y);
		this.fits.push(null);
	}

	// How far along its path the car is at `feedMs` (between readings i and i+1): every fit centred
	// within BLEND_MS of that instant, weighted by how close its centre is, so there is no seam where
	// the window moves on to the next reading.
	private distanceAt(feedMs: number, i: number): number {
		const { t, distance, fits } = this;
		let total = 0;
		let weightSum = 0;
		for (const step of [-1, 1]) {
			for (let k = step < 0 ? i : i + 1; k >= 0 && k < t.length; k += step) {
				const offsetMs = feedMs - t[k];
				if (Math.abs(offsetMs) >= BLEND_MS) break;
				const fit = fits[k];
				if (!fit) continue;
				const weight = tricube(offsetMs / BLEND_MS);
				total += weight * evaluate(fit, offsetMs / 1000);
				weightSum += weight;
			}
		}

		const share = (feedMs - t[i]) / (t[i + 1] - t[i]);
		const estimate = weightSum > 0 ? total / weightSum : distance[i] + (distance[i + 1] - distance[i]) * share;
		const low = distance[Math.max(0, i - GUARD_READINGS)];
		const high = distance[Math.min(distance.length - 1, i + 1 + GUARD_READINGS)];
		return Math.min(high, Math.max(low, estimate));
	}

	// The point `along` units down the path: a smooth curve through the readings, by distance.
	private pointAtDistance(along: number): CarPoint {
		const { x, y, distance } = this;
		const i = Math.min(indexAtOrBefore(distance, along), distance.length - 2);
		const span = distance[i + 1] - distance[i];
		if (span <= 0) return { X: x[i], Y: y[i] };

		const s = (along - distance[i]) / span;
		return { X: hermite(distance, x, i, s), Y: hermite(distance, y, i, s) };
	}

	// A cubic of distance against time (seconds from reading i), fitted to the `timingWindow`
	// readings around it and weighted towards the middle. Never reaches across a data gap.
	private fitAt(i: number): number[] | null {
		const { t, distance } = this;
		const half = Math.floor(this.timingWindow / 2);
		let from = i;
		while (from > 0 && i - from < half - 1 && t[from] - t[from - 1] <= MAX_GLIDE_GAP_MS) from--;
		let to = i;
		while (to < t.length - 1 && to - i < half && t[to + 1] - t[to] <= MAX_GLIDE_GAP_MS) to++;
		if (to - from < FIT_DEGREE) return null;

		const times = t.slice(from, to + 1).map((time) => (time - t[i]) / 1000);
		const reach = Math.max(Math.abs(times[0]), Math.abs(times[times.length - 1])) * 1.1;
		const weights = times.map((time) => tricube(time / reach));
		return fitPolynomial(times, distance.slice(from, to + 1), weights, FIT_DEGREE);
	}
}

// F1 occasionally reports a car a few units behind where it just was, which would make its dot
// twitch backwards. A reading is dropped when it steps against the direction from the previous kept
// reading to the next one. A car parked in the garage keeps its readings, since it is not moving.
const steppedBack = (kept: Reading, reading: Reading, next: Reading): boolean => {
	const travelX = next.x - kept.x;
	const travelY = next.y - kept.y;
	const backwards =
		(reading.x - kept.x) * travelX + (reading.y - kept.y) * travelY < 0 ||
		(next.x - reading.x) * travelX + (next.y - reading.y) * travelY < 0;
	const gap = next.t - reading.t > MAX_GLIDE_GAP_MS || reading.t - kept.t > MAX_GLIDE_GAP_MS;
	return backwards && !gap;
};

const withoutBackwardSteps = (readings: Readings): Readings => {
	const { t, x, y } = readings;
	const at = (k: number): Reading => ({ t: t[k], x: x[k], y: y[k] });
	const kept: Readings = { t: [t[0]], x: [x[0]], y: [y[0]] };
	for (let k = 1; k < t.length; k++) {
		const last = kept.t.length - 1;
		const isLast = k === t.length - 1;
		if (!isLast && steppedBack({ t: kept.t[last], x: kept.x[last], y: kept.y[last] }, at(k), at(k + 1))) continue;
		kept.t.push(t[k]);
		kept.x.push(x[k]);
		kept.y.push(y[k]);
	}
	return kept;
};

const distanceAlongPath = (x: number[], y: number[]): number[] => {
	const distance = new Array<number>(x.length).fill(0);
	for (let i = 1; i < x.length; i++) distance[i] = distance[i - 1] + Math.hypot(x[i] - x[i - 1], y[i] - y[i - 1]);
	return distance;
};

// Index of the last entry at or before `value` (the array is sorted ascending).
const indexAtOrBefore = (sorted: number[], value: number): number => {
	let low = 0;
	let high = sorted.length - 1;
	while (high - low > 1) {
		const mid = (low + high) >> 1;
		if (sorted[mid] <= value) low = mid;
		else high = mid;
	}
	return low;
};

const tricube = (u: number): number => {
	const a = 1 - Math.abs(u) ** 3;
	return a > 0 ? a * a * a : 0;
};

// Coefficients are lowest power first.
const evaluate = (coefficients: number[], at: number): number =>
	coefficients.reduceRight((total, coefficient) => total * at + coefficient, 0);

// Weighted least squares: solve the normal equations (AᵀWA)c = AᵀWv by Gauss-Jordan elimination.
// AᵀWA only holds sums of w·tᵖ, so those are gathered once per reading rather than per matrix cell.
const fitPolynomial = (times: number[], values: number[], weights: number[], degree: number): number[] | null => {
	const size = degree + 1;
	const powerSums = new Array<number>(2 * size - 1).fill(0);
	const valueSums = new Array<number>(size).fill(0);
	times.forEach((time, k) => {
		let power = weights[k];
		for (let p = 0; p < powerSums.length; p++) {
			powerSums[p] += power;
			if (p < size) valueSums[p] += power * values[k];
			power *= time;
		}
	});
	const matrix = Array.from({ length: size }, (_, row) => [
		...Array.from({ length: size }, (_, col) => powerSums[row + col]),
		valueSums[row],
	]);

	for (let col = 0; col < size; col++) {
		let pivot = col;
		for (let row = col + 1; row < size; row++) {
			if (Math.abs(matrix[row][col]) > Math.abs(matrix[pivot][col])) pivot = row;
		}
		if (Math.abs(matrix[pivot][col]) < 1e-12) return null;
		[matrix[col], matrix[pivot]] = [matrix[pivot], matrix[col]];
		for (let row = 0; row < size; row++) {
			if (row === col) continue;
			const factor = matrix[row][col] / matrix[col][col];
			for (let k = col; k <= size; k++) matrix[row][k] -= factor * matrix[col][k];
		}
	}
	return matrix.map((row, i) => row[size] / row[i]);
};

// Slope at entry i from its neighbours, allowing for uneven spacing.
const slope = (along: number[], v: number[], i: number): number => {
	const before = Math.max(0, i - 1);
	const after = Math.min(along.length - 1, i + 1);
	const span = along[after] - along[before];
	return span > 0 ? (v[after] - v[before]) / span : 0;
};

// Cubic Hermite between entries i and i+1: passes through both, and the direction carries smoothly
// across each reading instead of kinking as straight lines between readings would.
const hermite = (along: number[], v: number[], i: number, s: number): number => {
	const span = along[i + 1] - along[i];
	const s2 = s * s;
	const s3 = s2 * s;
	return (
		(2 * s3 - 3 * s2 + 1) * v[i] +
		(s3 - 2 * s2 + s) * span * slope(along, v, i) +
		(-2 * s3 + 3 * s2) * v[i + 1] +
		(s3 - s2) * span * slope(along, v, i + 1)
	);
};
