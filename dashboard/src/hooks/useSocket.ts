import { useEffect, useState } from "react";

import type { MessageInitial, MessageUpdate } from "@/types/message.type";

import { env } from "@/env";

type Props = {
	handleInitial: (data: MessageInitial) => void;
	handleUpdate: (data: MessageUpdate) => void;
	// False while a replay owns the dashboard (or while we are still finding out).
	enabled?: boolean;
};

export const useSocket = ({ handleInitial, handleUpdate, enabled = true }: Props) => {
	const [connected, setConnected] = useState<boolean>(false);

	useEffect(() => {
		if (!enabled) return;

		const sse = new EventSource(`${env.NEXT_PUBLIC_LIVE_URL}/api/realtime`);

		sse.onerror = () => setConnected(false);
		sse.onopen = () => setConnected(true);

		sse.addEventListener("initial", (message) => {
			handleInitial(JSON.parse(message.data));
		});

		sse.addEventListener("update", (message) => {
			handleUpdate(JSON.parse(message.data));
		});

		return () => {
			sse.close();
			setConnected(false);
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [enabled]);

	return { connected };
};
