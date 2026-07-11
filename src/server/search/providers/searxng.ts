import type {
	SearchProvider,
	SearchProviderResponse,
	SearchRequest,
} from "../types.js";

type SearxngResult = {
	url?: unknown;
	title?: unknown;
	content?: unknown;
	publishedDate?: unknown;
	published_date?: unknown;
};

function asText(value: unknown) {
	return typeof value === "string" ? value.trim() : "";
}

function searchQuery(request: SearchRequest) {
	if (request.allowedDomains.length === 0) {
		return request.query;
	}
	const domains = request.allowedDomains
		.map((domain) => `site:${domain}`)
		.join(" OR ");
	return `${request.query} (${domains})`;
}

export class SearxngSearchProvider implements SearchProvider {
	readonly id = "searxng";

	constructor(private readonly baseUrl: URL) {}

	async search(
		request: SearchRequest,
		signal: AbortSignal,
	): Promise<SearchProviderResponse> {
		const url = new URL("search", this.baseUrl);
		url.searchParams.set("q", searchQuery(request));
		url.searchParams.set("format", "json");
		url.searchParams.set("categories", "general");
		if (request.freshness !== "any") {
			url.searchParams.set("time_range", request.freshness);
		}

		const response = await fetch(url, {
			headers: { accept: "application/json" },
			signal,
		});
		if (!response.ok) {
			throw new Error(`SearXNG request failed with status ${response.status}`);
		}
		const body = (await response.json()) as { results?: unknown };
		const results = Array.isArray(body.results) ? body.results : [];
		return {
			results: results.flatMap((value) => {
				const result = value as SearxngResult;
				const resultUrl = asText(result.url);
				if (!resultUrl) {
					return [];
				}
				return [
					{
						url: resultUrl,
						title: asText(result.title) || resultUrl,
						snippet: asText(result.content),
						publishedAt:
							asText(result.publishedDate) ||
							asText(result.published_date) ||
							null,
					},
				];
			}),
		};
	}
}
