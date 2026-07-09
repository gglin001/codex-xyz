import {
	Activity,
	Archive,
	Bot,
	FolderGit2,
	GitFork,
	Hash,
	Maximize2,
	Minimize2,
	Minus,
	Play,
	Plus,
	RefreshCw,
	Star,
	Sun,
	TimerReset,
	WrapText,
} from "lucide-react";
import type { ReactNode } from "react";
import { memo, useId, useRef } from "react";
import type {
	ControlThread,
	ThreadDetail,
	ThreadTagScore,
} from "../../server/domain.js";
import {
	clampDisplayScale,
	cn,
	displayScale as displayScaleConfig,
	formatDisplayScale,
	tone,
	ui,
} from "../designSystem.js";
import { nextThemeMode, type ThemeMode } from "../theme.js";
import { shortId, statusLabel } from "../uiFormat.js";
import { MobileFloatingScroller } from "./MobileFloatingScroller.js";
import { ControlCard, InfoTile, SurfaceAction } from "./uiPrimitives.js";
import type { ComposerMode, WorkbenchThread } from "./workbenchTypes.js";

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
	defaultModel: string | null;
	workdir: string;
	promptTarget: ComposerMode;
	onWrapThreadContentChange: (value: boolean) => void;
	onThemeModeChange: (mode: ThemeMode) => void;
	fullscreenSupported: boolean;
	isFullscreen: boolean;
	onToggleFullscreen: () => void;
	onThreadTagScoreChange: (value: ThreadTagScore | null) => void;
	restartCodexAppServerDisabled: boolean;
	onRestartCodexAppServer: () => void;
};

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

function SettingsIconAction({
	disabled,
	icon,
	label,
	title = label,
	onClick,
}: {
	disabled?: boolean;
	icon: ReactNode;
	label: string;
	title?: string;
	onClick: () => void;
}) {
	return (
		<SurfaceAction
			className="h-9 w-9 justify-center p-0 text-muted-strong"
			title={title}
			aria-label={label}
			disabled={disabled}
			onClick={onClick}
		>
			<span className="shrink-0 text-muted">{icon}</span>
		</SurfaceAction>
	);
}

function SettingsZoomControl({
	value,
	fullscreenSupported,
	isFullscreen,
	onChange,
	onToggleFullscreen,
}: {
	value: number;
	fullscreenSupported: boolean;
	isFullscreen: boolean;
	onChange: (value: number) => void;
	onToggleFullscreen: () => void;
}) {
	const canDecrease = value > displayScaleConfig.min;
	const canIncrease = value < displayScaleConfig.max;
	const decrease = () =>
		onChange(clampDisplayScale(value - displayScaleConfig.step));
	const increase = () =>
		onChange(clampDisplayScale(value + displayScaleConfig.step));

	return (
		<ControlCard className="flex h-11 w-full min-w-0 items-center gap-2 px-3 py-1.5">
			<span className="min-w-0 flex-1 truncate text-[13px] font-medium text-fg">
				Zoom
			</span>
			<SurfaceAction
				className="h-8 w-8 shrink-0 justify-center p-0 text-muted-strong"
				title="Zoom out"
				aria-label="Zoom out"
				disabled={!canDecrease}
				onClick={decrease}
			>
				<Minus size={15} />
			</SurfaceAction>
			<span className="w-12 shrink-0 text-center font-mono text-[13px] font-semibold tabular-nums text-fg">
				{formatDisplayScale(value)}
			</span>
			<SurfaceAction
				className="h-8 w-8 shrink-0 justify-center p-0 text-muted-strong"
				title="Zoom in"
				aria-label="Zoom in"
				disabled={!canIncrease}
				onClick={increase}
			>
				<Plus size={15} />
			</SurfaceAction>
			{fullscreenSupported ? (
				<SurfaceAction
					className={cn(
						"h-8 w-8 shrink-0 justify-center p-0",
						isFullscreen ? null : "text-muted-strong",
					)}
					selected={isFullscreen}
					title={isFullscreen ? "Exit full screen" : "Enter full screen"}
					aria-label="Full screen"
					onClick={onToggleFullscreen}
				>
					<span
						className={cn(
							"shrink-0",
							isFullscreen ? "text-accent" : "text-muted",
						)}
					>
						{isFullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
					</span>
				</SurfaceAction>
			) : null}
		</ControlCard>
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
	defaultModel,
	workdir,
	promptTarget,
	onWrapThreadContentChange,
	onThemeModeChange,
	fullscreenSupported,
	isFullscreen,
	onToggleFullscreen,
	onThreadTagScoreChange,
	restartCodexAppServerDisabled,
	onRestartCodexAppServer,
}: ParamPanelProps) {
	const settingsScrollRef = useRef<HTMLDivElement | null>(null);
	const settingsScrollId = useId();
	const composingNewThread = promptTarget === "new";
	const thread = composingNewThread
		? null
		: (selectedThread ?? threadSummary?.thread ?? null);
	const displayDetail = composingNewThread ? null : detail;
	const status = thread?.status ?? "idle";
	const model = thread?.model ?? defaultModel ?? "default Codex model";
	const cwd = composingNewThread
		? workdir || defaultCwd
		: (thread?.cwd ?? threadSummary?.cwd ?? defaultCwd);
	const contextTokens =
		displayDetail?.tokensUsed ??
		thread?.tokensUsed ??
		threadSummary?.tokensUsed ??
		0;
	const turnCount = displayDetail?.turns.length ?? 0;
	const itemCount = displayDetail?.items.length ?? 0;

	return (
		<aside
			className={cn(
				"flex h-full min-h-0 w-full min-w-0 max-w-full flex-col overflow-x-hidden bg-panel/90 text-fg",
				className,
			)}
		>
			<div className="relative min-h-0 min-w-0 max-w-full flex-1 overflow-x-hidden">
				<div
					id={settingsScrollId}
					ref={settingsScrollRef}
					className="mobile-custom-scroll mobile-keyboard-scroll h-full min-h-0 min-w-0 overflow-y-auto overflow-x-hidden scroll-mask-y"
				>
					<div className="grid min-w-0 gap-1.5 px-2.5 py-2">
						<InfoTile
							icon={<Hash size={13} />}
							label="Name"
							value={thread?.name || threadSummary?.name || "Untitled thread"}
							hideLabel
						/>
						<div className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-1.5">
							<InfoTile
								icon={
									<span
										className={cn(
											"h-2 w-2 rounded-full",
											runtimeStatusTone(status),
										)}
									/>
								}
								label="Status"
								value={statusLabel(status)}
								layout="inline"
							/>
							<InfoTile
								icon={<Archive size={13} />}
								label="Mode"
								value={
									thread?.archivedAt ? "Archived" : thread ? "Active" : "None"
								}
								layout="inline"
							/>
						</div>
						<div className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-1.5">
							<InfoTile
								icon={<Hash size={13} />}
								label="ID"
								value={thread ? shortId(thread.id) : "None"}
								mono
								layout="inline"
							/>
							<InfoTile
								icon={<Activity size={13} />}
								label="Turn"
								value={
									thread?.activeTurnId ? shortId(thread.activeTurnId) : "None"
								}
								mono
								layout="inline"
							/>
						</div>
						<InfoTile
							icon={<FolderGit2 size={13} />}
							label="CWD"
							value={cwd}
							mono
							hideLabel
						/>
						<InfoTile
							icon={<Bot size={13} />}
							label="Model"
							value={model}
							mono
							hideLabel
						/>
						{thread?.goalObjective ? (
							<InfoTile
								icon={<TimerReset size={13} />}
								label="Goal"
								value={thread.goalObjective}
							/>
						) : null}
						<div className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-1.5">
							<InfoTile
								icon={<TimerReset size={13} />}
								label="token"
								value={formatCompact(contextTokens)}
								mono
								layout="inline"
							/>
							<InfoTile
								icon={<Play size={13} />}
								label="Turns"
								value={String(turnCount)}
								layout="inline"
							/>
						</div>
						<div
							className={cn(
								"grid min-w-0 gap-1.5",
								thread?.forkedFromId
									? "grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
									: "grid-cols-1",
							)}
						>
							<InfoTile
								icon={<Activity size={13} />}
								label="Items"
								value={String(itemCount)}
								layout="inline"
							/>
							{thread?.forkedFromId ? (
								<InfoTile
									icon={<GitFork size={13} />}
									label="Continued"
									value={shortId(thread.forkedFromId)}
									mono
									layout="inline"
								/>
							) : null}
						</div>
					</div>

					<div className="mx-2.5 h-px bg-border-soft" />

					<div className="grid min-w-0 gap-1.5 px-2.5 py-2">
						<div className="flex min-w-0 flex-wrap gap-1.5">
							<SettingsIconAction
								disabled={restartCodexAppServerDisabled}
								icon={<RefreshCw size={15} />}
								label="Restart Codex app-server"
								title={
									restartCodexAppServerDisabled
										? "Another action is running"
										: "Restart Codex app-server"
								}
								onClick={onRestartCodexAppServer}
							/>
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
						</div>
						<TagScoreControl
							disabled={!thread}
							score={thread?.tagScore ?? null}
							onChange={onThreadTagScoreChange}
						/>
						<SettingsZoomControl
							value={displayScale}
							fullscreenSupported={fullscreenSupported}
							isFullscreen={isFullscreen}
							onChange={onDisplayScaleChange}
							onToggleFullscreen={onToggleFullscreen}
						/>
					</div>
				</div>
				<div className="chrome-edge-fade chrome-edge-fade-short chrome-edge-fade-panel chrome-edge-fade-top" />
				<div className="chrome-edge-fade chrome-edge-fade-short chrome-edge-fade-panel chrome-edge-fade-bottom" />
				<MobileFloatingScroller
					scrollRef={settingsScrollRef}
					scrollElementId={settingsScrollId}
					contentRightInset="0.625rem"
				/>
			</div>
		</aside>
	);
});
