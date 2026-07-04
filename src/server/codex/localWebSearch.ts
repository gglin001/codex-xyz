export type JsonValue =
	| number
	| string
	| boolean
	| JsonValue[]
	| { [key: string]: JsonValue }
	| null;

export type DynamicToolSpec =
	| ({
			type: "function";
	  } & DynamicToolFunctionSpec)
	| ({
			type: "namespace";
	  } & DynamicToolNamespaceSpec);

export type DynamicToolFunctionSpec = {
	name: string;
	description: string;
	inputSchema: JsonValue;
	deferLoading?: boolean;
};

export type DynamicToolNamespaceSpec = {
	name: string;
	description: string;
	tools: Array<{ type: "function" } & DynamicToolFunctionSpec>;
};

export type DynamicToolCallResponse = {
	contentItems: Array<{ type: "inputText"; text: string }>;
	success: boolean;
};

export type LocalWebSearchOptions = {
	provider: "searxng";
	endpoint: string;
	maxResults: number;
	timeoutMs: number;
};

export type LocalWebSearchResult = {
	title: string;
	url: string;
	snippet: string | null;
	source: string | null;
	publishedDate: string | null;
};

export type LocalWebSearchInput = {
	query: string;
	limit: number;
};

export interface LocalWebSearchBackend {
	readonly providerName: string;
	search(input: LocalWebSearchInput): Promise<LocalWebSearchResult[]>;
}

export interface LocalWebSearch {
	dynamicTools(): DynamicToolSpec[];
	handleToolCall(
		params: Record<string, unknown>,
	): Promise<DynamicToolCallResponse | null>;
}

export const localWebSearchNamespace = "coz_web";
export const localWebSearchSearchTool = "search";

const searchToolInputSchema = {
	type: "object",
	properties: {
		query: {
			type: "string",
			description: "Search query.",
		},
		limit: {
			type: "integer",
			minimum: 1,
			maximum: 20,
			description: "Maximum number of results to return.",
		},
	},
	required: ["query"],
	additionalProperties: false,
};

function localWebSearchToolSpec(): DynamicToolSpec {
	return {
		type: "namespace",
		name: localWebSearchNamespace,
		description: "Local web search tools provided by coz.",
		tools: [
			{
				type: "function",
				name: localWebSearchSearchTool,
				description:
					"Search the public web using the locally configured coz search provider. Use this when current external information is needed.",
				inputSchema: searchToolInputSchema as JsonValue,
			},
		],
	};
}

function asRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === "object"
		? (value as Record<string, unknown>)
		: {};
}

function stringValue(value: unknown) {
	return typeof value === "string" && value.trim() ? value.trim() : null;
}

function clampInteger(
	value: unknown,
	fallback: number,
	minimum: number,
	maximum: number,
) {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return fallback;
	}
	return Math.min(maximum, Math.max(minimum, Math.floor(value)));
}

function normalizeSearchInput(
	argumentsValue: unknown,
	defaultLimit: number,
	maxLimit: number,
): LocalWebSearchInput | string {
	const args = asRecord(argumentsValue);
	const query = stringValue(args.query);
	if (!query) {
		return "coz_web.search requires a non-empty query string";
	}
	return {
		query,
		limit: clampInteger(args.limit, defaultLimit, 1, maxLimit),
	};
}

function textResponse(text: string, success: boolean): DynamicToolCallResponse {
	return {
		contentItems: [{ type: "inputText", text }],
		success,
	};
}

function errorMessage(error: unknown) {
	return error instanceof Error ? error.message : String(error);
}

class LocalWebSearchTool implements LocalWebSearch {
	constructor(
		private readonly backend: LocalWebSearchBackend,
		private readonly maxResults: number,
	) {}

	dynamicTools(): DynamicToolSpec[] {
		return [localWebSearchToolSpec()];
	}

	async handleToolCall(
		params: Record<string, unknown>,
	): Promise<DynamicToolCallResponse | null> {
		if (
			params.namespace !== localWebSearchNamespace ||
			params.tool !== localWebSearchSearchTool
		) {
			return null;
		}

		const input = normalizeSearchInput(params.arguments, 5, this.maxResults);
		if (typeof input === "string") {
			return textResponse(input, false);
		}

		try {
			const results = await this.backend.search(input);
			return textResponse(
				JSON.stringify(
					{
						provider: this.backend.providerName,
						query: input.query,
						resultCount: results.length,
						results,
					},
					null,
					2,
				),
				true,
			);
		} catch (error) {
			return textResponse(
				`local web search failed: ${errorMessage(error)}`,
				false,
			);
		}
	}
}

class SearxngSearchBackend implements LocalWebSearchBackend {
	readonly providerName = "searxng";

	constructor(
		private readonly endpoint: string,
		private readonly maxResults: number,
		private readonly timeoutMs: number,
	) {}

	async search(input: LocalWebSearchInput): Promise<LocalWebSearchResult[]> {
		const url = searxngSearchUrl(this.endpoint, input.query);
		const timeout = AbortSignal.timeout(this.timeoutMs);
		const response = await fetch(url, {
			headers: {
				Accept: "application/json",
			},
			signal: timeout,
		});
		if (!response.ok) {
			throw new Error(`SearxNG returned HTTP ${response.status}`);
		}
		const payload = (await response.json()) as unknown;
		const results = Array.isArray(asRecord(payload).results)
			? (asRecord(payload).results as unknown[])
			: [];
		return results
			.map(normalizeSearxngResult)
			.filter((result): result is LocalWebSearchResult => result !== null)
			.slice(0, Math.min(input.limit, this.maxResults));
	}
}

function searxngSearchUrl(endpoint: string, query: string) {
	const url = new URL(endpoint);
	const trimmedPath = url.pathname.replace(/\/$/, "");
	if (!trimmedPath.endsWith("/search")) {
		url.pathname = `${trimmedPath}/search`;
	}
	url.searchParams.set("q", query);
	url.searchParams.set("format", "json");
	return url;
}

function normalizeSearxngResult(value: unknown): LocalWebSearchResult | null {
	const result = asRecord(value);
	const url = stringValue(result.url);
	if (!url) {
		return null;
	}
	const title = stringValue(result.title) ?? url;
	const engines = Array.isArray(result.engines)
		? result.engines.filter(
				(engine): engine is string => typeof engine === "string",
			)
		: [];
	return {
		title,
		url,
		snippet: stringValue(result.content) ?? stringValue(result.snippet),
		source:
			engines.length > 0 ? engines.join(", ") : stringValue(result.engine),
		publishedDate:
			stringValue(result.publishedDate) ?? stringValue(result.published_date),
	};
}

export function createLocalWebSearch(
	options: LocalWebSearchOptions,
): LocalWebSearch {
	return new LocalWebSearchTool(
		new SearxngSearchBackend(
			options.endpoint,
			options.maxResults,
			options.timeoutMs,
		),
		options.maxResults,
	);
}
