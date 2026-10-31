'use client';

import { useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';

import { useDataEngine } from '@/hooks/useDataEngine';
import { useWakeLock } from '@/hooks/useWakeLock';
import { useStores } from '@/hooks/useStores';
import { useSocket } from '@/hooks/useSocket';
import { useReplaySession } from '@/hooks/useReplaySession';
import { useLiveMotion } from '@/hooks/useLiveMotion';

import { useSettingsStore } from '@/stores/useSettingsStore';
import { useSidebarStore } from '@/stores/useSidebarStore';
import { useDataStore } from '@/stores/useDataStore';
import { useReplayActive } from '@/stores/useCarMotionStore';

import Sidebar from '@/components/Sidebar';
import SidenavButton from '@/components/SidenavButton';
import SessionInfo from '@/components/SessionInfo';
import WeatherInfo from '@/components/WeatherInfo';
import TrackInfo from '@/components/TrackInfo';
import DelayInput from '@/components/DelayInput';
import DelayTimer from '@/components/DelayTimer';
import ConnectionStatus from '@/components/ConnectionStatus';
import ReplayBar from '@/components/ReplayBar';
import ReplayPicker from '@/components/ReplayPicker';
import LiveButton from '@/components/LiveButton';

type Props = {
	children: ReactNode;
};

export default function DashboardLayout({ children }: Props) {
	const stores = useStores();
	const { handleInitial, handleUpdate, maxDelay, reset, setFeedTimeMapper } = useDataEngine(stores);
	const dataStore = useDataStore();
	// Switching between live and a replay starts from an empty dashboard, so nothing from one shows in the other.
	const clearDashboard = () => {
		reset();
		dataStore.setState(null);
		dataStore.setPositions(null);
		dataStore.setCarsData(null);
	};
	const { source, startReplay, goLive, keepPlace } = useReplaySession(clearDashboard);
	const [pickerOpen, setPickerOpen] = useState(false);
	const openPicker = () => setPickerOpen(true);
	const addLivePositions = useLiveMotion(source.mode === 'live');
	const { connected } = useSocket({
		handleInitial: (initial) => {
			addLivePositions(initial['Position.z'], initial['CarData.z'], initial.TimingData, true);
			handleInitial(initial);
		},
		handleUpdate: (update) => {
			addLivePositions(update['Position.z'], update['CarData.z'], update.TimingData);
			handleUpdate(update);
		},
		enabled: source.mode === 'live',
	});

	const delay = useSettingsStore((state) => state.delay);
	const syncing = source.mode === 'live' && delay > maxDelay;

	useWakeLock();

	const ended = useDataStore(({ state }) => state?.SessionStatus?.Status === 'Ends');

	return (
		<div className="flex h-screen w-full md:pt-2 md:pr-2 md:pb-2">
			<Sidebar key="sidebar" connected={connected} />

			<motion.div layout="size" className="flex h-full w-full flex-1 flex-col md:gap-2">
				<DesktopStaticBar show={!syncing || ended} onReplay={openPicker} />
				<MobileStaticBar show={!syncing || ended} connected={connected} onReplay={openPicker} />

				<ReplayPicker open={pickerOpen} onClose={() => setPickerOpen(false)} onPick={startReplay} />

				{source.mode === 'replay' &&
					(source.session ? (
						<ReplayBar
							key={source.name}
							session={source.session}
							target={{ handleInitial, handleUpdate, reset, setFeedTimeMapper }}
							resume={source.resume}
							onPlace={(place) => keepPlace(source.name, place)}
							onLive={goLive}
						/>
					) : (
						<div className="flex items-center justify-between gap-3 rounded-lg border border-zinc-800 px-3 py-2 text-sm">
							<span className={source.error ? 'text-red-400' : 'text-zinc-400'}>
								{source.error ?? `Loading ${source.name.replaceAll('_', ' ')}…`}
							</span>
							<LiveButton onClick={goLive} />
						</div>
					))}

				<div
					className={
						!syncing || ended ? 'no-scrollbar w-full flex-1 overflow-auto md:rounded-lg' : 'hidden'
					}
				>
					<MobileDynamicBar />
					{children}
				</div>

				<div
					className={
						syncing && !ended
							? 'flex h-full flex-1 flex-col items-center justify-center gap-2 border-zinc-800 md:rounded-lg md:border'
							: 'hidden'
					}
				>
					<h1 className="my-20 text-center text-5xl font-bold">Syncing...</h1>
					<p>Please wait for {delay - maxDelay} seconds.</p>
					<p>Or make your delay smaller.</p>
				</div>
			</motion.div>
		</div>
	);
}

function MobileDynamicBar() {
	return (
		<div className="flex flex-col divide-y divide-zinc-800 border-b border-zinc-800 md:hidden">
			<div className="p-2">
				<SessionInfo />
			</div>
			<div className="p-2">
				<WeatherInfo />
			</div>
		</div>
	);
}

// Opens the Replay picker. Lives in the top bar on every dashboard page, live or replaying.
function ReplayButton({ onClick }: { onClick: () => void }) {
	return (
		<button
			onClick={onClick}
			className="shrink-0 rounded-md bg-zinc-800 px-2 py-1 text-sm font-medium hover:bg-zinc-700"
		>
			Replay
		</button>
	);
}

function MobileStaticBar({ show, connected, onReplay }: { show: boolean; connected: boolean; onReplay: () => void }) {
	const open = useSidebarStore((state) => state.open);
	const replaying = useReplayActive();

	return (
		<div className="flex w-full items-center justify-between overflow-hidden border-b border-zinc-800 p-2 md:hidden">
			<div className="flex items-center gap-2">
				<SidenavButton key="mobile" onClick={() => open()} />

				{!replaying && <DelayInput saveDelay={500} />}
				{!replaying && <DelayTimer />}

				<ConnectionStatus connected={connected} />
				<ReplayButton onClick={onReplay} />
			</div>

			{show && <TrackInfo />}
		</div>
	);
}

function DesktopStaticBar({ show, onReplay }: { show: boolean; onReplay: () => void }) {
	const pinned = useSidebarStore((state) => state.pinned);
	const pin = useSidebarStore((state) => state.pin);

	return (
		<div className="hidden w-full flex-row justify-between overflow-hidden rounded-lg border border-zinc-800 p-2 md:flex">
			<div className="flex items-center gap-2">
				<AnimatePresence>
					{!pinned && <SidenavButton key="desktop" className="shrink-0" onClick={() => pin()} />}

					<motion.div key="session-info" layout="position">
						<SessionInfo />
					</motion.div>
				</AnimatePresence>
			</div>

			<div className="hidden md:items-center lg:flex">{show && <WeatherInfo />}</div>

			<div className="flex items-center justify-end gap-2">
				{show && <TrackInfo />}
				<ReplayButton onClick={onReplay} />
			</div>
		</div>
	);
}
