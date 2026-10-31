import { rosterDriver } from "@/lib/driverRoster";

/** Flag emoji for a driver's three-letter abbreviation, or undefined if we don't know them yet. */
export const flagFor = (abbreviation: string | undefined): string | undefined => rosterDriver(abbreviation)?.flag;

/** Country name for a driver's three-letter abbreviation — used as the flag's hover text. */
export const countryFor = (abbreviation: string | undefined): string | undefined =>
	rosterDriver(abbreviation)?.country;
