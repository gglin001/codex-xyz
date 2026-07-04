import { describe, expect, it } from "vitest";
import { readDebugLevel, readLocalWebSearchConfig } from "../src/config.js";

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

	it("leaves local web search disabled by default", () => {
		expect(readLocalWebSearchConfig({})).toBeNull();
		expect(
			readLocalWebSearchConfig({ COZ_WEB_SEARCH_PROVIDER: "disabled" }),
		).toBeNull();
	});

	it("reads local SearxNG web search config", () => {
		expect(
			readLocalWebSearchConfig({
				COZ_WEB_SEARCH_PROVIDER: "searxng",
				COZ_SEARXNG_URL: "http://127.0.0.1:8080",
				COZ_WEB_SEARCH_MAX_RESULTS: "7",
				COZ_WEB_SEARCH_TIMEOUT_MS: "5000",
			}),
		).toEqual({
			provider: "searxng",
			endpoint: "http://127.0.0.1:8080",
			maxResults: 7,
			timeoutMs: 5000,
		});
	});

	it("rejects invalid local web search config", () => {
		expect(() =>
			readLocalWebSearchConfig({ COZ_WEB_SEARCH_PROVIDER: "openai" }),
		).toThrow(/searxng or disabled/);
		expect(() =>
			readLocalWebSearchConfig({ COZ_WEB_SEARCH_PROVIDER: "searxng" }),
		).toThrow(/COZ_SEARXNG_URL is required/);
		expect(() =>
			readLocalWebSearchConfig({
				COZ_WEB_SEARCH_PROVIDER: "searxng",
				COZ_SEARXNG_URL: "file:///tmp/search",
			}),
		).toThrow(/http or https/);
	});
});
