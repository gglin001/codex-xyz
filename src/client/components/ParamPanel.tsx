import {
	Activity,
	Archive,
	BadgeCheck,
	Bot,
	CircleDotDashed,
	Cpu,
	Download,
	FolderGit2,
	GitFork,
	Hash,
	ListTree,
	Maximize2,
	Minimize2,
	Play,
	RefreshCcw,
	RefreshCw,
	Server,
	SlidersHorizontal,
	Star,
	Sun,
	TimerReset,
	Wifi,
	WifiOff,
	WrapText,
} from "lucide-react";
import type { ReactNode } from "react";
import { memo, useId, useRef } from "react";
import type {
	ControlThread,
	ThreadDetail,
	ThreadTagScore,
} from "../../server/domain.js";
import { cn, tone, ui } from "../designSystem.js";
import { nextThemeMode, type ThemeMode } from "../theme.js";
import { formatTokens, shortId, statusLabel } from "../uiFormat.js";
import type { PwaState } from "../usePwa.js";
import { MobileFloatingScroller } from "./MobileFloatingScroller.js";
import {
	ControlCard,
	InfoTile,
	Pill,
	ScaleControl,
	SettingsSection,
	SurfaceAction,
} from "./uiPrimitives.js";
import type { WorkbenchThread } from "./workbenchTypes.js";

export type ParamPanelProps = {
	className?: string;
	threadSummary: WorkbenchThread | null;
	detail: ThreadDetail | null;
	selectedThread: ControlThread | null;
	wrapThreadContent: boolean;
	themeMode: ThemeMode;
	displayScale: number;
	onDisplayScaleChange: (value: number) => void;
	defaultCwd: string;
	onWrapThreadContentChange: (value: boolean) => void;
	onThemeModeChange: (mode: ThemeMode) => void;
	pwa: PwaState;
	fullscreenSupported: boolean;
	isFullscreen: boolean;
	onToggleFullscreen: () => void;
	onThreadTagScoreChange: (value: ThreadTagScore | null) => void;
	restartCodexAppServerDisabled: boolean;
	onRestartCodexAppServer: () => void;
};

function clamp(value: number, min: number, max: number) {
	return Math.min(max, Math.max(min, value));
}

function formatCompact(value: number) {
	return new Intl.NumberFormat(undefined, { notation: "compact" }).format(
		value,
	);
}

function runtimeStatusTone(status: string | null | undefined) {
	if (status === "active") {
		return tone.running.dot;
	}
	if (status === "system_error") {
		return tone.error.dot;
	}
	if (status === "not_loaded") {
		return tone.stale.dot;
	}
	return tone.neutral.dot;
}

function pwaInstallLabel(installState: PwaState["installState"]) {
	if (installState === "installed") {
		return "Installed";
	}
	if (installState === "available") {
		return "Install";
	}
	if (installState === "unsupported") {
		return "Install unsupported";
	}
	return "Install from browser";
}

function pwaCacheLabel(pwa: PwaState) {
	if (pwa.updateState === "available") {
		return "Update ready";
	}
	return pwa.serviceWorkerReady ? "App shell cached" : "Cache starting";
}

function SettingsIconToggle({
	checked,
	icon,
	label,
	title = label,
	onClick,
}: {
	checked: boolean;
	icon: ReactNode;
	label: string;
	title?: string;
	onClick: () => void;
}) {
	return (
		<SurfaceAction
			className={cn(
				"h-9 w-9 justify-center p-0",
				checked ? null : "text-muted-strong",
			)}
			selected={checked}
			title={title}
			aria-label={label}
			onClick={onClick}
		>
			<span className={cn("shrink-0", checked ? "text-accent" : "text-muted")}>
				{icon}
			</span>
		</SurfaceAction>
	);
}

function tagScoreLabel(score: ThreadTagScore | null | undefined) {
	return score ? `${score} star thread tag` : "No thread tag score";
}

function TagScoreControl({
	disabled,
	score,
	onChange,
}: {
	disabled?: boolean;
	score: ThreadTagScore | null;
	onChange: (value: ThreadTagScore | null) => void;
}) {
	const scores = [1, 2, 3] as const;
	return (
		<ControlCard className="flex w-full min-w-0 items-center justify-between gap-3 px-3 py-2.5">
			<span className="min-w-0">
				<span className="block truncate text-[13px] font-medium text-fg">
					Thread score
				</span>
				<span className="block truncate text-[11px] text-muted">
					{tagScoreLabel(score)}
				</span>
			</span>
			<fieldset className="flex shrink-0 items-center gap-1">
				<legend className="sr-only">Thread score</legend>
				{scores.map((value) => {
					const selected = score !== null && value <= score;
					return (
						<button
							key={value}
							type="button"
							className={cn(
								ui.iconButton,
								disabled ? "cursor-not-allowed opacity-45" : null,
								selected ? "text-accent" : "text-muted",
							)}
							aria-label={
								score === value
									? "Clear thread score"
									: `Set thread score to ${value}`
							}
							aria-pressed={score === value}
							title={
								score === value
									? "Clear thread score"
									: `Set thread score to ${value}`
							}
							disabled={disabled}
							onClick={() => onChange(score === value ? null : value)}
						>
							<Star
								size={17}
								fill={selected ? "currentColor" : "none"}
								strokeWidth={selected ? 2.4 : 1.8}
							/>
						</button>
					);
				})}
			</fieldset>
		</ControlCard>
	);
}

export const ParamPanel = memo(function ParamPanel({
	className,
	threadSummary,
	detail,
	selectedThread,
	wrapThreadContent,
	themeMode,
	displayScale,
	onDisplayScaleChange,
	defaultCwd,
	onWrapThreadContentChange,
	onThemeModeChange,
	pwa,
	fullscreenSupported,
	isFullscreen,
	onToggleFullscreen,
	onThreadTagScoreChange,
	restartCodexAppServerDisabled,
	onRestartCodexAppServer,
}: ParamPanelProps) {
	const settingsScrollRef = useRef<HTMLDivElement | null>(null);
	const settingsScrollId = useId();
	const thread = selectedThread ?? threadSummary?.thread ?? null;
	const status = thread?.status ?? "idle";
	const model = thread?.model ?? "default Codex model";
	const tokenBudget = thread?.goalTokenBudget ?? null;
	const contextTokens =
		detail?.tokensUsed ?? thread?.tokensUsed ?? threadSummary?.tokensUsed ?? 0;
	const contextLimit = tokenBudget ?? Math.max(contextTokens, 1);
	const tokenRatio = tokenBudget ? clamp(contextTokens / tokenBudget, 0, 1) : 0;
	const tokenPercent = Math.round(tokenRatio * 100);
	const turnCount = detail?.turns.length ?? 0;
	const itemCount = detail?.items.length ?? 0;

	return (
		<aside
			className={cn(
				"flex h-full min-h-0 w-full min-w-0 flex-col bg-panel/90 text-fg",
				className,
			)}
		>
			<div className="relative min-h-0 min-w-0 flex-1">
				<div
					id={settingsScrollId}
					ref={settingsScrollRef}
					className="mobile-custom-scroll mobile-keyboard-scroll h-full min-h-0 min-w-0 overflow-y-auto overflow-x-hidden scroll-mask-y"
				>
					<SettingsSection icon={<ListTree size={13} />} title="Current Thread">
						<div className="grid min-w-0 gap-1.5">
							<ControlCard className="grid w-full min-w-0 gap-1.5 px-2.5 py-2">
								<div className="flex min-w-0 items-center justify-between gap-3">
									<span className="inline-flex min-w-0 items-center gap-2">
										<span
											className={cn(
												"h-2 w-2 shrink-0 rounded-full",
												runtimeStatusTone(status),
											)}
										/>
										<span className="truncate text-[13px] font-medium text-fg">
											{statusLabel(status)}
										</span>
									</span>
									<Pill className="font-mono text-[11px] text-muted">
										{thread?.archivedAt ? "view-only" : "thread"}
									</Pill>
								</div>
								<div className="truncate text-[11px] text-muted">
									{thread?.archivedAt
										? "Archived threads are view-only"
										: thread
											? "Thread actions depend on the current run state"
											: "Select or create a thread to begin"}
								</div>
							</ControlCard>
							<InfoTile
								icon={<Hash size={13} />}
								label="Name"
								value={thread?.name || threadSummary?.name || "Untitled thread"}
								layout="inline"
							/>
							<InfoTile
								icon={<Hash size={13} />}
								label="ID"
								value={thread ? shortId(thread.id) : "No thread selected"}
								mono
								layout="inline"
							/>
							<InfoTile
								icon={<Activity size={13} />}
								label="Active turn"
								value={
									thread?.activeTurnId ? shortId(thread.activeTurnId) : "None"
								}
								mono
								layout="inline"
							/>
							<InfoTile
								icon={<FolderGit2 size={13} />}
								label="Working directory"
								value={thread?.cwd ?? threadSummary?.cwd ?? defaultCwd}
								mono
							/>
							<InfoTile
								icon={<Archive size={13} />}
								label="Mode"
								value={
									thread?.archivedAt
										? "Archived and view-only"
										: thread
											? "Active workspace thread"
											: "No thread selected"
								}
								layout="inline"
							/>
							{thread?.forkedFromId ? (
								<InfoTile
									icon={<GitFork size={13} />}
									label="Continued from"
									value={shortId(thread.forkedFromId)}
									mono
									layout="inline"
								/>
							) : null}
							<TagScoreControl
								disabled={!thread}
								score={thread?.tagScore ?? null}
								onChange={onThreadTagScoreChange}
							/>
						</div>
					</SettingsSection>

					<SettingsSection
						icon={<TimerReset size={13} />}
						title="Goal and Usage"
					>
						<div className="grid min-w-0 gap-1.5">
							<ControlCard size="large" className="w-full min-w-0 p-2.5">
								<div className="mb-2 flex min-w-0 items-center justify-between gap-3 text-[12px]">
									<span className="truncate font-medium text-fg">
										{tokenBudget ? "Goal budget" : "Tk used"}
									</span>
									<span className="shrink-0 truncate font-mono text-[11px] text-muted">
										{tokenBudget
											? `${formatCompact(contextTokens)} / ${formatCompact(contextLimit)}`
											: formatCompact(contextTokens)}
									</span>
								</div>
								<div className="h-1.5 overflow-hidden rounded-full bg-control">
									<div
										className={cn(
											"h-full rounded-full transition-[width,background-color] duration-300 ease-out",
											tokenRatio > 0.82 ? "bg-stale-dot" : "bg-accent",
											tokenBudget ? null : "w-0",
										)}
										style={{ width: tokenBudget ? `${tokenPercent}%` : "0%" }}
									/>
								</div>
								<div className="mt-2 flex min-w-0 items-center justify-between gap-3 text-[11px] text-muted">
									<span className="truncate">
										{thread?.goalStatus
											? statusLabel(thread.goalStatus)
											: "No active goal"}
									</span>
									<span className="shrink-0 truncate">
										{tokenBudget
											? `${tokenPercent}%`
											: `${formatTokens(contextTokens)} tk total`}
									</span>
								</div>
							</ControlCard>
							{thread?.goalObjective ? (
								<ControlCard className="w-full min-w-0 px-2.5 py-2 text-[12px] leading-5 text-fg">
									<span className="block truncate" title={thread.goalObjective}>
										{thread.goalObjective}
									</span>
								</ControlCard>
							) : null}
							<div className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-1.5">
								<InfoTile
									icon={<Play size={13} />}
									label="Turns"
									value={String(turnCount)}
									layout="inline"
								/>
								<InfoTile
									icon={<CircleDotDashed size={13} />}
									label="Items"
									value={String(itemCount)}
									layout="inline"
								/>
							</div>
						</div>
					</SettingsSection>

					<SettingsSection icon={<Server size={13} />} title="Runtime">
						<div className="grid min-w-0 gap-1.5">
							<InfoTile
								icon={<Bot size={13} />}
								label="Model"
								value={model}
								mono
								layout="inline"
							/>
							<InfoTile
								icon={<Cpu size={13} />}
								label="Runtime"
								value="codex app-server socket"
								mono
								layout="inline"
							/>
							<SurfaceAction
								className="h-9 justify-center gap-2 px-2 text-[12px] font-medium text-muted-strong"
								title={
									restartCodexAppServerDisabled
										? "Another action is running"
										: "Restart Codex app-server"
								}
								aria-label="Restart Codex app-server"
								disabled={restartCodexAppServerDisabled}
								onClick={onRestartCodexAppServer}
							>
								<RefreshCw size={14} />
								<span className="truncate">Restart app-server</span>
							</SurfaceAction>
						</div>
					</SettingsSection>

					<SettingsSection icon={<SlidersHorizontal size={13} />} title="View">
						<div className="grid min-w-0 gap-1.5">
							<ControlCard className="w-full min-w-0 px-2.5 py-2">
								<ScaleControl
									label="Scale"
									value={displayScale}
									onChange={onDisplayScaleChange}
								/>
							</ControlCard>
							<div className="flex min-w-0 flex-wrap gap-1.5">
								<SettingsIconToggle
									checked={themeMode === "day"}
									icon={<Sun size={15} />}
									label="Day mode"
									title={themeMode === "day" ? "Use dark mode" : "Use day mode"}
									onClick={() => onThemeModeChange(nextThemeMode(themeMode))}
								/>
								<SettingsIconToggle
									checked={wrapThreadContent}
									icon={<WrapText size={15} />}
									label="Wrap thread content"
									title={
										wrapThreadContent
											? "Disable transcript wrap"
											: "Enable transcript wrap"
									}
									onClick={() => onWrapThreadContentChange(!wrapThreadContent)}
								/>
								{fullscreenSupported ? (
									<SettingsIconToggle
										checked={isFullscreen}
										icon={
											isFullscreen ? (
												<Minimize2 size={15} />
											) : (
												<Maximize2 size={15} />
											)
										}
										label="Full screen"
										title={
											isFullscreen ? "Exit full screen" : "Enter full screen"
										}
										onClick={onToggleFullscreen}
									/>
								) : null}
							</div>
						</div>
					</SettingsSection>

					<SettingsSection icon={<Download size={13} />} title="Web App">
						<div className="grid min-w-0 gap-1.5">
							<ControlCard className="grid w-full min-w-0 gap-1.5 px-2.5 py-2">
								<div className="flex min-w-0 items-center justify-between gap-3">
									<span className="inline-flex min-w-0 items-center gap-2">
										<span
											className={cn(
												"h-2 w-2 shrink-0 rounded-full",
												pwa.online ? tone.running.dot : tone.error.dot,
											)}
										/>
										<span className="truncate text-[13px] font-medium text-fg">
											{pwa.online ? "Online" : "Offline"}
										</span>
									</span>
									<Pill className="font-mono text-[11px] text-muted">
										{pwa.displayMode}
									</Pill>
								</div>
								<div className="flex min-w-0 items-center justify-between gap-3 text-[12px] text-muted">
									<span className="inline-flex min-w-0 items-center gap-1.5">
										{pwa.online ? (
											<Wifi size={13} className="shrink-0" />
										) : (
											<WifiOff size={13} className="shrink-0" />
										)}
										<span className="truncate">{pwaCacheLabel(pwa)}</span>
									</span>
									<span className="shrink-0 truncate">
										{pwa.installState === "installed"
											? "standalone"
											: "browser"}
									</span>
								</div>
							</ControlCard>
							<div className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-1.5">
								<SurfaceAction
									className="h-9 justify-center gap-2 px-2 text-[12px] font-medium"
									disabled={!pwa.canInstall}
									title={pwaInstallLabel(pwa.installState)}
									aria-label={pwaInstallLabel(pwa.installState)}
									selected={pwa.installState === "installed"}
									onClick={() => {
										void pwa.install();
									}}
								>
									{pwa.installState === "installed" ? (
										<BadgeCheck size={14} />
									) : (
										<Download size={14} />
									)}
									<span className="truncate">
										{pwaInstallLabel(pwa.installState)}
									</span>
								</SurfaceAction>
								<SurfaceAction
									className="h-9 justify-center gap-2 px-2 text-[12px] font-medium"
									disabled={pwa.updateState !== "available"}
									title={
										pwa.updateState === "available"
											? "Apply app update"
											: "No app update available"
									}
									aria-label={
										pwa.updateState === "available"
											? "Apply app update"
											: "No app update available"
									}
									onClick={pwa.activateUpdate}
								>
									<RefreshCcw size={14} />
									<span className="truncate">Update</span>
								</SurfaceAction>
							</div>
						</div>
					</SettingsSection>
				</div>
				<div className="chrome-edge-fade chrome-edge-fade-short chrome-edge-fade-panel chrome-edge-fade-top" />
				<div className="chrome-edge-fade chrome-edge-fade-short chrome-edge-fade-panel chrome-edge-fade-bottom" />
				<MobileFloatingScroller
					scrollRef={settingsScrollRef}
					scrollElementId={settingsScrollId}
				/>
			</div>
		</aside>
	);
});
