/**
 * Every Formula 1 race driver since 2018, keyed by the three-letter code the feed uses (VER, HAM).
 *
 * Replays reach back to 2018 (the start of F1's archive), so the dashboard needs to know drivers who are no longer
 * on the grid: their flag, and their name for the Favorite Drivers picker. F1's public feed declares
 * `Driver.CountryCode` in the DriverList schema but never sends it (verified during the 2026 Hungarian Grand Prix),
 * so nationality has to live here. Practice-only stand-ins are not listed. Add new race drivers when the grid changes.
 */

export type RosterDriver = {
	code: string;
	name: string;
	flag: string;
	country: string;
};

const ROSTER: Record<string, Omit<RosterDriver, "code">> = {
	AIT: { name: "Jack AITKEN", flag: "🇬🇧", country: "United Kingdom" },
	ALB: { name: "Alexander ALBON", flag: "🇹🇭", country: "Thailand" },
	ALO: { name: "Fernando ALONSO", flag: "🇪🇸", country: "Spain" },
	ANT: { name: "Kimi ANTONELLI", flag: "🇮🇹", country: "Italy" },
	BEA: { name: "Oliver BEARMAN", flag: "🇬🇧", country: "United Kingdom" },
	BOR: { name: "Gabriel BORTOLETO", flag: "🇧🇷", country: "Brazil" },
	BOT: { name: "Valtteri BOTTAS", flag: "🇫🇮", country: "Finland" },
	COL: { name: "Franco COLAPINTO", flag: "🇦🇷", country: "Argentina" },
	DEV: { name: "Nyck DE VRIES", flag: "🇳🇱", country: "Netherlands" },
	DOO: { name: "Jack DOOHAN", flag: "🇦🇺", country: "Australia" },
	ERI: { name: "Marcus ERICSSON", flag: "🇸🇪", country: "Sweden" },
	FIT: { name: "Pietro FITTIPALDI", flag: "🇧🇷", country: "Brazil" },
	GAS: { name: "Pierre GASLY", flag: "🇫🇷", country: "France" },
	GIO: { name: "Antonio GIOVINAZZI", flag: "🇮🇹", country: "Italy" },
	GRO: { name: "Romain GROSJEAN", flag: "🇫🇷", country: "France" },
	HAD: { name: "Isack HADJAR", flag: "🇫🇷", country: "France" },
	HAM: { name: "Lewis HAMILTON", flag: "🇬🇧", country: "United Kingdom" },
	HAR: { name: "Brendon HARTLEY", flag: "🇳🇿", country: "New Zealand" },
	HUL: { name: "Nico HULKENBERG", flag: "🇩🇪", country: "Germany" },
	KUB: { name: "Robert KUBICA", flag: "🇵🇱", country: "Poland" },
	KVY: { name: "Daniil KVYAT", flag: "🇷🇺", country: "Russia" },
	LAT: { name: "Nicholas LATIFI", flag: "🇨🇦", country: "Canada" },
	LAW: { name: "Liam LAWSON", flag: "🇳🇿", country: "New Zealand" },
	LEC: { name: "Charles LECLERC", flag: "🇲🇨", country: "Monaco" },
	LIN: { name: "Arvid LINDBLAD", flag: "🇬🇧", country: "United Kingdom" },
	MAG: { name: "Kevin MAGNUSSEN", flag: "🇩🇰", country: "Denmark" },
	MAZ: { name: "Nikita MAZEPIN", flag: "🇷🇺", country: "Russia" },
	MSC: { name: "Mick SCHUMACHER", flag: "🇩🇪", country: "Germany" },
	NOR: { name: "Lando NORRIS", flag: "🇬🇧", country: "United Kingdom" },
	OCO: { name: "Esteban OCON", flag: "🇫🇷", country: "France" },
	PER: { name: "Sergio PEREZ", flag: "🇲🇽", country: "Mexico" },
	PIA: { name: "Oscar PIASTRI", flag: "🇦🇺", country: "Australia" },
	RAI: { name: "Kimi RAIKKONEN", flag: "🇫🇮", country: "Finland" },
	RIC: { name: "Daniel RICCIARDO", flag: "🇦🇺", country: "Australia" },
	RUS: { name: "George RUSSELL", flag: "🇬🇧", country: "United Kingdom" },
	SAI: { name: "Carlos SAINZ", flag: "🇪🇸", country: "Spain" },
	SAR: { name: "Logan SARGEANT", flag: "🇺🇸", country: "United States" },
	SIR: { name: "Sergey SIROTKIN", flag: "🇷🇺", country: "Russia" },
	STR: { name: "Lance STROLL", flag: "🇨🇦", country: "Canada" },
	TSU: { name: "Yuki TSUNODA", flag: "🇯🇵", country: "Japan" },
	VAN: { name: "Stoffel VANDOORNE", flag: "🇧🇪", country: "Belgium" },
	VER: { name: "Max VERSTAPPEN", flag: "🇳🇱", country: "Netherlands" },
	VET: { name: "Sebastian VETTEL", flag: "🇩🇪", country: "Germany" },
	ZHO: { name: "Guanyu ZHOU", flag: "🇨🇳", country: "China" },
};

/** The roster entry for a driver's three-letter code, or undefined if we don't know them. */
export const rosterDriver = (code: string | undefined): RosterDriver | undefined => {
	const key = code?.toUpperCase();
	const known = key ? ROSTER[key] : undefined;
	return known && key ? { code: key, ...known } : undefined;
};

/** Every driver on the roster, by name. */
export const everyRosterDriver = (): RosterDriver[] =>
	Object.entries(ROSTER)
		.map(([code, known]) => ({ code, ...known }))
		.sort((a, b) => a.name.localeCompare(b.name));
