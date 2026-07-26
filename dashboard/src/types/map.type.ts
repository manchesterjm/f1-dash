export type Map = {
	corners: Corner[];
	marshalLights: Corner[];
	marshalSectors: Corner[];
	// Polyline indices of the circuit's true mini-sector boundaries. Absent on some circuits, and
	// the count does not always equal the number of segments the timing feed reports.
	miniSectorsIndexes?: number[];
	candidateLap: CandidateLap;
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
	trackPositionTime: number[];
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
