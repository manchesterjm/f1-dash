// Speed bubbles above favourite drivers' dots. Each bubble sits centred above its own dot; when two
// would touch, they are laid side by side instead, in the left-to-right order of their dots, and each
// keeps a tail back to its own dot. Sizes are in track-map units (a dot's radius is 120).

// Three lines: time into the lap ("1:32.45"), the projected lap time with its gap to the best lap
// ("1:31.80 −0.37"), then the speed. Wide enough for the projected line, the longest of the three.
export const BUBBLE_WIDTH = 1750;
export const BUBBLE_HEIGHT = 1100;
// Centre-to-centre spacing of the lines.
export const BUBBLE_LINE_PITCH = 340;
// Clear of the dot and of the driver's name, which sits up and to the right of it: the bubble's
// bottom edge stays where it was with two lines.
export const BUBBLE_RISE = 1070;
const BUBBLE_GAP = 60;

export type BubbleAnchor = { driver: string; x: number; y: number };
// Centre of each driver's bubble.
export type BubblePlacement = { driver: string; x: number; y: number };

type Row = { members: BubbleAnchor[]; centreX: number; centreY: number; width: number };

const rowOf = (members: BubbleAnchor[]): Row => {
	const ordered = [...members].sort((a, b) => a.x - b.x);
	return {
		members: ordered,
		centreX: ordered.reduce((sum, anchor) => sum + anchor.x, 0) / ordered.length,
		// The row sits at the height of its highest dot, so no bubble lands on a dot below it.
		centreY: Math.min(...ordered.map((anchor) => anchor.y)) - BUBBLE_RISE,
		width: ordered.length * BUBBLE_WIDTH + (ordered.length - 1) * BUBBLE_GAP,
	};
};

const rowsTouch = (a: Row, b: Row): boolean =>
	Math.abs(a.centreX - b.centreX) < (a.width + b.width) / 2 + BUBBLE_GAP &&
	Math.abs(a.centreY - b.centreY) < BUBBLE_HEIGHT + BUBBLE_GAP;

export function layOutSpeedBubbles(anchors: BubbleAnchor[]): BubblePlacement[] {
	let rows = anchors.map((anchor) => rowOf([anchor]));

	// Merging two rows widens them, which can make them touch a third, so repeat until nothing touches.
	for (let merged = true; merged; ) {
		merged = false;
		for (let i = 0; i < rows.length && !merged; i++) {
			for (let j = i + 1; j < rows.length && !merged; j++) {
				if (!rowsTouch(rows[i], rows[j])) continue;
				const joined = rowOf([...rows[i].members, ...rows[j].members]);
				rows = [...rows.filter((_, k) => k !== i && k !== j), joined];
				merged = true;
			}
		}
	}

	return rows.flatMap((row) =>
		row.members.map((anchor, slot) => ({
			driver: anchor.driver,
			x: row.centreX - row.width / 2 + BUBBLE_WIDTH / 2 + slot * (BUBBLE_WIDTH + BUBBLE_GAP),
			y: row.centreY,
		})),
	);
}
