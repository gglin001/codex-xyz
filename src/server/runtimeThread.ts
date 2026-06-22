import { isAdapterThreadNotFoundError } from "./codex/adapter.js";
import type { ControlThread } from "./domain.js";

export type RuntimeForkInput = {
	prompt: string;
	model: string | null;
};

export type RuntimeThreadActionOptions = {
	fork?: RuntimeForkInput;
};

export type RuntimeThreadActionResult<T> = {
	thread: ControlThread;
	value: T;
};

type RuntimeThreadCoordinatorInput = {
	resumeThread: (thread: ControlThread) => Promise<ControlThread | null>;
	markThreadLost: (thread: ControlThread) => void;
	forkThread: (
		thread: ControlThread,
		input: RuntimeForkInput,
	) => Promise<ControlThread>;
	notResumableError: (thread: ControlThread) => Error;
};

export class RuntimeThreadCoordinator {
	constructor(private readonly input: RuntimeThreadCoordinatorInput) {}

	async run<T>(
		thread: ControlThread,
		action: (thread: ControlThread) => Promise<T>,
		options: RuntimeThreadActionOptions = {},
	): Promise<RuntimeThreadActionResult<T>> {
		try {
			return {
				thread,
				value: await action(thread),
			};
		} catch (error) {
			if (!isAdapterThreadNotFoundError(error)) {
				throw error;
			}
		}

		let forkSource = thread;
		const resumedThread = await this.input.resumeThread(thread);
		if (resumedThread) {
			forkSource = resumedThread;
			try {
				return {
					thread: resumedThread,
					value: await action(resumedThread),
				};
			} catch (error) {
				if (!isAdapterThreadNotFoundError(error)) {
					throw error;
				}
				if (!options.fork) {
					this.input.markThreadLost(thread);
					throw error;
				}
			}
		}

		if (!options.fork) {
			this.input.markThreadLost(thread);
			throw this.input.notResumableError(thread);
		}

		const fork = await this.input.forkThread(forkSource, options.fork);
		return {
			thread: fork,
			value: await action(fork),
		};
	}
}
