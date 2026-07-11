import { describe, expect, it } from "vitest";
import { readDebugLevel, readWebSearchConfig } from "../src/config.js";

describe("runtime environment config", () => {
	it("reads debug logging level", () => {
		expect(readDebugLevel({})).toBe(0);
		expect(readDebugLevel({ COZ_DEBUG_LEVEL: "2" })).toBe(2);
	});

	it("rejects invalid debug logging levels", () => {
		expect(() => readDebugLevel({ COZ_DEBUG_LEVEL: "4" })).toThrow(
			/integer between 0 and 3/,
		);
		expect(() => readDebugLevel({ COZ_DEBUG_LEVEL: "debug" })).toThrow(
			/integer between 0 and 3/,
		);
	});
});

describe("web search environment config", () => {
	it("keeps web search disabled until a provider is configured", () => {
		expect(readWebSearchConfig({})).toBeNull();
	});

	it("reads SearXNG settings", () => {
		expect(
			readWebSearchConfig({
				COZ_WEB_SEARCH_PROVIDER: "searxng",
				COZ_SEARXNG_URL: "https://search.example.com",
				COZ_WEB_SEARCH_TIMEOUT_MS: "9000",
			}),
		).toEqual({
			provider: "searxng",
			baseUrl: new URL("https://search.example.com/"),
			timeoutMs: 9000,
		});
	});

	it("rejects incomplete or invalid settings", () => {
		expect(() =>
			readWebSearchConfig({ COZ_WEB_SEARCH_PROVIDER: "searxng" }),
		).toThrow(/COZ_SEARXNG_URL/);
		expect(() =>
			readWebSearchConfig({
				COZ_WEB_SEARCH_PROVIDER: "brave",
				COZ_SEARXNG_URL: "https://search.example.com",
			}),
		).toThrow(/must be searxng/);
		expect(() =>
			readWebSearchConfig({
				COZ_WEB_SEARCH_PROVIDER: "searxng",
				COZ_SEARXNG_URL: "file:///tmp/search",
			}),
		).toThrow(/http or https/);
	});
});
