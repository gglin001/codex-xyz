import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createLocalWebSearch } from "../src/server/codex/localWebSearch.js";

let server: Server | null = null;

function listen(server: Server) {
	return new Promise<string>((resolve) => {
		server.listen(0, "127.0.0.1", () => {
			const address = server.address() as AddressInfo;
			resolve(`http://127.0.0.1:${address.port}`);
		});
	});
}

afterEach(async () => {
	const current = server;
	server = null;
	if (!current) {
		return;
	}
	await new Promise<void>((resolve, reject) => {
		current.close((error) => {
			if (error) {
				reject(error);
			} else {
				resolve();
			}
		});
	});
});

describe("local web search", () => {
	it("exposes and executes a SearxNG-backed dynamic search tool", async () => {
		const seenUrls: string[] = [];
		server = createServer((request, response) => {
			seenUrls.push(request.url ?? "");
			response.setHeader("content-type", "application/json");
			response.end(
				JSON.stringify({
					results: [
						{
							title: "Codex local search",
							url: "https://example.test/codex",
							content: "Result from local SearxNG.",
							engines: ["test"],
						},
					],
				}),
			);
		});
		const endpoint = await listen(server);
		const search = createLocalWebSearch({
			provider: "searxng",
			endpoint,
			maxResults: 5,
			timeoutMs: 1000,
		});

		expect(search.dynamicTools()).toEqual([
			expect.objectContaining({
				type: "namespace",
				name: "coz_web",
				tools: [
					expect.objectContaining({
						type: "function",
						name: "search",
					}),
				],
			}),
		]);

		const response = await search.handleToolCall({
			namespace: "coz_web",
			tool: "search",
			arguments: {
				query: "codex",
				limit: 1,
			},
		});

		expect(seenUrls[0]).toContain("/search?");
		expect(seenUrls[0]).toContain("q=codex");
		expect(seenUrls[0]).toContain("format=json");
		expect(response).toMatchObject({
			success: true,
			contentItems: [
				{
					type: "inputText",
					text: expect.stringContaining("Codex local search"),
				},
			],
		});
	});
});
