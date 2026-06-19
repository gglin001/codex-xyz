import { isAdapterThreadNotFoundError } from "./codex/adapter.js";
import type { ControlThread } from "./domain.js";

export type RuntimeContinuation = {
  prompt: string;
  model: string | null;
};

export type RuntimeThreadActionOptions = {
  continuation?: RuntimeContinuation;
};

export type RuntimeThreadActionResult<T> = {
  thread: ControlThread;
  value: T;
};

type RuntimeThreadCoordinatorInput = {
  resumeThread: (thread: ControlThread) => Promise<ControlThread | null>;
  markThreadLost: (thread: ControlThread) => void;
  createContinuationThread: (thread: ControlThread, continuation: RuntimeContinuation) => Promise<ControlThread>;
  notResumableError: (thread: ControlThread) => Error;
};

export class RuntimeThreadCoordinator {
  constructor(private readonly input: RuntimeThreadCoordinatorInput) {}

  async run<T>(
    thread: ControlThread,
    action: (thread: ControlThread) => Promise<T>,
    options: RuntimeThreadActionOptions = {}
  ): Promise<RuntimeThreadActionResult<T>> {
    try {
      return {
        thread,
        value: await action(thread)
      };
    } catch (error) {
      if (!isAdapterThreadNotFoundError(error)) {
        throw error;
      }
    }

    const resumedThread = await this.input.resumeThread(thread);
    if (resumedThread) {
      try {
        return {
          thread: resumedThread,
          value: await action(resumedThread)
        };
      } catch (error) {
        if (!isAdapterThreadNotFoundError(error)) {
          throw error;
        }
        if (!options.continuation) {
          this.input.markThreadLost(thread);
          throw error;
        }
      }
    }

    if (!options.continuation) {
      this.input.markThreadLost(thread);
      throw this.input.notResumableError(thread);
    }

    const continuation = await this.input.createContinuationThread(thread, options.continuation);
    return {
      thread: continuation,
      value: await action(continuation)
    };
  }
}
