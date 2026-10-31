import georefs from "@/data/track-georef.json";

// Satellite imagery under the track map.
//
// Every circuit outline is in its own flat frame of decimetres. track-georef.json holds, per circuit,
// the similarity transform that lays that frame onto Web Mercator (EPSG:3857) metres, fitted against
// OpenStreetMap's racing-line ways (/mnt/win-d/Projects/f1-dash_fallback_maps/satellite_georef_2026-10-30).
// Imagery tiles are cut in that same Mercator frame, so one affine map per tile carries its pixels
// straight onto the dashboard's rotated display frame.

// An affine map of the plane in SVG matrix() order: x' = a·x + c·y + e, y' = b·x + d·y + f.
export type Affine = [number, number, number, number, number, number];

type Point = { x: number; y: number };

type Georef = {
	rawToMercator: Affine;
	good: boolean;
};

export type SatelliteTile = {
	href: string;
	matrix: string;
	key: string;
	width: number;
	height: number;
};

// A circuit whose local GIS imagery beats Esri's (newer or sharper), as an ArcGIS MapServer export.
// Compared by eye against Esri over the same patch of track before being listed here.
type LocalImagery = {
	exportUrl: string;
	attribution: string;
	maxPixels: number;
};

const LOCAL_IMAGERY: Record<string, LocalImagery> = {
	// Miami-Dade County's 2025 flight, newer than Esri's at Hard Rock Stadium (compared 2026-10-31).
	// Its cache is not on the standard Web Mercator tile grid, so one export covers the whole view.
	"151": {
		exportUrl: "https://gisweb.miamidade.gov/arcgis/rest/services/MapCache/MDCImagery_WebMercator/MapServer/export",
		attribution: "Imagery © Miami-Dade County",
		maxPixels: 4096,
	},
};

const EARTH_RADIUS_M = 6378137;
const WORLD_M = 2 * Math.PI * EARTH_RADIUS_M;
const TILE_PX = 256;
// Esri World Imagery. Its terms ask for the attribution below wherever the imagery is shown.
const TILE_URL = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile";
const IMAGERY_ATTRIBUTION = "Imagery © Esri, Maxar, Earthstar Geographics";

// Enough pixels across the map's box to stay sharp on a full-width 1440p panel.
const TARGET_PIXELS_ACROSS = 1600;
const MIN_ZOOM = 12;
const MAX_ZOOM = 18;
// Imagery reaches this far past the map's box on every side, because the panel letterboxes the box and
// shows whatever lies beyond its short sides.
const COVER_BEYOND_BOX = 0.5;
// Each tile is drawn this much wider than its 256 px, so neighbours overlap instead of leaving a hairline seam.
const SEAM_OVERLAP_PX = 0.6;

const GEOREFS = georefs as unknown as Record<string, Georef>;

export const apply = ([a, b, c, d, e, f]: Affine, { x, y }: Point): Point => ({
	x: a * x + c * y + e,
	y: b * x + d * y + f,
});

// outer ∘ inner: apply inner first.
export const compose = (outer: Affine, inner: Affine): Affine => {
	const [a, b, c, d, e, f] = outer;
	const [p, q, r, s, t, u] = inner;
	return [a * p + c * q, b * p + d * q, a * r + c * s, b * r + d * s, a * t + c * u + e, b * t + d * u + f];
};

export const invert = ([a, b, c, d, e, f]: Affine): Affine => {
	const det = a * d - b * c;
	return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
};

// The affine map a point function performs, read off from where it sends the origin and the two unit steps.
// Used on the map's own rotate(), so the imagery can never disagree with how the track is drawn.
export const affineOf = (transform: (point: Point) => Point): Affine => {
	const origin = transform({ x: 0, y: 0 });
	const alongX = transform({ x: 1, y: 0 });
	const alongY = transform({ x: 0, y: 1 });
	return [alongX.x - origin.x, alongX.y - origin.y, alongY.x - origin.x, alongY.y - origin.y, origin.x, origin.y];
};

// The circuit's fit onto Mercator, or null when there is none or it was not close enough to trust.
export const trackGeoref = (circuitKey: number): Affine | null => {
	const georef = GEOREFS[String(circuitKey)];
	return georef?.good ? georef.rawToMercator : null;
};

type Box = { minX: number; minY: number; width: number; height: number };

const distance = (from: Point, to: Point) => Math.hypot(to.x - from.x, to.y - from.y);

// The zoom level at which `mercatorMetres` spans about TARGET_PIXELS_ACROSS imagery pixels.
const zoomToSpan = (mercatorMetres: number) =>
	Math.min(
		MAX_ZOOM,
		Math.max(MIN_ZOOM, Math.round(Math.log2((TARGET_PIXELS_ACROSS * WORLD_M) / (TILE_PX * mercatorMetres)))),
	);

type Cover = {
	displayFromMercator: Affine;
	west: number;
	east: number;
	south: number;
	north: number;
	// Mercator metres across the map's box itself, which sets how sharp the imagery needs to be.
	boxAcross: number;
};

// The Mercator rectangle the imagery must cover for a display box, and how to carry Mercator into the display.
function coverFor(rawToMercator: Affine, displayFromRaw: Affine, box: Box): Cover {
	const displayFromMercator = compose(displayFromRaw, invert(rawToMercator));
	const mercatorFromDisplay = invert(displayFromMercator);

	const padX = box.width * COVER_BEYOND_BOX;
	const padY = box.height * COVER_BEYOND_BOX;
	const corners = [
		{ x: box.minX - padX, y: box.minY - padY },
		{ x: box.minX + box.width + padX, y: box.minY - padY },
		{ x: box.minX - padX, y: box.minY + box.height + padY },
		{ x: box.minX + box.width + padX, y: box.minY + box.height + padY },
	].map((corner) => apply(mercatorFromDisplay, corner));

	return {
		displayFromMercator,
		west: Math.min(...corners.map((c) => c.x)),
		east: Math.max(...corners.map((c) => c.x)),
		south: Math.min(...corners.map((c) => c.y)),
		north: Math.max(...corners.map((c) => c.y)),
		boxAcross: distance(
			apply(mercatorFromDisplay, { x: box.minX, y: box.minY }),
			apply(mercatorFromDisplay, { x: box.minX + box.width, y: box.minY }),
		),
	};
}

// Esri's tiles covering a display box, each with the matrix that places it in the display frame.
function esriTiles({ displayFromMercator, west, east, south, north, boxAcross }: Cover): SatelliteTile[] {
	const zoom = zoomToSpan(boxAcross);

	const tileM = WORLD_M / 2 ** zoom;
	const metresPerPixel = tileM / TILE_PX;
	const firstColumn = Math.floor((west + WORLD_M / 2) / tileM);
	const lastColumn = Math.floor((east + WORLD_M / 2) / tileM);
	const firstRow = Math.floor((WORLD_M / 2 - north) / tileM);
	const lastRow = Math.floor((WORLD_M / 2 - south) / tileM);

	const tiles: SatelliteTile[] = [];
	for (let column = firstColumn; column <= lastColumn; column++) {
		for (let row = firstRow; row <= lastRow; row++) {
			// Tile pixels (right, down) to Mercator metres (east, north) from the tile's top-left corner.
			const mercatorFromPixel: Affine = [
				metresPerPixel,
				0,
				0,
				-metresPerPixel,
				column * tileM - WORLD_M / 2,
				WORLD_M / 2 - row * tileM,
			];
			tiles.push({
				key: `${zoom}/${column}/${row}`,
				href: `${TILE_URL}/${zoom}/${row}/${column}`,
				matrix: `matrix(${compose(displayFromMercator, mercatorFromPixel).join(" ")})`,
				width: TILE_PX + SEAM_OVERLAP_PX,
				height: TILE_PX + SEAM_OVERLAP_PX,
			});
		}
	}
	return tiles;
}

// One exported image of the local imagery over the whole cover, as sharp as the tiles, within the server's limit.
function localExport({ displayFromMercator, west, east, south, north, boxAcross }: Cover, local: LocalImagery) {
	const across = east - west;
	const down = north - south;
	const wanted = TARGET_PIXELS_ACROSS / boxAcross;
	const pixelsPerMetre = Math.min(wanted, local.maxPixels / Math.max(across, down));
	const width = Math.round(across * pixelsPerMetre);
	const height = Math.round(down * pixelsPerMetre);
	// Image pixels (right, down) to Mercator metres (east, north) from the image's top-left corner.
	const mercatorFromPixel: Affine = [across / width, 0, 0, -down / height, west, north];
	const query = new URLSearchParams({
		bbox: [west, south, east, north].join(","),
		bboxSR: "3857",
		imageSR: "3857",
		size: `${width},${height}`,
		format: "jpg",
		f: "image",
	});
	return {
		key: `local/${query.get("bbox")}`,
		href: `${local.exportUrl}?${query}`,
		matrix: `matrix(${compose(displayFromMercator, mercatorFromPixel).join(" ")})`,
		width,
		height,
	};
}

export type SatelliteImagery = {
	images: SatelliteTile[];
	attribution: string;
};

// The imagery for a circuit's display box, in drawing order, or null without a trusted fit.
// A circuit with better local imagery still gets Esri's tiles underneath, so the map is never bare while
// the larger local export loads.
export function satelliteImagery(circuitKey: number, displayFromRaw: Affine, box: Box): SatelliteImagery | null {
	const rawToMercator = trackGeoref(circuitKey);
	if (!rawToMercator) return null;
	const cover = coverFor(rawToMercator, displayFromRaw, box);
	const tiles = esriTiles(cover);
	const local = LOCAL_IMAGERY[String(circuitKey)];
	if (!local) return { images: tiles, attribution: IMAGERY_ATTRIBUTION };
	return { images: [...tiles, localExport(cover, local)], attribution: local.attribution };
}
