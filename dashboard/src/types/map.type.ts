export type Map = {
	corners: Corner[];
	marshalLights: Corner[];
	marshalSectors: Corner[];
	// Polyline indices of the circuit's true mini-sector boundaries. Absent on some circuits, and
	// the count does not always equal the number of segments the timing feed reports.
	miniSectorsIndexes?: number[];
	// The car lap MultiViewer traced the outline from. Absent on locally built fallback maps.
	candidateLap?: CandidateLap;
	// Pit-lane centreline in the same frame as x/y. Only locally built fallback maps carry one.
	pitLane?: { x: number[]; y: number[] };
	circuitKey: number;
	circuitName: string;
	countryIocCode: string;
	countryKey: number;
	countryName: string;
	location: string;
	meetingKey: string;
	meetingName: string;
	meetingOfficialName: string;
	raceDate: string;
	rotation: number;
	round: number;
	// Seconds into candidateLap at each x/y point. Absent on some circuits (Yas Marina).
	trackPositionTime?: number[];
	x: number[];
	y: number[];
	year: number;
};

export type CandidateLap = {
	driverNumber: string;
	lapNumber: number;
	lapStartDate: string;
	lapStartSessionTime: number;
	lapTime: number;
	session: string;
	sessionStartTime: number;
};

export type Corner = {
	angle: number;
	length: number;
	number: number;
	trackPosition: TrackPosition;
};

export type TrackPosition = {
	x: number;
	y: number;
};
