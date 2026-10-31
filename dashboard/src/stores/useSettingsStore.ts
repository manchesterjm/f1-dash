import { persist, createJSONStorage, subscribeWithSelector } from "zustand/middleware";
import { create } from "zustand";

type SpeedUnit = "metric" | "imperial";

// Favorites used to be kept by car number, but numbers move between drivers from year to year (#3 was Ricciardo
// in 2021 and is Verstappen in 2026), so a replay highlighted the wrong car. They are kept by the driver's
// three-letter code now. Saved numbers were picked from the 2026 grid, so that grid translates them once.
const GRID_2026_BY_NUMBER: Record<string, string> = {
	"1": "NOR", "3": "VER", "5": "BOR", "6": "HAD", "10": "GAS", "11": "PER", "12": "ANT", "14": "ALO", "16": "LEC",
	"18": "STR", "23": "ALB", "27": "HUL", "30": "LAW", "31": "OCO", "41": "LIN", "43": "COL", "44": "HAM",
	"55": "SAI", "63": "RUS", "77": "BOT", "81": "PIA", "87": "BEA",
};

const favoritesByCode = (numbers: string[]): string[] =>
	numbers.map((number) => GRID_2026_BY_NUMBER[number]).filter((code): code is string => code !== undefined);

type SettingsStore = {
	delay: number;
	setDelay: (delay: number) => void;

	speedUnit: SpeedUnit;
	setSpeedUnit: (speedUnit: SpeedUnit) => void;

	showCornerNumbers: boolean;
	setShowCornerNumbers: (showCornerNumbers: boolean) => void;

	showMiniSectorTicks: boolean;
	setShowMiniSectorTicks: (showMiniSectorTicks: boolean) => void;

	showSatellite: boolean;
	setShowSatellite: (showSatellite: boolean) => void;

	carMetrics: boolean;
	setCarMetrics: (carMetrics: boolean) => void;

	tableHeaders: boolean;
	setTableHeaders: (tableHeaders: boolean) => void;

	showBestSectors: boolean;
	setShowBestSectors: (showBestSectors: boolean) => void;

	showMiniSectors: boolean;
	setShowMiniSectors: (showMiniSectors: boolean) => void;

	oledMode: boolean;
	setOledMode: (oledMode: boolean) => void;

	useSafetyCarColors: boolean;
	setUseSafetyCarColors: (useSafetyCarColors: boolean) => void;

	// Three-letter driver codes (VER, HAM), the one name a driver keeps across seasons.
	favoriteDrivers: string[];
	setFavoriteDrivers: (favoriteDrivers: string[]) => void;
	removeFavoriteDriver: (driver: string) => void;

	raceControlChime: boolean;
	setRaceControlChime: (raceControlChime: boolean) => void;

	raceControlChimeVolume: number;
	setRaceControlChimeVolume: (raceControlChimeVolume: number) => void;

	delayIsPaused: boolean;
	setDelayIsPaused: (delayIsPaused: boolean) => void;
};

export const useSettingsStore = create<SettingsStore>()(
	subscribeWithSelector(
		persist(
			(set) => ({
				delay: 0,
				setDelay: (delay: number) => set({ delay }),

				speedUnit: "metric",
				setSpeedUnit: (speedUnit: SpeedUnit) => set({ speedUnit }),

				showCornerNumbers: false,
				setShowCornerNumbers: (showCornerNumbers: boolean) => set({ showCornerNumbers }),

				showMiniSectorTicks: false,
				setShowMiniSectorTicks: (showMiniSectorTicks: boolean) => set({ showMiniSectorTicks }),

				showSatellite: false,
				setShowSatellite: (showSatellite: boolean) => set({ showSatellite }),

				carMetrics: false,
				setCarMetrics: (carMetrics: boolean) => set({ carMetrics }),

				tableHeaders: false,
				setTableHeaders: (tableHeaders: boolean) => set({ tableHeaders }),

				showBestSectors: true,
				setShowBestSectors: (showBestSectors: boolean) => set({ showBestSectors }),

				showMiniSectors: true,
				setShowMiniSectors: (showMiniSectors: boolean) => set({ showMiniSectors }),

				oledMode: false,
				setOledMode: (oledMode: boolean) => set({ oledMode }),

				useSafetyCarColors: true,
				setUseSafetyCarColors: (useSafetyCarColors: boolean) => set({ useSafetyCarColors }),

				favoriteDrivers: [],
				setFavoriteDrivers: (favoriteDrivers: string[]) => set({ favoriteDrivers }),
				removeFavoriteDriver: (driver: string) =>
					set((state) => ({ favoriteDrivers: state.favoriteDrivers.filter((d) => d !== driver) })),

				raceControlChime: false,
				setRaceControlChime: (raceControlChime: boolean) => set({ raceControlChime }),

				raceControlChimeVolume: 50,
				setRaceControlChimeVolume: (raceControlChimeVolume: number) => set({ raceControlChimeVolume }),

				delayIsPaused: true,
				setDelayIsPaused: (delayIsPaused: boolean) => set({ delayIsPaused }),
			}),
			{
				name: "settings-storage",
				storage: createJSONStorage(() => localStorage),
				version: 1,
				migrate: (persisted, version) => {
					const saved = persisted as Partial<SettingsStore>;
					if (version < 1 && saved.favoriteDrivers) return { ...saved, favoriteDrivers: favoritesByCode(saved.favoriteDrivers) };
					return saved;
				},
				onRehydrateStorage: (state) => {
					return () => state.setDelayIsPaused(false);
				},
			},
		),
	),
);
