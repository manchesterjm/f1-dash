"use client";

// Leaves a replay for the live feed.
export default function LiveButton({ onClick }: { onClick: () => void }) {
	return (
		<button
			onClick={onClick}
			className="flex shrink-0 items-center gap-1.5 rounded-md bg-zinc-800 px-2 py-1 text-sm font-medium hover:bg-zinc-700"
		>
			<span className="size-2 rounded-full bg-red-600" />
			Live
		</button>
	);
}
