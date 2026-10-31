import type { Map } from "@/types/map.type";

import madring from "@/data/fallback-maps/madring.json";
import sepang from "@/data/fallback-maps/sepang.json";
import austinPitLane from "@/data/pit-lanes/austin.json";
import mexicoPitLane from "@/data/pit-lanes/mexico.json";
import singaporePitLane from "@/data/pit-lanes/singapore.json";
import suzukaPitLane from "@/data/pit-lanes/suzuka.json";

// Circuits MultiViewer has no outline for yet, built locally in MultiViewer's format. They are only
// used when its API has nothing for a circuit, so its own map takes over as soon as it publishes one.
//
// Madring (Madrid, first raced 2026): outline from OpenStreetMap relation 18813472, © OpenStreetMap
// contributors, ODbL. The timing line (index 0) and turn numbers come from registering F1's official
// circuit map onto that outline (mean fit 3.4 m); its sector colours meet at that line. Resampled every
// 7.5 m, in decimetres like MultiViewer's maps.
//
// Sepang (Bahrain GP relocated to Malaysia, 2026): MultiViewer has no circuit 12. Traced from F1's own
// Position.z feed (Leclerc's fastest FP2 lap, 97.528 s), so it shares the live dots' coordinate frame.
// F1's official circuit map (formula1.com 2026trackkualalumpurdetailed) registered onto it (mean fit 3.9 m)
// supplies the timing line (index 0), T1-T15 and the rotation. The 19 marshal sectors start at the FIA light
// panels on the FIA's event circuit map ("16BRN - Maps", Race Director document 7), fitted the same way.
const FALLBACK_MAPS: Record<number, Map> = {
	[madring.circuitKey]: madring,
	[sepang.circuitKey]: sepang,
};

export const fallbackMap = (circuitKey: number): Map | null => FALLBACK_MAPS[circuitKey] ?? null;

// Pit lanes for circuits whose outline comes from MultiViewer, which publishes no pit lane. Traced the
// same way as Sepang's: the median offset of F1's own Position.z points beside the track, so they share
// MultiViewer's (= the live dots') coordinate frame.
//
// Singapore (key 61): from every car in 2026 FP1, lane 735 m, median 2.8 m from the cars' points.
// Austin (key 9): from every car in 2025 US GP FP1, lane 715 m, median 2.0 m from the cars' points. The entry
// leaves the inside of the Turn 20 hairpin, so it is fitted along the lane rather than offset from the outline.
// Suzuka (key 46): from every car in the 2026 Japanese GP race, lane 845 m, median 2.0 m from the cars' points,
// fitted along the lane like Austin's.
const PIT_LANES: Record<number, NonNullable<Map["pitLane"]>> = {
	9: austinPitLane,
	46: suzukaPitLane,
	61: singaporePitLane,
	65: mexicoPitLane,
};

export const withPitLane = (map: Map): Map =>
	map.pitLane || !PIT_LANES[map.circuitKey] ? map : { ...map, pitLane: PIT_LANES[map.circuitKey] };
