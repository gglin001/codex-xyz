import type {
	SearchFreshness,
	SearchRequest,
	SearchResult,
	WebSearchService,
} from "./types.js";

export type DynamicToolCallParams = {
	threadId: string;
	turnId: string;
	callId: string;
	namespace: string | null;
	tool: string;
	arguments: unknown;
};

export type DynamicToolCallResponse = {
	contentItems: Array<{ type: "inputText"; text: string }>;
	success: boolean;
};

export type DynamicToolSpec = {
	type: "function";
	name: string;
	description: string;
	inputSchema: Record<string, unknown>;
};

const defaultMaxResults = 5;
const maxOutputBytes = 32 * 1024;
const freshnessValues = new Set<SearchFreshness>([
	"day",
	"week",
	"month",
	"year",
	"any",
]);

export const webSearchToolSpecs: DynamicToolSpec[] = [
	{
		type: "function",
		name: "web_search",
		description:
			"Search the public web and return titles, URLs, and result snippets.",
		inputSchema: {
			type: "object",
			properties: {
				query: { type: "string", description: "Search query" },
				max_results: { type: "integer", minimum: 1, maximum: 10 },
				allowed_domains: { type: "array", items: { type: "string" } },
				freshness: {
					type: "string",
					enum: ["day", "week", "month", "year", "any"],
				},
			},
			required: ["query"],
			additionalProperties: false,
		},
	},
];

function inputText(text: string): DynamicToolCallResponse {
	return { contentItems: [{ type: "inputText", text }], success: true };
}

function failure(error: unknown): DynamicToolCallResponse {
	const message = error instanceof Error ? error.message : String(error);
	return {
		contentItems: [
			{ type: "inputText", text: `Web search failed: ${message}` },
		],
		success: false,
	};
}

function parseRequest(argumentsValue: unknown): SearchRequest {
	if (
		!argumentsValue ||
		typeof argumentsValue !== "object" ||
		Array.isArray(argumentsValue)
	) {
		throw new Error("arguments must be an object");
	}
	const values = argumentsValue as Record<string, unknown>;
	const allowedKeys = new Set([
		"query",
		"max_results",
		"allowed_domains",
		"freshness",
	]);
	const unknownKey = Object.keys(values).find((key) => !allowedKeys.has(key));
	if (unknownKey) {
		throw new Error(`unknown argument: ${unknownKey}`);
	}
	const query = typeof values.query === "string" ? values.query.trim() : "";
	if (!query) {
		throw new Error("query must be a non-empty string");
	}
	const maxResults = values.max_results ?? defaultMaxResults;
	if (
		!Number.isInteger(maxResults) ||
		Number(maxResults) < 1 ||
		Number(maxResults) > 10
	) {
		throw new Error("max_results must be an integer between 1 and 10");
	}
	const allowedDomains = values.allowed_domains ?? [];
	if (
		!Array.isArray(allowedDomains) ||
		allowedDomains.some(
			(domain) => typeof domain !== "string" || !domain.trim(),
		)
	) {
		throw new Error("allowed_domains must contain non-empty strings");
	}
	const freshness = values.freshness ?? "any";
	if (
		typeof freshness !== "string" ||
		!freshnessValues.has(freshness as SearchFreshness)
	) {
		throw new Error("freshness must be day, week, month, year, or any");
	}
	return {
		query,
		maxResults: Number(maxResults),
		allowedDomains: allowedDomains.map((domain) => domain.trim()),
		freshness: freshness as SearchFreshness,
	};
}

function truncateUtf8(text: string, maxBytes: number) {
	const encoded = Buffer.from(text);
	if (encoded.byteLength <= maxBytes) {
		return text;
	}
	return `${encoded.subarray(0, maxBytes - 32).toString("utf8")}\n\n[Output truncated]`;
}

function formatResponse(query: string, results: SearchResult[]) {
	const entries = results.map((result) => {
		const lines = [`[${result.ref}] ${result.title}`, `URL: ${result.url}`];
		if (result.publishedAt) {
			lines.push(`Published: ${result.publishedAt}`);
		}
		if (result.snippet) {
			lines.push(`Snippet: ${result.snippet}`);
		}
		return lines.join("\n");
	});
	return truncateUtf8(
		[`Search results for: ${query}`, ...entries].join("\n\n"),
		maxOutputBytes,
	);
}

export class WebSearchDynamicToolBridge {
	constructor(private readonly service: WebSearchService) {}

	async execute(
		params: DynamicToolCallParams,
		signal: AbortSignal,
	): Promise<DynamicToolCallResponse> {
		if (params.namespace !== null || params.tool !== "web_search") {
			return failure(`unknown dynamic tool: ${params.tool}`);
		}
		try {
			const request = parseRequest(params.arguments);
			const response = await this.service.search(request, {
				threadId: params.threadId,
				turnId: params.turnId,
				callId: params.callId,
				signal,
			});
			return inputText(formatResponse(response.query, response.results));
		} catch (error) {
			return failure(error);
		}
	}
}
