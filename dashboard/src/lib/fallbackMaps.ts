import type { Map } from "@/types/map.type";

import madring from "@/data/fallback-maps/madring.json";

// Circuits MultiViewer has no outline for yet, built locally in MultiViewer's format. They are only
// used when its API has nothing for a circuit, so its own map takes over as soon as it publishes one.
//
// Madring (Madrid, first raced 2026): outline from OpenStreetMap relation 18813472, © OpenStreetMap
// contributors, ODbL. The timing line (index 0) and turn numbers come from registering F1's official
// circuit map onto that outline (mean fit 3.4 m); its sector colours meet at that line. Resampled every
// 7.5 m, in decimetres like MultiViewer's maps.
const FALLBACK_MAPS: Record<number, Map> = {
	[madring.circuitKey]: madring,
};

export const fallbackMap = (circuitKey: number): Map | null => FALLBACK_MAPS[circuitKey] ?? null;
