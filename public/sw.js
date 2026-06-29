const CACHE_VERSION = "coz-pwa-v1";
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;
const PRECACHE_URLS = [
	"/manifest.webmanifest",
	"/offline.html",
	"/icons/icon.svg",
	"/icons/icon-192.png",
	"/icons/icon-512.png",
	"/icons/apple-touch-icon.png",
];

function isSameOrigin(url) {
	return url.origin === self.location.origin;
}

function isApiRequest(url) {
	return url.pathname === "/api" || url.pathname.startsWith("/api/");
}

function isStaticAsset(url) {
	return (
		url.pathname.startsWith("/_next/static/") ||
		url.pathname.startsWith("/icons/") ||
		url.pathname === "/manifest.webmanifest"
	);
}

function isHtmlNavigation(request) {
	return request.mode === "navigate";
}

async function cacheFirst(request) {
	const cached = await caches.match(request);
	if (cached) {
		return cached;
	}
	const response = await fetch(request);
	if (response.ok) {
		const cache = await caches.open(RUNTIME_CACHE);
		await cache.put(request, response.clone());
	}
	return response;
}

async function networkFirstNavigation(request) {
	try {
		return await fetch(request);
	} catch {
		const cached = await caches.match("/offline.html");
		return (
			cached ??
			new Response("coz is offline", {
				status: 503,
				headers: { "content-type": "text/plain; charset=utf-8" },
			})
		);
	}
}

self.addEventListener("install", (event) => {
	event.waitUntil(
		caches
			.open(STATIC_CACHE)
			.then((cache) =>
				Promise.allSettled(PRECACHE_URLS.map((url) => cache.add(url))),
			),
	);
});

self.addEventListener("activate", (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((keys) =>
				Promise.all(
					keys
						.filter((key) => !key.startsWith(CACHE_VERSION))
						.map((key) => caches.delete(key)),
				),
			)
			.then(() => self.clients.claim()),
	);
});

self.addEventListener("message", (event) => {
	if (event.data?.type === "SKIP_WAITING") {
		self.skipWaiting();
	}
});

self.addEventListener("fetch", (event) => {
	const { request } = event;
	if (request.method !== "GET") {
		return;
	}

	const url = new URL(request.url);
	if (!isSameOrigin(url) || isApiRequest(url)) {
		return;
	}

	if (isHtmlNavigation(request)) {
		event.respondWith(networkFirstNavigation(request));
		return;
	}

	if (isStaticAsset(url)) {
		event.respondWith(cacheFirst(request));
	}
});
