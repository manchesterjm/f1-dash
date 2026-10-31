"use client";

import { useEffect, useState } from "react";
import { motion } from "motion/react";
import Image from "next/image";

import xIcon from "public/icons/xmark.svg";

import type { Driver } from "@/types/state.type";

import { env } from "@/env";
import { useSettingsStore } from "@/stores/useSettingsStore";
import { everyRosterDriver, rosterDriver } from "@/lib/driverRoster";

import DriverTag from "@/components/driver/DriverTag";
import SelectMultiple from "@/components/ui/SelectMultiple";

// A driver who is no longer on the grid has no team colour in today's feed.
const PAST_DRIVER_COLOUR = "71717A";

// Today's grid first (with its team colours), then everyone else since 2018. Favorites are kept by driver code, so
// a retired driver is highlighted in any replay of a season they raced.
const pickerOptions = (onGrid: Driver[]) => {
	const gridCodes = new Set(onGrid.map((driver) => driver.Tla));
	return [
		...onGrid.map((driver) => ({ label: driver.FullName, value: driver.Tla })),
		...everyRosterDriver()
			.filter((driver) => !gridCodes.has(driver.code))
			.map((driver) => ({ label: driver.name, value: driver.code })),
	];
};

export default function FavoriteDrivers() {
	const [drivers, setDrivers] = useState<Driver[] | null>(null);

	// TODO handle loading state
	// TODO handle error state
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	const [error, setError] = useState<string | null>(null);

	const { favoriteDrivers, setFavoriteDrivers, removeFavoriteDriver } = useSettingsStore();

	useEffect(() => {
		(async () => {
			try {
				const res = await fetch(`${env.NEXT_PUBLIC_LIVE_URL}/api/drivers`);
				const data = await res.json();
				setDrivers(data);
			} catch {
				setError("failed to fetch favorite drivers");
			}
		})();
	}, []);

	return (
		<div className="flex flex-col gap-2">
			<div className="flex flex-wrap gap-2">
				{favoriteDrivers.map((driverCode) => {
					const driver = drivers?.find((d) => d.Tla === driverCode);

					if (!driver && !rosterDriver(driverCode)) return null;

					return (
						<div key={driverCode} className="flex items-center gap-1 rounded-xl border border-zinc-800 p-1">
							<DriverTag teamColor={driver?.TeamColour ?? PAST_DRIVER_COLOUR} short={driverCode} />

							<motion.button
								whileHover={{ scale: 1.05 }}
								whileTap={{ scale: 0.95 }}
								onClick={() => removeFavoriteDriver(driverCode)}
							>
								<Image src={xIcon} alt="x" width={30} />
							</motion.button>
						</div>
					);
				})}
			</div>

			<div className="w-80">
				<SelectMultiple
					placeholder="Select favorite drivers"
					options={pickerOptions(drivers ?? [])}
					selected={favoriteDrivers}
					setSelected={setFavoriteDrivers}
				/>
			</div>
		</div>
	);
}
