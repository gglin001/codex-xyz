import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { type PtyFactory, TerminalController } from "../src/server/terminal.js";

class FakePty {
	readonly pid = 4242;
	process = "fake-codex";
	handleFlowControl = false;
	readonly emitter = new EventEmitter();
	writes: string[] = [];
	killed = false;
	paused = false;
	pauseCount = 0;
	resumeCount = 0;
	cols: number;
	rows: number;

	constructor(cols: number, rows: number) {
		this.cols = cols;
		this.rows = rows;
	}

	onData(listener: (data: string) => void) {
		this.emitter.on("data", listener);
		return {
			dispose: () => this.emitter.off("data", listener),
		};
	}

	onExit(listener: (exit: { exitCode: number; signal?: number }) => void) {
		this.emitter.on("exit", listener);
		return {
			dispose: () => this.emitter.off("exit", listener),
		};
	}

	resize(cols: number, rows: number) {
		this.cols = cols;
		this.rows = rows;
	}

	clear() {}

	write(data: string | Buffer) {
		this.writes.push(data.toString());
	}

	kill() {
		this.killed = true;
		this.emitter.emit("exit", { exitCode: 0 });
	}

	pause() {
		this.paused = true;
		this.pauseCount += 1;
	}

	resume() {
		this.paused = false;
		this.resumeCount += 1;
	}

	emitData(data: string) {
		this.emitter.emit("data", data);
	}
}

let tempDir: string | null = null;

afterEach(() => {
	if (tempDir) {
		rmSync(tempDir, { recursive: true, force: true });
		tempDir = null;
	}
});

describe("TerminalController", () => {
	it("starts the configured login shell by default", async () => {
		tempDir = mkdtempSync(join(tmpdir(), "coz-terminal-"));
		const spawned: Array<{ file: string; args: string[] }> = [];
		const factory: PtyFactory = (file, args, options) => {
			spawned.push({ file, args });
			return new FakePty(options.cols ?? 80, options.rows ?? 24);
		};
		const terminal = new TerminalController({
			cwd: tempDir,
			env: { ...process.env, SHELL: "/bin/test-shell" },
			ptyFactory: factory,
		});

		const snapshot = await terminal.start();

		expect(spawned).toEqual([{ file: "/bin/test-shell", args: ["-l"] }]);
		expect(snapshot.command).toBe("/bin/test-shell -l");

		await terminal.close();
	});

	it("keeps the pty alive across subscribers and replays terminal state", async () => {
		tempDir = mkdtempSync(join(tmpdir(), "coz-terminal-"));
		const ptys: FakePty[] = [];
		const factory: PtyFactory = (_file, _args, options) => {
			const fake = new FakePty(options.cols ?? 80, options.rows ?? 24);
			ptys.push(fake);
			return fake;
		};
		const terminal = new TerminalController({
			cwd: tempDir,
			command: { file: "fake-codex", args: [] },
			ptyFactory: factory,
			scrollback: 100,
		});

		const events: string[] = [];
		const unsubscribe = terminal.subscribe((event) => events.push(event.type));
		const started = await terminal.start({ cols: 80, rows: 24 });

		expect(started.status).toBe("running");
		expect(started.pid).toBe(4242);
		expect(ptys).toHaveLength(1);

		unsubscribe();
		ptys[0].emitData("hello from codex\r\n");
		await new Promise((resolve) => setTimeout(resolve, 25));

		const snapshot = await terminal.snapshot();
		expect(snapshot.status).toBe("running");
		expect(snapshot.screen).toContain("hello from codex");
		expect(
			terminal
				.replay(started.sequence)
				.some((event) => event.type === "terminal.output"),
		).toBe(true);
		expect(ptys[0].killed).toBe(false);
		expect(events).toContain("terminal.status");

		await terminal.close();
		expect(ptys[0].killed).toBe(true);
	});

	it("forwards input and resize operations to the active pty", async () => {
		tempDir = mkdtempSync(join(tmpdir(), "coz-terminal-"));
		const ptys: FakePty[] = [];
		const factory: PtyFactory = (_file, _args, options) => {
			const fake = new FakePty(options.cols ?? 80, options.rows ?? 24);
			ptys.push(fake);
			return fake;
		};
		const terminal = new TerminalController({
			cwd: tempDir,
			command: { file: "fake-codex", args: [] },
			ptyFactory: factory,
		});

		await terminal.start({ cols: 90, rows: 30 });
		terminal.write("abc");
		await terminal.resize({ cols: 100, rows: 32 });

		expect(ptys[0].writes).toEqual(["abc"]);
		expect(ptys[0].cols).toBe(100);
		expect(ptys[0].rows).toBe(32);
		expect((await terminal.resize({ cols: 100, rows: 32 })).screen).toBe("");

		await terminal.close();
	});

	it("batches small output chunks before writing the headless model", async () => {
		tempDir = mkdtempSync(join(tmpdir(), "coz-terminal-"));
		const ptys: FakePty[] = [];
		const factory: PtyFactory = (_file, _args, options) => {
			const fake = new FakePty(options.cols ?? 80, options.rows ?? 24);
			ptys.push(fake);
			return fake;
		};
		const terminal = new TerminalController({
			cwd: tempDir,
			command: { file: "fake-codex", args: [] },
			ptyFactory: factory,
		});

		await terminal.start({ cols: 80, rows: 24 });
		for (let index = 0; index < 128; index += 1) {
			ptys[0].emitData(`chunk-${index}\r\n`);
		}
		await new Promise((resolve) => setTimeout(resolve, 25));

		const snapshot = await terminal.snapshot();
		expect(snapshot.stats.ptyOutputChunks).toBe(128);
		expect(snapshot.stats.outputFlushes).toBe(1);
		expect(snapshot.stats.modelWrites).toBe(1);
		expect(snapshot.screen).toContain("chunk-127");

		await terminal.close();
	});

	it("pauses and resumes the pty when output backpressure is active", async () => {
		tempDir = mkdtempSync(join(tmpdir(), "coz-terminal-"));
		const ptys: FakePty[] = [];
		const factory: PtyFactory = (_file, _args, options) => {
			const fake = new FakePty(options.cols ?? 80, options.rows ?? 24);
			ptys.push(fake);
			return fake;
		};
		const terminal = new TerminalController({
			cwd: tempDir,
			command: { file: "fake-codex", args: [] },
			ptyFactory: factory,
		});

		await terminal.start();
		const token = Symbol("test-backpressure");
		terminal.pauseOutput(token);
		expect(ptys[0].paused).toBe(true);
		expect(ptys[0].pauseCount).toBe(1);

		terminal.resumeOutput(token);
		expect(ptys[0].paused).toBe(false);
		expect(ptys[0].resumeCount).toBe(1);

		await terminal.close();
	});
});
