export type SearchFreshness = "day" | "week" | "month" | "year" | "any";

export type SearchRequest = {
	query: string;
	maxResults: number;
	allowedDomains: string[];
	freshness: SearchFreshness;
};

export type SearchContext = {
	threadId: string;
	turnId: string;
	callId: string;
	signal: AbortSignal;
};

export type SearchProviderResult = {
	url: string;
	title: string;
	snippet: string;
	publishedAt: string | null;
};

export type SearchProviderResponse = {
	results: SearchProviderResult[];
};

export interface SearchProvider {
	readonly id: string;
	search(
		request: SearchRequest,
		signal: AbortSignal,
	): Promise<SearchProviderResponse>;
}

export type SearchResult = SearchProviderResult & {
	ref: string;
	provider: string;
	providerRank: number;
};

export type SearchResponse = {
	query: string;
	results: SearchResult[];
};

export interface WebSearchService {
	search(
		request: SearchRequest,
		context: SearchContext,
	): Promise<SearchResponse>;
}
