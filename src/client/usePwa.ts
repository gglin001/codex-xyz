"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type BeforeInstallPromptEvent = Event & {
	prompt: () => Promise<void>;
	userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

type PwaDisplayMode = "browser" | "standalone";
type PwaInstallState =
	| "unsupported"
	| "unavailable"
	| "available"
	| "installed";
type PwaUpdateState = "idle" | "available";

export type PwaState = {
	displayMode: PwaDisplayMode;
	installState: PwaInstallState;
	updateState: PwaUpdateState;
	online: boolean;
	serviceWorkerReady: boolean;
	canInstall: boolean;
	install: () => Promise<boolean>;
	activateUpdate: () => void;
};

function isStandaloneDisplay() {
	if (typeof window === "undefined") {
		return false;
	}
	const navigatorWithStandalone = window.navigator as Navigator & {
		standalone?: boolean;
	};
	return (
		window.matchMedia("(display-mode: standalone)").matches ||
		navigatorWithStandalone.standalone === true
	);
}

function serviceWorkerIsSupported() {
	return (
		typeof window !== "undefined" &&
		"serviceWorker" in navigator &&
		window.isSecureContext
	);
}

function pwaIsEnabled() {
	return process.env.NODE_ENV === "production";
}

async function clearPwaCaches() {
	if (typeof window === "undefined" || !("caches" in window)) {
		return;
	}
	const keys = await window.caches.keys();
	await Promise.all(
		keys
			.filter((key) => key.startsWith("coz-pwa-"))
			.map((key) => window.caches.delete(key)),
	);
}

async function unregisterServiceWorkers() {
	if (!serviceWorkerIsSupported()) {
		return false;
	}
	const registrations = await navigator.serviceWorker.getRegistrations();
	const unregisterResults = await Promise.all(
		registrations.map((registration) => registration.unregister()),
	);
	return unregisterResults.some(Boolean);
}

export function usePwa(): PwaState {
	const [displayMode, setDisplayMode] = useState<PwaDisplayMode>(
		() => "browser",
	);
	const [online, setOnline] = useState(true);
	const [installPrompt, setInstallPrompt] =
		useState<BeforeInstallPromptEvent | null>(null);
	const [installed, setInstalled] = useState(false);
	const [supported, setSupported] = useState(false);
	const [serviceWorkerReady, setServiceWorkerReady] = useState(false);
	const [updateState, setUpdateState] = useState<PwaUpdateState>("idle");
	const waitingWorkerRef = useRef<ServiceWorker | null>(null);
	const reloadOnControllerChangeRef = useRef(false);

	useEffect(() => {
		const updateDisplayMode = () => {
			const standalone = isStandaloneDisplay();
			setDisplayMode(standalone ? "standalone" : "browser");
			setInstalled(standalone);
		};
		setSupported(pwaIsEnabled() && serviceWorkerIsSupported());
		setOnline(navigator.onLine);
		const mediaQuery = window.matchMedia("(display-mode: standalone)");
		updateDisplayMode();
		mediaQuery.addEventListener("change", updateDisplayMode);
		return () => {
			mediaQuery.removeEventListener("change", updateDisplayMode);
		};
	}, []);

	useEffect(() => {
		document.documentElement.dataset.pwaDisplayMode = displayMode;
		return () => {
			delete document.documentElement.dataset.pwaDisplayMode;
		};
	}, [displayMode]);

	useEffect(() => {
		const handleOnline = () => setOnline(true);
		const handleOffline = () => setOnline(false);
		window.addEventListener("online", handleOnline);
		window.addEventListener("offline", handleOffline);
		return () => {
			window.removeEventListener("online", handleOnline);
			window.removeEventListener("offline", handleOffline);
		};
	}, []);

	useEffect(() => {
		const handleBeforeInstallPrompt = (event: Event) => {
			event.preventDefault();
			setInstallPrompt(event as BeforeInstallPromptEvent);
		};
		const handleAppInstalled = () => {
			setInstalled(true);
			setInstallPrompt(null);
		};
		window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
		window.addEventListener("appinstalled", handleAppInstalled);
		return () => {
			window.removeEventListener(
				"beforeinstallprompt",
				handleBeforeInstallPrompt,
			);
			window.removeEventListener("appinstalled", handleAppInstalled);
		};
	}, []);

	useEffect(() => {
		if (!pwaIsEnabled()) {
			let disposed = false;
			const cleanupDevelopmentPwaState = async () => {
				try {
					const hadController = Boolean(navigator.serviceWorker?.controller);
					const unregistered = await unregisterServiceWorkers();
					await clearPwaCaches();
					if (!disposed) {
						setServiceWorkerReady(false);
						setUpdateState("idle");
					}
					if (
						hadController &&
						unregistered &&
						window.sessionStorage.getItem("coz-dev-sw-cleanup-reloaded") !==
							"true"
					) {
						window.sessionStorage.setItem(
							"coz-dev-sw-cleanup-reloaded",
							"true",
						);
						window.location.reload();
					}
				} catch {
					if (!disposed) {
						setServiceWorkerReady(false);
					}
				}
			};
			void cleanupDevelopmentPwaState();
			return () => {
				disposed = true;
			};
		}

		if (!serviceWorkerIsSupported()) {
			return;
		}

		let disposed = false;

		const markUpdateAvailable = (worker: ServiceWorker) => {
			waitingWorkerRef.current = worker;
			setUpdateState("available");
		};

		const registerServiceWorker = async () => {
			try {
				const registration = await navigator.serviceWorker.register(
					"/sw.js?env=production",
					{
						scope: "/",
					},
				);
				if (disposed) {
					return;
				}

				setServiceWorkerReady(Boolean(navigator.serviceWorker.controller));

				if (registration.waiting) {
					markUpdateAvailable(registration.waiting);
				}

				registration.addEventListener("updatefound", () => {
					const nextWorker = registration.installing;
					if (!nextWorker) {
						return;
					}
					nextWorker.addEventListener("statechange", () => {
						if (
							nextWorker.state === "installed" &&
							navigator.serviceWorker.controller
						) {
							markUpdateAvailable(nextWorker);
						}
					});
				});

				await navigator.serviceWorker.ready;
				if (!disposed) {
					setServiceWorkerReady(true);
				}
			} catch {
				if (!disposed) {
					setServiceWorkerReady(false);
				}
			}
		};

		const handleControllerChange = () => {
			setServiceWorkerReady(true);
			if (!reloadOnControllerChangeRef.current) {
				return;
			}
			reloadOnControllerChangeRef.current = false;
			window.location.reload();
		};

		void registerServiceWorker();
		navigator.serviceWorker.addEventListener(
			"controllerchange",
			handleControllerChange,
		);
		return () => {
			disposed = true;
			navigator.serviceWorker.removeEventListener(
				"controllerchange",
				handleControllerChange,
			);
		};
	}, []);

	const install = useCallback(async () => {
		if (!installPrompt) {
			return false;
		}

		const promptEvent = installPrompt;
		setInstallPrompt(null);
		await promptEvent.prompt();
		const choice = await promptEvent.userChoice;
		return choice.outcome === "accepted";
	}, [installPrompt]);

	const activateUpdate = useCallback(() => {
		const waitingWorker = waitingWorkerRef.current;
		if (!waitingWorker) {
			return;
		}
		reloadOnControllerChangeRef.current = true;
		waitingWorker.postMessage({ type: "SKIP_WAITING" });
		waitingWorkerRef.current = null;
	}, []);

	const installState = useMemo<PwaInstallState>(() => {
		if (installed || displayMode === "standalone") {
			return "installed";
		}
		if (installPrompt) {
			return "available";
		}
		return supported ? "unavailable" : "unsupported";
	}, [displayMode, installPrompt, installed, supported]);

	return {
		displayMode,
		installState,
		updateState,
		online,
		serviceWorkerReady,
		canInstall: installState === "available",
		install,
		activateUpdate,
	};
}
