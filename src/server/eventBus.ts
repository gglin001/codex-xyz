import type { XyzEvent } from "./domain.js";

export type EventListener = (event: XyzEvent) => void;

export class EventBus {
	private readonly listeners = new Set<EventListener>();

	publish(event: XyzEvent) {
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
