import { Buffer } from "node:buffer";
import { chmodSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";
import { SerializeAddon } from "@xterm/addon-serialize";
import HeadlessModule from "@xterm/headless";
import type { IDisposable, IPty, IPtyForkOptions } from "node-pty";
import * as pty from "node-pty";
import type { TerminalEvent, TerminalSnapshot } from "./domain.js";
import { nowIso } from "./domain.js";

type TerminalCommand = {
	file: string;
	args: string[];
};

type PtyFactory = (
	file: string,
	args: string[],
	options: IPtyForkOptions,
) => IPty;
type TerminalSubscriber = (event: TerminalEvent) => void;
type HeadlessTerminalConstructor = typeof import("@xterm/headless").Terminal;
type HeadlessTerminalInstance = InstanceType<HeadlessTerminalConstructor>;
type TerminalSnapshotOptions = {
	includeScreen?: boolean;
	scrollback?: number;
};

const HeadlessTerminal = (
	HeadlessModule as unknown as { Terminal: HeadlessTerminalConstructor }
).Terminal;
const require = createRequire(import.meta.url);

export type TerminalControllerOptions = {
	cwd?: string;
	command?: TerminalCommand;
	env?: NodeJS.ProcessEnv;
	ptyFactory?: PtyFactory;
	scrollback?: number;
	maxReplayEvents?: number;
	maxReplayBytes?: number;
};

const defaultCols = 100;
const defaultRows = 28;
const outputFlushMs = 16;
const maxPendingOutputBytes = 64 * 1024;

function loginShellCommand(env: NodeJS.ProcessEnv): TerminalCommand {
	return {
		file: env.SHELL ?? "/bin/sh",
		args: ["-l"],
	};
}

function clampDimension(
	value: number | null | undefined,
	fallback: number,
	max: number,
) {
	if (!Number.isInteger(value) || !value || value < 1) {
		return fallback;
	}
	return Math.min(value, max);
}

function commandLabel(command: TerminalCommand) {
	return [command.file, ...command.args].join(" ");
}

function createHeadlessTerminal(
	cols: number,
	rows: number,
	scrollback: number,
) {
	const terminal = new HeadlessTerminal({
		cols,
		rows,
		scrollback,
		allowProposedApi: true,
		convertEol: false,
		logLevel: "off",
	});
	const serialize = new SerializeAddon();
	terminal.loadAddon(
		serialize as unknown as Parameters<
			HeadlessTerminalInstance["loadAddon"]
		>[0],
	);
	return { terminal, serialize };
}

function ensureNodePtySpawnHelperExecutable() {
	const packageRoot = dirname(dirname(require.resolve("node-pty")));
	for (const dir of [
		"build/Release",
		"build/Debug",
		`prebuilds/${process.platform}-${process.arch}`,
	]) {
		const helperPath = join(packageRoot, dir, "spawn-helper");
		try {
			const stat = statSync(helperPath);
			if ((stat.mode & 0o111) === 0) {
				chmodSync(helperPath, stat.mode | 0o755);
			}
			return;
		} catch {
			// node-pty checks the same ordered locations; missing candidates are expected.
		}
	}
}

export class TerminalController {
	private cwd: string;
	private command: TerminalCommand;
	private readonly env: NodeJS.ProcessEnv;
	private readonly ptyFactory: PtyFactory;
	private readonly scrollback: number;
	private readonly maxReplayEvents: number;
	private readonly maxReplayBytes: number;
	private process: IPty | null = null;
	private disposables: IDisposable[] = [];
	private status: TerminalSnapshot["status"] = "idle";
	private pid: number | null = null;
	private cols = defaultCols;
	private rows = defaultRows;
	private startedAt: string | null = null;
	private updatedAt = nowIso();
	private title: string | null = null;
	private exitCode: number | null = null;
	private signal: number | string | null = null;
	private error: string | null = null;
	private sequence = 0;
	private replayBytes = 0;
	private pendingOutputChunks: string[] = [];
	private pendingOutputBytes = 0;
	private outputTimer: ReturnType<typeof setTimeout> | null = null;
	private modelWriteChain: Promise<void> = Promise.resolve();
	private modelPendingWrites = 0;
	private ptyOutputChunks = 0;
	private ptyOutputBytes = 0;
	private outputFlushes = 0;
	private outputEventBytes = 0;
	private inputWrites = 0;
	private inputBytes = 0;
	private modelWrites = 0;
	private modelWriteBytes = 0;
	private modelWriteMs = 0;
	private outputPauseCount = 0;
	private outputResumeCount = 0;
	private outputPaused = false;
	private processOutputPaused = false;
	private readonly outputPauseTokens = new Set<symbol>();
	private readonly replayEvents: TerminalEvent[] = [];
	private readonly subscribers = new Set<TerminalSubscriber>();
	private model = createHeadlessTerminal(defaultCols, defaultRows, 2_000);

	constructor(options: TerminalControllerOptions = {}) {
		this.cwd = options.cwd ?? process.cwd();
		this.env = options.env ?? process.env;
		this.command = options.command ?? loginShellCommand(this.env);
		this.ptyFactory =
			options.ptyFactory ??
			((file, args, ptyOptions) => pty.spawn(file, args, ptyOptions));
		this.scrollback = options.scrollback ?? 2_000;
		this.maxReplayEvents = options.maxReplayEvents ?? 256;
		this.maxReplayBytes = options.maxReplayBytes ?? 1024 * 1024;
		this.model = createHeadlessTerminal(this.cols, this.rows, this.scrollback);
	}

	configure(input: { cwd?: string; command?: TerminalCommand }) {
		if (input.cwd) {
			this.cwd = input.cwd;
		}
		if (input.command) {
			this.command = input.command;
		}
	}

	async snapshot(
		options: TerminalSnapshotOptions = {},
	): Promise<TerminalSnapshot> {
		this.flushPendingOutput();
		await this.modelWriteChain;
		return this.currentSnapshot(options);
	}

	async start(input: { cols?: number | null; rows?: number | null } = {}) {
		this.resizeModel(input.cols, input.rows);
		if (this.process) {
			return this.snapshot();
		}

		this.resetModel();
		this.status = "starting";
		this.pid = null;
		this.startedAt = nowIso();
		this.updatedAt = this.startedAt;
		this.exitCode = null;
		this.signal = null;
		this.error = null;
		this.publishStatus();

		try {
			ensureNodePtySpawnHelperExecutable();
			const child = this.ptyFactory(this.command.file, this.command.args, {
				name: "xterm-256color",
				cols: this.cols,
				rows: this.rows,
				cwd: this.cwd,
				env: {
					...this.env,
					TERM: "xterm-256color",
					COLORTERM: "truecolor",
					FORCE_COLOR: this.env.FORCE_COLOR ?? "1",
					CODEX_XYZ_TERMINAL: "1",
				},
				encoding: "utf8",
			});
			this.process = child;
			this.pid = child.pid;
			this.status = "running";
			this.updatedAt = nowIso();
			this.disposables = [
				child.onData((data) => this.handleOutput(data)),
				child.onExit((exit) => this.handleExit(exit)),
			];
			this.updateOutputFlowControl();
			this.publishStatus();
			return this.snapshot();
		} catch (error) {
			this.disposeProcessListeners();
			this.process = null;
			this.pid = null;
			this.status = "failed";
			this.error =
				error instanceof Error ? error.message : "Failed to start terminal";
			this.updatedAt = nowIso();
			this.publishStatus();
			return this.snapshot();
		}
	}

	write(data: string) {
		if (!this.process || this.status !== "running") {
			throw new Error("Terminal is not running");
		}
		this.inputWrites += 1;
		this.inputBytes += Buffer.byteLength(data, "utf8");
		this.process.write(data);
	}

	async resize(input: { cols?: number | null; rows?: number | null }) {
		const resized = this.resizeModel(input.cols, input.rows);
		if (resized && this.process) {
			this.process.resize(this.cols, this.rows);
			this.updatedAt = nowIso();
			this.publishStatus();
		}
		return this.currentSnapshot({ includeScreen: false });
	}

	async terminate() {
		if (!this.process) {
			return this.currentSnapshot({ includeScreen: false });
		}
		this.process.kill();
		return this.currentSnapshot({ includeScreen: false });
	}

	replay(afterSequence = 0) {
		return this.replayEvents.filter((event) => event.sequence > afterSequence);
	}

	subscribe(subscriber: TerminalSubscriber) {
		this.subscribers.add(subscriber);
		return () => {
			this.subscribers.delete(subscriber);
		};
	}

	pauseOutput(token: symbol) {
		this.outputPauseTokens.add(token);
		this.updateOutputFlowControl();
	}

	resumeOutput(token: symbol) {
		this.outputPauseTokens.delete(token);
		this.updateOutputFlowControl();
	}

	async close() {
		if (this.outputTimer) {
			clearTimeout(this.outputTimer);
			this.outputTimer = null;
		}
		this.flushPendingOutput();
		this.disposeProcessListeners();
		const child = this.process;
		this.process = null;
		this.processOutputPaused = false;
		if (child) {
			child.kill();
		}
		await this.modelWriteChain.catch(() => {});
		this.model.terminal.dispose();
		this.subscribers.clear();
	}

	private handleOutput(data: string) {
		this.title = this.process?.process || this.title;
		const bytes = Buffer.byteLength(data, "utf8");
		this.ptyOutputChunks += 1;
		this.ptyOutputBytes += bytes;
		this.pendingOutputChunks.push(data);
		this.pendingOutputBytes += bytes;
		if (this.pendingOutputBytes >= maxPendingOutputBytes) {
			this.flushPendingOutput();
			return;
		}
		if (!this.outputTimer) {
			this.outputTimer = setTimeout(
				() => this.flushPendingOutput(),
				outputFlushMs,
			);
		}
	}

	private handleExit(exit: { exitCode: number; signal?: number }) {
		this.flushPendingOutput();
		this.disposeProcessListeners();
		this.process = null;
		this.processOutputPaused = false;
		this.status = exit.exitCode === 0 ? "exited" : "failed";
		this.exitCode = exit.exitCode;
		this.signal = exit.signal ?? null;
		this.pid = null;
		this.updatedAt = nowIso();
		this.publishStatus();
	}

	private resizeModel(
		cols: number | null | undefined,
		rows: number | null | undefined,
	) {
		const nextCols = clampDimension(cols, this.cols, 500);
		const nextRows = clampDimension(rows, this.rows, 200);
		if (nextCols === this.cols && nextRows === this.rows) {
			return false;
		}
		this.cols = nextCols;
		this.rows = nextRows;
		this.model.terminal.resize(this.cols, this.rows);
		return true;
	}

	private resetModel() {
		this.model.terminal.dispose();
		this.model = createHeadlessTerminal(this.cols, this.rows, this.scrollback);
		this.modelWriteChain = Promise.resolve();
		this.modelPendingWrites = 0;
	}

	private enqueueModelWrite(data: string, bytes: number) {
		this.modelPendingWrites += 1;
		const write = () =>
			new Promise<void>((resolve) => {
				const startedAt = performance.now();
				let settled = false;
				const finish = () => {
					if (settled) {
						return;
					}
					settled = true;
					this.modelPendingWrites = Math.max(0, this.modelPendingWrites - 1);
					this.modelWrites += 1;
					this.modelWriteBytes += bytes;
					this.modelWriteMs += performance.now() - startedAt;
					resolve();
				};
				try {
					this.model.terminal.write(data, finish);
				} catch {
					finish();
				}
			});
		this.modelWriteChain = this.modelWriteChain
			.catch(() => {})
			.then(write)
			.catch(() => {});
	}

	private flushPendingOutput() {
		if (this.outputTimer) {
			clearTimeout(this.outputTimer);
			this.outputTimer = null;
		}
		if (this.pendingOutputChunks.length === 0) {
			return;
		}
		const data =
			this.pendingOutputChunks.length === 1
				? this.pendingOutputChunks[0]
				: this.pendingOutputChunks.join("");
		const bytes = this.pendingOutputBytes;
		this.pendingOutputChunks = [];
		this.pendingOutputBytes = 0;
		this.enqueueModelWrite(data, bytes);
		this.outputFlushes += 1;
		this.outputEventBytes += bytes;
		this.updatedAt = nowIso();
		this.publish({
			sequence: this.nextSequence(),
			type: "terminal.output",
			data,
			createdAt: this.updatedAt,
		});
	}

	private publishStatus() {
		this.publish({
			sequence: this.nextSequence(),
			type: "terminal.status",
			snapshot: this.currentSnapshot({ includeScreen: false }),
			createdAt: this.updatedAt,
		});
	}

	private publish(event: TerminalEvent) {
		this.replayEvents.push(event);
		this.replayBytes += this.eventSize(event);
		while (
			this.replayEvents.length > this.maxReplayEvents ||
			this.replayBytes > this.maxReplayBytes
		) {
			const removed = this.replayEvents.shift();
			if (!removed) {
				break;
			}
			this.replayBytes -= this.eventSize(removed);
		}
		for (const subscriber of this.subscribers) {
			subscriber(event);
		}
	}

	private updateOutputFlowControl() {
		const shouldPause = this.outputPauseTokens.size > 0;
		this.outputPaused = shouldPause;
		if (!this.process || this.processOutputPaused === shouldPause) {
			return;
		}
		const processWithFlowControl = this.process as IPty & {
			pause?: () => void;
			resume?: () => void;
		};
		if (shouldPause) {
			processWithFlowControl.pause?.();
			this.outputPauseCount += 1;
		} else {
			processWithFlowControl.resume?.();
			this.outputResumeCount += 1;
		}
		this.processOutputPaused = shouldPause;
	}

	private eventSize(event: TerminalEvent) {
		if (event.type === "terminal.output") {
			return Buffer.byteLength(event.data, "utf8");
		}
		return 256;
	}

	private nextSequence() {
		this.sequence += 1;
		return this.sequence;
	}

	private currentSnapshot(
		options: TerminalSnapshotOptions = {},
	): TerminalSnapshot {
		const includeScreen = options.includeScreen ?? true;
		return {
			status: this.status,
			command: commandLabel(this.command),
			cwd: this.cwd,
			pid: this.pid,
			cols: this.cols,
			rows: this.rows,
			sequence: this.sequence,
			screen: includeScreen
				? this.model.serialize.serialize({
						scrollback: options.scrollback ?? 200,
					})
				: "",
			title: this.title,
			startedAt: this.startedAt,
			updatedAt: this.updatedAt,
			exitCode: this.exitCode,
			signal: this.signal,
			error: this.error,
			stats: {
				ptyOutputChunks: this.ptyOutputChunks,
				ptyOutputBytes: this.ptyOutputBytes,
				outputFlushes: this.outputFlushes,
				outputEventBytes: this.outputEventBytes,
				inputWrites: this.inputWrites,
				inputBytes: this.inputBytes,
				modelWrites: this.modelWrites,
				modelWriteBytes: this.modelWriteBytes,
				modelWriteMs: this.modelWriteMs,
				modelPendingWrites: this.modelPendingWrites,
				pendingOutputBytes: this.pendingOutputBytes,
				replayEvents: this.replayEvents.length,
				replayBytes: this.replayBytes,
				outputPaused: this.outputPaused,
				outputPauseCount: this.outputPauseCount,
				outputResumeCount: this.outputResumeCount,
			},
		};
	}

	private disposeProcessListeners() {
		for (const disposable of this.disposables) {
			disposable.dispose();
		}
		this.disposables = [];
	}
}

export type { PtyFactory, TerminalCommand };
