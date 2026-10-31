type Columns = { showDrs: boolean; carMetrics: boolean };

// Column widths shared by the dashboard leaderboard's rows and its header row, so the two always line up.
export const leaderboardColumns = ({ showDrs, carMetrics }: Columns): string =>
	["6.5rem", showDrs && "3.5rem", "5.5rem 4rem 5rem 5.5rem auto", carMetrics && "10.5rem"].filter(Boolean).join(" ");
