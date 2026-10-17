// Maps a recording offset to seconds of playback and back, at the speed Josh picked. The speed never
// changes on its own - breaks, stoppages and the slowing-down lap all play at it (2026-10-04, Josh:
// "the player should never just go into 10x at all"); dragging the bar is how to skip.

export class PlaybackClock {
	constructor(private readonly speed: number) {}

	// Seconds of playback from offset 0 to the given offset.
	playbackSeconds(offset: number): number {
		return offset / this.speed;
	}

	// The recording offset reached after the given seconds of playback.
	offsetAt(playbackSeconds: number): number {
		return playbackSeconds * this.speed;
	}
}
