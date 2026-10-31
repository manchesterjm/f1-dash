import clsx from "clsx";

import { countryFor, flagFor } from "@/lib/driverFlags";

type Props = {
	teamColor: string;
	short: string;
	position?: number;
	className?: string;
};

// Some teams' colour is (near) white - Haas was FFFFFF in 2021 - which made the white position number and the
// team-coloured code on the white chip vanish. Those tags flip to dark text and a dark chip.
const isPale = (hex: string): boolean => {
	const rgb = hex.match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
	if (!rgb) return false;
	const [r, g, b] = rgb.slice(1).map((channel) => parseInt(channel, 16));
	return 0.299 * r + 0.587 * g + 0.114 * b > 200;
};

export default function DriverTag({ position, teamColor, short, className }: Props) {
	const flag = flagFor(short);
	const pale = !!teamColor && isPale(teamColor);

	return (
		<div
			id="walkthrough-driver-position"
			className={clsx(
				"flex w-fit items-center justify-between gap-0.5 rounded-lg bg-zinc-500 px-1 py-1 font-black",
				className,
			)}
			style={{ backgroundColor: `#${teamColor}` }}
		>
			{position && <p className={clsx("px-1 text-xl leading-none", { "text-zinc-900": pale })}>{position}</p>}

			{flag && (
				<span className="text-base leading-none" title={countryFor(short)}>
					{flag}
				</span>
			)}

			<div className={clsx("flex h-min w-min items-center justify-center rounded-md px-1", pale ? "bg-zinc-900" : "bg-white")}>
				<p className="font-mono text-zinc-500" style={{ ...(teamColor && { color: `#${teamColor}` }) }}>
					{short}
				</p>
			</div>
		</div>
	);
}
