# codex-xyz / coz

## Web Search

coz can expose a provider-neutral `web_search` dynamic tool to newly created
Codex threads. Configure a private SearXNG instance before starting the server:

```sh
COZ_WEB_SEARCH_PROVIDER=searxng \
COZ_SEARXNG_URL=https://search.example.com/ \
pnpm run dev
```

`COZ_WEB_SEARCH_TIMEOUT_MS` optionally sets the provider timeout from 1000 to
60000 milliseconds and defaults to 12000. When search is configured, coz
injects the flat dynamic tool at `thread/start` and disables Codex hosted
`web_search` for that thread. Existing threads created without the tool cannot
gain it through `thread/resume`; create a new thread instead.
