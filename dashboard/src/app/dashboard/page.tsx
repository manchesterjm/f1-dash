"use client";

import LeaderBoard from "@/components/dashboard/LeaderBoard";
import RaceControl from "@/components/dashboard/RaceControl";
import TeamRadios from "@/components/dashboard/TeamRadios";
import TrackViolations from "@/components/dashboard/TrackViolations";
import Map from "@/components/dashboard/Map";
import Footer from "@/components/Footer";

export default function Page() {
	return (
		<div className="flex w-full flex-col gap-2">
			<div className="flex w-full flex-col gap-2 2xl:flex-row">
				<div className="overflow-x-auto">
					<LeaderBoard />
				</div>

				<div className="flex-1 2xl:max-h-[50rem]">
					<Map />
				</div>

				{/* Race Control and Track Limits sit beside the map so both stay readable without scrolling.
				    Below 2xl the row stacks, so they fall back to their own fixed-height scroll panels. */}
				<div className="flex flex-col gap-2 2xl:max-h-[50rem] 2xl:w-[26rem]">
					<div className="h-[30rem] overflow-y-auto rounded-lg border border-zinc-800 p-2 2xl:h-auto 2xl:min-h-0 2xl:flex-1">
						<RaceControl />
					</div>

					<div className="h-[30rem] overflow-y-auto rounded-lg border border-zinc-800 p-2 2xl:h-auto 2xl:min-h-0 2xl:flex-1">
						<TrackViolations />
					</div>
				</div>
			</div>

			<div className="grid grid-cols-1 gap-2 *:h-[30rem] *:overflow-y-auto *:rounded-lg *:border *:border-zinc-800 *:p-2">
				<div>
					<TeamRadios />
				</div>
			</div>

			<Footer />
		</div>
	);
}
