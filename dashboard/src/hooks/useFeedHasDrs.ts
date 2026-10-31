import { useDataStore } from "@/stores/useDataStore";

// Car telemetry channel 45 is the DRS flap. F1 stopped sending it in 2026, when active aero replaced DRS, so the
// DRS badge only earns its column in sessions whose cars still report it (the 2018-2025 replays).
export const useFeedHasDrs = (): boolean =>
	useDataStore((state) => Object.values(state.carsData ?? {}).some((car) => car.Channels[45] !== undefined));
