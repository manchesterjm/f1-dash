import { useMemo } from "react";

import { rotate } from "@/lib/map";
import { affineOf, satelliteImagery } from "@/lib/satellite";

type Props = {
	circuitKey: number;
	// The map's own display transform, so the imagery turns exactly as the track does.
	rotation: number;
	centerX: number;
	centerY: number;
	// The map's viewBox.
	minX: number;
	minY: number;
	width: number;
	height: number;
};

// Darkens the imagery so the track, its sector colours and the car dots stay the brightest things on the map.
const SHADE_OPACITY = 0.4;
const ATTRIBUTION_SIZE_OF_WIDTH = 0.014;

// Satellite imagery under the track map. Draws nothing for a circuit without a trusted fit.
export default function SatelliteBackdrop({
	circuitKey,
	rotation,
	centerX,
	centerY,
	minX,
	minY,
	width,
	height,
}: Props) {
	const imagery = useMemo(() => {
		const displayFromRaw = affineOf(({ x, y }) => rotate(x, y, rotation, centerX, centerY));
		return satelliteImagery(circuitKey, displayFromRaw, { minX, minY, width, height });
	}, [circuitKey, rotation, centerX, centerY, minX, minY, width, height]);

	if (!imagery) return null;

	const fontSize = width * ATTRIBUTION_SIZE_OF_WIDTH;

	return (
		<g>
			{imagery.images.map((image) => (
				<image
					key={image.key}
					href={image.href}
					width={image.width}
					height={image.height}
					preserveAspectRatio="none"
					transform={image.matrix}
				/>
			))}
			{/* Shades the letterbox beyond the box too, wherever the panel shows it. */}
			<rect
				x={minX - width}
				y={minY - height}
				width={width * 3}
				height={height * 3}
				fill="black"
				opacity={SHADE_OPACITY}
			/>
			<text x={minX + fontSize} y={minY + height - fontSize} fontSize={fontSize} className="fill-zinc-400">
				{imagery.attribution}
			</text>
		</g>
	);
}
