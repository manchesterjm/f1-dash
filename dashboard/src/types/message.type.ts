import type { State } from "./state.type";

export type RecursivePartial<T> = {
	[P in keyof T]?: T[P] extends (infer U)[]
		? RecursivePartial<U>[]
		: T[P] extends object | undefined
			? RecursivePartial<T[P]>
			: T[P];
};

type FullState = State & {
	"CarData.z"?: string;
	"Position.z"?: string;
};

export type MessageUpdate = RecursivePartial<FullState>;

export type MessageInitial = FullState;
