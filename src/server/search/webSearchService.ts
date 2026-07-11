import type {
	SearchContext,
	SearchProvider,
	SearchRequest,
	SearchResponse,
	WebSearchService,
} from "./types.js";

export type DefaultWebSearchServiceOptions = {
	timeoutMs: number;
};

export class DefaultWebSearchService implements WebSearchService {
	constructor(
		private readonly provider: SearchProvider,
		private readonly options: DefaultWebSearchServiceOptions,
	) {}

	async search(
		request: SearchRequest,
		context: SearchContext,
	): Promise<SearchResponse> {
		const timeout = AbortSignal.timeout(this.options.timeoutMs);
		const signal = AbortSignal.any([context.signal, timeout]);
		const response = await this.provider.search(request, signal);
		return {
			query: request.query,
			results: response.results
				.slice(0, request.maxResults)
				.map((result, index) => ({
					...result,
					ref: `S${index + 1}`,
					provider: this.provider.id,
					providerRank: index + 1,
				})),
		};
	}
}
