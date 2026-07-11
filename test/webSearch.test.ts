import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSearchDynamicToolBridge } from "../src/server/search/dynamicToolBridge.js";
import { SearxngSearchProvider } from "../src/server/search/providers/searxng.js";
import type {
	SearchProvider,
	WebSearchService,
} from "../src/server/search/types.js";
import { DefaultWebSearchService } from "../src/server/search/webSearchService.js";

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("SearxngSearchProvider", () => {
	it("maps provider results and provider-neutral filters", async () => {
		const fetchMock = vi.fn(
			async (_input: URL | RequestInfo) =>
				new Response(
					JSON.stringify({
						results: [
							{
								title: "Node.js releases",
								url: "https://nodejs.org/releases",
								content: "Current and previous releases",
								publishedDate: "2026-05-01",
							},
						],
					}),
					{ status: 200 },
				),
		);
		vi.stubGlobal("fetch", fetchMock);
		const provider = new SearxngSearchProvider(new URL("https://search.test/"));

		const response = await provider.search(
			{
				query: "Node.js latest",
				maxResults: 5,
				allowedDomains: ["nodejs.org"],
				freshness: "month",
			},
			new AbortController().signal,
		);

		const requestedUrl = fetchMock.mock.calls[0]?.[0] as URL;
		expect(requestedUrl.origin).toBe("https://search.test");
		expect(requestedUrl.searchParams.get("q")).toContain("site:nodejs.org");
		expect(requestedUrl.searchParams.get("time_range")).toBe("month");
		expect(response.results).toEqual([
			{
				title: "Node.js releases",
				url: "https://nodejs.org/releases",
				snippet: "Current and previous releases",
				publishedAt: "2026-05-01",
			},
		]);
	});

	it("reports non-success provider responses", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response("failed", { status: 503 })),
		);
		const provider = new SearxngSearchProvider(new URL("https://search.test/"));

		await expect(
			provider.search(
				{
					query: "test",
					maxResults: 5,
					allowedDomains: [],
					freshness: "any",
				},
				new AbortController().signal,
			),
		).rejects.toThrow(/status 503/);
	});
});

describe("WebSearchDynamicToolBridge", () => {
	const params = {
		threadId: "thread-1",
		turnId: "turn-1",
		callId: "call-1",
		namespace: null,
		tool: "web_search",
		arguments: { query: "Node.js latest", max_results: 1 },
	};

	it("validates arguments and formats stable search references", async () => {
		const service: WebSearchService = {
			async search(request) {
				return {
					query: request.query,
					results: [
						{
							ref: "S1",
							title: "Node.js releases",
							url: "https://nodejs.org/releases",
							snippet: "Current releases",
							publishedAt: null,
							provider: "test",
							providerRank: 1,
						},
					],
				};
			},
		};
		const bridge = new WebSearchDynamicToolBridge(service);

		const result = await bridge.execute(params, new AbortController().signal);

		expect(result.success).toBe(true);
		expect(result.contentItems[0]?.text).toContain("[S1] Node.js releases");
		expect(result.contentItems[0]?.text).toContain(
			"URL: https://nodejs.org/releases",
		);
	});

	it("always returns a failed tool response for invalid calls", async () => {
		const service: WebSearchService = {
			async search() {
				throw new Error("should not run");
			},
		};
		const bridge = new WebSearchDynamicToolBridge(service);

		const invalid = await bridge.execute(
			{
				...params,
				arguments: { query: "", extra: true },
			},
			new AbortController().signal,
		);
		const unknown = await bridge.execute(
			{ ...params, tool: "web_open" },
			new AbortController().signal,
		);

		expect(invalid).toMatchObject({ success: false });
		expect(unknown).toMatchObject({ success: false });
	});

	it("turns timeouts into a failed tool response", async () => {
		const provider: SearchProvider = {
			id: "slow",
			search(_request, signal) {
				return new Promise((_resolve, reject) => {
					signal.addEventListener("abort", () => reject(signal.reason), {
						once: true,
					});
				});
			},
		};
		const service = new DefaultWebSearchService(provider, { timeoutMs: 5 });
		const bridge = new WebSearchDynamicToolBridge(service);

		const result = await bridge.execute(params, new AbortController().signal);

		expect(result.success).toBe(false);
		expect(result.contentItems[0]?.text).toMatch(/failed/i);
	});

	it("limits tool output size", async () => {
		const service: WebSearchService = {
			async search(request) {
				return {
					query: request.query,
					results: [
						{
							ref: "S1",
							title: "Large result",
							url: "https://example.com",
							snippet: "x".repeat(40_000),
							publishedAt: null,
							provider: "test",
							providerRank: 1,
						},
					],
				};
			},
		};
		const bridge = new WebSearchDynamicToolBridge(service);

		const result = await bridge.execute(params, new AbortController().signal);
		const text = result.contentItems[0]?.text ?? "";

		expect(Buffer.byteLength(text)).toBeLessThanOrEqual(32 * 1024);
		expect(text).toContain("[Output truncated]");
	});
});
