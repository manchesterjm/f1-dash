/**
 * Driver nationality, held locally.
 *
 * F1's public feed declares `Driver.CountryCode` in the DriverList schema but never sends it —
 * verified against the live feed during the 2026 Hungarian Grand Prix, where the key is absent
 * from every DriverList entry. Nationality therefore has to live here, keyed by the three-letter
 * abbreviation the feed does provide. Update this table when the grid changes.
 */

type Nationality = {
	flag: string;
	country: string;
};

const NATIONALITY_BY_ABBREVIATION: Record<string, Nationality> = {
	ALB: { flag: "🇹🇭", country: "Thailand" },
	ALO: { flag: "🇪🇸", country: "Spain" },
	ANT: { flag: "🇮🇹", country: "Italy" },
	BEA: { flag: "🇬🇧", country: "United Kingdom" },
	BOR: { flag: "🇧🇷", country: "Brazil" },
	BOT: { flag: "🇫🇮", country: "Finland" },
	COL: { flag: "🇦🇷", country: "Argentina" },
	GAS: { flag: "🇫🇷", country: "France" },
	HAD: { flag: "🇫🇷", country: "France" },
	HAM: { flag: "🇬🇧", country: "United Kingdom" },
	HUL: { flag: "🇩🇪", country: "Germany" },
	LAW: { flag: "🇳🇿", country: "New Zealand" },
	LEC: { flag: "🇲🇨", country: "Monaco" },
	LIN: { flag: "🇬🇧", country: "United Kingdom" },
	NOR: { flag: "🇬🇧", country: "United Kingdom" },
	OCO: { flag: "🇫🇷", country: "France" },
	PER: { flag: "🇲🇽", country: "Mexico" },
	PIA: { flag: "🇦🇺", country: "Australia" },
	RUS: { flag: "🇬🇧", country: "United Kingdom" },
	SAI: { flag: "🇪🇸", country: "Spain" },
	STR: { flag: "🇨🇦", country: "Canada" },
	VER: { flag: "🇳🇱", country: "Netherlands" },
};

const nationalityOf = (abbreviation: string | undefined): Nationality | undefined =>
	abbreviation ? NATIONALITY_BY_ABBREVIATION[abbreviation.toUpperCase()] : undefined;

/** Flag emoji for a driver's three-letter abbreviation, or undefined if we don't know them yet. */
export const flagFor = (abbreviation: string | undefined): string | undefined => nationalityOf(abbreviation)?.flag;

/** Country name for a driver's three-letter abbreviation — used as the flag's hover text. */
export const countryFor = (abbreviation: string | undefined): string | undefined =>
	nationalityOf(abbreviation)?.country;
