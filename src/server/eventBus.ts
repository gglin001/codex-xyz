import type { CozEvent } from "./domain.js";

export type EventListener = (event: CozEvent) => void;

export class EventBus {
	private readonly listeners = new Set<EventListener>();

	publish(event: CozEvent) {
		for (const listener of this.listeners) {
			listener(event);
		}
	}

	subscribe(listener: EventListener) {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}
}
