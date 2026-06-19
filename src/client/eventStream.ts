"use client";

import { useEffect, useRef } from "react";
import { apiUrl } from "./api.js";

type EventStreamConnectionOptions = {
  path: string;
  eventNames: readonly string[];
  onEvent: (event: Event) => void;
  onOpen?: () => void;
  onError?: () => void;
};

type EventStreamSubscriptionOptions = {
  enabled: boolean;
  subscriptionKey: string | null;
  eventNames: readonly string[];
  getPath: () => string;
  onEvent: (event: Event) => void;
  reconnectDelayMs?: number;
};

export function parseSseJsonEvent<T>(rawEvent: Event) {
  const message = rawEvent as MessageEvent<string>;
  return JSON.parse(message.data) as T;
}

export function openEventStream({ path, eventNames, onEvent, onOpen, onError }: EventStreamConnectionOptions) {
  const source = new EventSource(apiUrl(path));
  source.onmessage = onEvent;
  source.onopen = onOpen ?? null;
  source.onerror = onError ?? null;
  for (const eventName of eventNames) {
    source.addEventListener(eventName, onEvent);
  }
  return () => {
    source.close();
  };
}

export function useEventStreamSubscription({
  enabled,
  subscriptionKey,
  eventNames,
  getPath,
  onEvent,
  reconnectDelayMs = 1200
}: EventStreamSubscriptionOptions) {
  const latestRef = useRef({
    eventNames,
    getPath,
    onEvent
  });
  latestRef.current = {
    eventNames,
    getPath,
    onEvent
  };

  useEffect(() => {
    if (!enabled || !subscriptionKey) {
      return;
    }

    let closeConnection: (() => void) | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;

    const closeSource = () => {
      closeConnection?.();
      closeConnection = null;
    };

    function connect() {
      closeSource();
      const handleEvent = (rawEvent: Event) => latestRef.current.onEvent(rawEvent);
      closeConnection = openEventStream({
        path: latestRef.current.getPath(),
        eventNames: latestRef.current.eventNames,
        onEvent: handleEvent,
        onError: () => {
          closeSource();
          if (!disposed) {
            reconnectTimer = setTimeout(connect, reconnectDelayMs);
          }
        }
      });
    }

    connect();
    return () => {
      disposed = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
      }
      closeSource();
    };
  }, [enabled, reconnectDelayMs, subscriptionKey]);
}
