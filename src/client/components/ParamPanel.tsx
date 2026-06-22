import {
	Activity,
	Bot,
	CircleDotDashed,
	Cpu,
	FolderGit2,
	GitFork,
	Hash,
	ListTree,
	Maximize2,
	Minimize2,
	Moon,
	Play,
	Server,
	SlidersHorizontal,
	Sun,
	TimerReset,
	WrapText,
	ZoomIn,
} from "lucide-react";
import type { ReactNode } from "react";
import { memo } from "react";
import type { ControlThread, ThreadDetail } from "../../server/domain.js";
import { cn, tone } from "../designSystem.js";
import { nextThemeMode, type ThemeMode } from "../theme.js";
import { formatTokens, shortId, statusLabel } from "../uiFormat.js";
import {
	ControlCard,
	InfoTile,
	Pill,
	ScaleControl,
	SettingsSection,
	SurfaceAction,
	SwitchControl,
} from "./uiPrimitives.js";
import type { WorkbenchSession } from "./workbenchTypes.js";

export type ParamPanelProps = {
	className?: string;
	session: WorkbenchSession | null;
	detail: ThreadDetail | null;
	selectedThread: ControlThread | null;
	wrapSessionContent: boolean;
	themeMode: ThemeMode;
	displayScale: number;
	onDisplayScaleChange: (value: number) => void;
	defaultCwd: string;
	onWrapSessionContentChange: (value: boolean) => void;
	onThemeModeChange: (mode: ThemeMode) => void;
	fullscreenSupported: boolean;
	isFullscreen: boolean;
	onToggleFullscreen: () => void;
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

function SettingsToggleRow({
	checked,
	icon,
	title,
	description,
	onClick,
}: {
	checked: boolean;
	icon: ReactNode;
	title: string;
	description: string;
	onClick: () => void;
}) {
	return (
		<SurfaceAction
			className={cn(
				"min-h-11 w-full justify-between gap-3 px-3 py-2.5 text-[13px] font-medium",
				checked ? null : "text-muted-strong",
			)}
			selected={checked}
			onClick={onClick}
		>
			<span className="inline-flex min-w-0 flex-1 items-center gap-2">
				<span
					className={cn("shrink-0", checked ? "text-accent" : "text-muted")}
				>
					{icon}
				</span>
				<span className="min-w-0">
					<span
						className={cn(
							"block truncate",
							checked ? "text-fg-strong" : "text-fg",
						)}
					>
						{title}
					</span>
					<span className="block truncate text-[11px] font-normal text-muted">
						{description}
					</span>
				</span>
			</span>
			<SwitchControl checked={checked} />
		</SurfaceAction>
	);
}

export const ParamPanel = memo(function ParamPanel({
	className,
	session,
	detail,
	selectedThread,
	wrapSessionContent,
	themeMode,
	displayScale,
	onDisplayScaleChange,
	defaultCwd,
	onWrapSessionContentChange,
	onThemeModeChange,
	fullscreenSupported,
	isFullscreen,
	onToggleFullscreen,
}: ParamPanelProps) {
	const thread = selectedThread ?? session?.thread ?? null;
	const status = thread?.status ?? "idle";
	const model = thread?.model ?? "default Codex model";
	const tokenBudget = thread?.goalTokenBudget ?? null;
	const contextTokens =
		detail?.tokensUsed ?? thread?.tokensUsed ?? session?.tokensUsed ?? 0;
	const contextLimit = tokenBudget ?? Math.max(contextTokens, 1);
	const tokenRatio = tokenBudget ? clamp(contextTokens / tokenBudget, 0, 1) : 0;
	const tokenPercent = Math.round(tokenRatio * 100);
	const turnCount = detail?.turns.length ?? 0;
	const itemCount = detail?.items.length ?? 0;

	return (
		<aside
			className={cn(
				"flex h-full min-h-0 w-full min-w-0 flex-col border-l border-l-border-strong bg-panel text-fg",
				className,
			)}
		>
			<div className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden scroll-mask-y">
				<SettingsSection icon={<Server size={13} />} title="Runtime">
					<div className="grid min-w-0 gap-2">
						<ControlCard className="flex w-full min-w-0 items-center justify-between gap-3 bg-field/70 px-3 py-2.5">
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
								app-server
							</Pill>
						</ControlCard>
						<InfoTile
							icon={<Bot size={13} />}
							label="Model"
							value={model}
							mono
							layout="inline"
						/>
						<InfoTile
							icon={<Cpu size={13} />}
							label="Adapter"
							value="codex app-server --stdio"
							mono
							layout="inline"
						/>
					</div>
				</SettingsSection>

				<SettingsSection icon={<ListTree size={13} />} title="Session">
					<div className="grid min-w-0 gap-2">
						<InfoTile
							icon={<Hash size={13} />}
							label="Thread"
							value={thread ? shortId(thread.id) : "No thread selected"}
							mono
							layout="inline"
						/>
						<InfoTile
							icon={<Hash size={13} />}
							label="Session"
							value={thread ? shortId(thread.sessionId) : "New session draft"}
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
							value={thread?.cwd ?? session?.cwd ?? defaultCwd}
							mono
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
					</div>
				</SettingsSection>

				<SettingsSection
					icon={<TimerReset size={13} />}
					title="Goal and Tokens"
				>
					<div className="grid min-w-0 gap-2">
						<ControlCard
							size="large"
							className="w-full min-w-0 bg-field/70 p-3"
						>
							<div className="mb-3 flex min-w-0 items-center justify-between gap-3 text-[12px]">
								<span className="truncate font-medium text-fg">
									{tokenBudget ? "Goal budget" : "Tokens used"}
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
							<div className="mt-3 flex min-w-0 items-center justify-between gap-3 text-[11px] text-muted">
								<span className="truncate">
									{thread?.goalStatus
										? statusLabel(thread.goalStatus)
										: "No active goal"}
								</span>
								<span className="shrink-0 truncate">
									{tokenBudget
										? `${tokenPercent}%`
										: `${formatTokens(contextTokens)} total`}
								</span>
							</div>
						</ControlCard>
						{thread?.goalObjective ? (
							<ControlCard className="w-full min-w-0 bg-field/70 px-3 py-2.5 text-[12px] leading-5 text-fg">
								<span className="block truncate" title={thread.goalObjective}>
									{thread.goalObjective}
								</span>
							</ControlCard>
						) : null}
						<div className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2">
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

				<SettingsSection icon={<Sun size={13} />} title="Appearance">
					<div className="grid min-w-0 gap-2">
						<SettingsToggleRow
							checked={themeMode === "day"}
							icon={
								themeMode === "day" ? <Sun size={14} /> : <Moon size={14} />
							}
							title="Day mode"
							description={
								themeMode === "day"
									? "Apple-style light interface"
									: "Switch to the light interface"
							}
							onClick={() => onThemeModeChange(nextThemeMode(themeMode))}
						/>
					</div>
				</SettingsSection>

				<SettingsSection
					icon={<SlidersHorizontal size={13} />}
					title="Transcript View"
				>
					<div className="grid min-w-0 gap-2">
						<SettingsToggleRow
							checked={wrapSessionContent}
							icon={<WrapText size={14} />}
							title="Wrap session content"
							description={
								wrapSessionContent
									? "Long transcript lines wrap"
									: "Long transcript lines scroll"
							}
							onClick={() => onWrapSessionContentChange(!wrapSessionContent)}
						/>
						{fullscreenSupported ? (
							<SettingsToggleRow
								checked={isFullscreen}
								icon={
									isFullscreen ? (
										<Minimize2 size={14} />
									) : (
										<Maximize2 size={14} />
									)
								}
								title="Full screen"
								description={
									isFullscreen
										? "Exit browser full screen mode"
										: "Use the entire screen"
								}
								onClick={onToggleFullscreen}
							/>
						) : null}
					</div>
				</SettingsSection>

				<SettingsSection icon={<ZoomIn size={13} />} title="Display">
					<div className="grid min-w-0 gap-2">
						<ControlCard className="w-full min-w-0 bg-field/70 px-3 py-3">
							<ScaleControl
								label="Content scale"
								value={displayScale}
								onChange={onDisplayScaleChange}
							/>
						</ControlCard>
					</div>
				</SettingsSection>
			</div>
		</aside>
	);
});
