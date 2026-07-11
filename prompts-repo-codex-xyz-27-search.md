## 结论

coz 不应该尝试让非 OpenAI custom model provider 直接兼容 Codex 的 hosted `web_search`. 推荐方案是:

```text
custom model
  -> 普通 function tool call
  -> Codex app-server
  -> item/tool/call
  -> coz WebSearchService
  -> SearXNG / Brave / Tavily / Exa
  -> coz PageFetcher + 正文提取 + 引用快照
  -> DynamicToolCallResponse
  -> Codex
  -> custom model 继续生成答案
```

最合适的接入点是 Codex app-server 已有的 `thread/start.dynamicTools` 和 `item/tool/call`, 而不是修改 custom provider, 伪装 OpenAI hosted search, 或把搜索能力首先实现成 MCP.

这条路径具备几个关键优势:

- 模型请求继续走任意 Responses-compatible custom provider.
- 搜索请求完全由 coz 执行, 不依赖 OpenAI Search 服务.
- 搜索后端可替换, SearXNG, Brave, Tavily 和 Exa 不会泄漏到 agent tool contract.
- 不需要 fork 或修改 Codex 上游 Rust 代码.
- app-server 已经负责 tool schema 注入, function call 路由, turn 阻塞和 function output 回传.
- coz 已开启 `experimentalApi`, 使用 dynamic tools 的协议条件已经满足, 见 `src/server/codex/appServerProtocol.ts:31`.

## Codex 当前如何实现 Web Search

当前 vendored Codex 中实际存在两条 web search 路径.

### 1. Hosted Responses `web_search`

Codex 根据配置构造一个 Responses API hosted tool:

```json
{
  "type": "web_search",
  "external_web_access": true
}
```

主要链路是:

```text
config.web_search
  -> resolve WebSearchMode
  -> create_web_search_tool()
  -> Responses API tools[]
  -> provider 在服务端执行搜索
  -> provider 返回 web_search_call SSE item
  -> Codex 映射为 WebSearchItem
  -> app-server 发出 webSearch thread item
```

具体实现证据:

- `disabled | cached | indexed | live` 定义在 `third_party/codex/codex-rs/protocol/src/config_types.rs:337`.
- mode 到 hosted tool 字段的转换位于 `third_party/codex/codex-rs/core/src/tools/hosted_spec.rs:14`.
- hosted tool 被加入模型请求位于 `third_party/codex/codex-rs/core/src/tools/spec_plan.rs:293`.
- wire tool 当前使用 `"type": "web_search"`, 不是 `web_search_preview`, 见 `third_party/codex/codex-rs/tools/src/tool_spec.rs:34`.
- Responses 返回的 `web_search_call` 被映射为 Codex item, 见 `third_party/codex/codex-rs/core/src/event_mapping.rs:198`.
- coz 已能展示 app-server 返回的 `webSearch` item, 见 `src/server/codex/appServerProtocol.ts:267`.

各 mode 的语义是:

| Mode | `external_web_access` | `indexed_web_access` | 含义 |
|---|---:|---:|---|
| `disabled` | 不发送 tool | 不发送 | 完全关闭 |
| `cached` | `false` | 未设置 | 只允许 provider 已有缓存或索引上下文 |
| `indexed` | `true` | `true` | 使用 provider 的 indexed access |
| `live` | `true` | 未设置 | 允许实时访问外部网页 |

关键点在于, Codex 本地没有执行这个 hosted tool. Codex 只是把 tool description 放进 Responses 请求. 搜索引擎调用, 页面读取和搜索上下文注入全部发生在模型 provider 服务端.

因此, 如果 custom provider 不实现 OpenAI hosted `web_search`, 可能出现:

- provider 拒绝未知 tool type.
- provider 接受请求但忽略该 tool.
- provider 返回不兼容的 tool call item.
- 模型知道需要搜索, 但没有任何执行方.
- provider 对 `web_search` 的私有实现与 Codex 预期不一致.

这个风险目前尤其明显, 因为普通 custom provider 默认继承 `ProviderCapabilities.web_search = true`, 见 `third_party/codex/codex-rs/model-provider/src/provider.rs:28`. 也就是说, Codex 当前对 OpenAI-compatible provider 使用了较乐观的能力默认值.

### 2. Standalone `web.run` extension

较新的 Codex 又实现了一个 client-executed 风格的 standalone search extension. 它向模型暴露 namespace tool:

```text
web.run
```

支持的命令已经很完整:

- `search_query`
- `image_query`
- `open`
- `click`
- `find`
- `screenshot`
- `finance`
- `weather`
- `sports`
- `time`

schema 位于 `third_party/codex/codex-rs/codex-api/src/search.rs:30`. Tool executor 位于 `third_party/codex/codex-rs/ext/web-search/src/tool.rs:41`.

它的执行链路是:

```text
model calls web.run
  -> Codex extension executor
  -> SearchClient
  -> POST {provider_base_url}/alpha/search
  -> plaintext function_call_output
  -> model continues
```

请求端点见 `third_party/codex/codex-rs/codex-api/src/endpoint/search.rs:31`.

这条路径把搜索从 hosted Responses tool 拆成了普通 function tool, 架构方向和 coz 的目标非常接近. 但是它目前仍然不满足需求:

- extension 仅对 OpenAI provider 或 OpenAI actor authorization provider 开放, 见 `third_party/codex/codex-rs/ext/web-search/src/extension.rs:39`.
- 实际调用的仍是 provider 的 `alpha/search`.
- provider 和鉴权仍来自 Codex model provider.
- `StandaloneWebSearch` 仍是 under-development feature, 默认关闭, 见 `third_party/codex/codex-rs/features/src/lib.rs:896`.

所以, 它是很好的交互和协议参考, 但不是一个真正与 OpenAI 服务解耦的搜索实现.

## 推荐的 coz 架构

建议把能力拆成 4 层:

```text
Codex Tool Bridge
        |
        v
WebSearchService
   |           |
   v           v
SearchProvider PageReader
   |           |
   v           v
SearXNG etc.   HTTP / HTML / PDF / Browser
        \       /
         v     v
      SearchSessionStore
              |
              v
        Search tool output
```

### 1. Codex Tool Bridge

职责:

- 在 `thread/start` 注入 dynamic tools.
- 显式禁用 Codex built-in hosted `web_search`.
- 处理 `item/tool/call`.
- 校验参数.
- 调用 `WebSearchService`.
- 总是在成功, 失败, 超时和取消时返回 JSON-RPC response.
- 将结果转换成 `DynamicToolCallResponse`.

coz 当前已经具备大部分协议基础:

- `thread/start` 入口在 `src/server/codex/appServerRuntime.ts:264`.
- `handleServerRequest()` 在 `src/server/codex/appServerRuntime.ts:1128`.
- app-server 初始化已经启用 `experimentalApi`, 见 `src/server/codex/appServerProtocol.ts:31`.
- generated dynamic tool 类型已经存在, 见 `src/generated/codex-app-server/v2/DynamicToolSpec.ts:7`.
- `item/tool/call` 参数类型在 `src/generated/codex-app-server/v2/DynamicToolCallParams.ts:6`.
- response 类型在 `src/generated/codex-app-server/v2/DynamicToolCallResponse.ts:6`.

当前 `handleServerRequest()` 只处理 `requestUserInput` 和 approval request. 未知的 `item/tool/call` 只会进入 raw event, 见 `src/server/codex/appServerRuntime.ts:1169`. 如果只注入 dynamic tool 而不实现这个 handler, model 一旦调用搜索, turn 会一直等待响应.

### 2. WebSearchService

建议定义 provider-neutral port, 不让 runtime 直接依赖 SearXNG 或 Brave:

```ts
interface WebSearchService {
  search(input: SearchRequest, context: SearchContext): Promise<SearchResponse>
  open(input: OpenRequest, context: SearchContext): Promise<PageDocument>
  find(input: FindRequest, context: SearchContext): Promise<FindResponse>
}
```

`SearchContext` 至少应包含:

```ts
interface SearchContext {
  threadId: string
  turnId: string
  callId: string
  signal: AbortSignal
}
```

这样可以实现:

- thread-scoped reference.
- turn 取消时取消 HTTP 请求.
- 每线程预算.
- 每 turn 并发限制.
- 调试和审计.
- 搜索结果与 transcript 关联.

### 3. SearchProvider

搜索发现和页面读取必须分开.

`SearchProvider` 只负责发现候选 URL:

```ts
interface SearchProvider {
  readonly id: string
  readonly capabilities: SearchProviderCapabilities

  search(
    request: SearchProviderRequest,
    signal: AbortSignal,
  ): Promise<SearchProviderResponse>
}
```

统一结果格式建议包含:

```ts
interface SearchResult {
  ref: string
  url: string
  canonicalUrl: string
  title: string
  snippet: string
  publishedAt: string | null
  provider: string
  providerRank: number
}
```

不要直接把 Tavily 或 Exa 生成的 answer 当成最终证据. Provider answer 可以用于发现, 但正式引用应来自 coz 自己读取到的页面快照.

### 4. PageReader

`PageReader` 负责证据获取:

```text
URL
  -> SSRF validation
  -> HTTP fetch
  -> redirect validation
  -> content-type routing
  -> HTML/PDF extraction
  -> normalized document
  -> content hash
  -> numbered blocks and links
```

推荐顺序:

1. 普通 HTTP fetch.
2. HTML 正文提取.
3. Markdown normalization.
4. PDF text extraction.
5. 只有普通 fetch 无法获取正文时, 才进入隔离的 Playwright 或 Crawl4AI worker.

不要一开始就把所有页面都交给浏览器. 浏览器成本, 延迟, 安全面和资源占用都明显更高.

## Dynamic Tool 设计

### 不建议直接复制 `web.run` namespace

Codex app-server 明确保留了 `web` namespace, dynamic tools 不能使用, 见 `third_party/codex/codex-rs/app-server/src/request_processors/thread_processor.rs:235`.

虽然可以创建 `coz_web.run`, 但 MVP 不建议依赖 namespace tools. 一些 custom Responses provider 只支持普通 function tool, 不支持 OpenAI namespace tool extension.

### 推荐使用 flat functions

建议向模型注入 3 个普通函数:

```text
web_search
web_open
web_find
```

第一阶段 schema 可以保持精简.

`web_search`:

```json
{
  "type": "object",
  "properties": {
    "query": {
      "type": "string",
      "description": "Search query"
    },
    "max_results": {
      "type": "integer",
      "minimum": 1,
      "maximum": 10
    },
    "allowed_domains": {
      "type": "array",
      "items": { "type": "string" }
    },
    "freshness": {
      "type": "string",
      "enum": ["day", "week", "month", "year", "any"]
    }
  },
  "required": ["query"],
  "additionalProperties": false
}
```

`web_open`:

```json
{
  "type": "object",
  "properties": {
    "ref_id": { "type": "string" },
    "url": { "type": "string" },
    "start_line": { "type": "integer", "minimum": 1 }
  },
  "additionalProperties": false
}
```

`web_find`:

```json
{
  "type": "object",
  "properties": {
    "ref_id": { "type": "string" },
    "pattern": { "type": "string" }
  },
  "required": ["ref_id", "pattern"],
  "additionalProperties": false
}
```

后续可再增加:

- `web_click`
- `web_image_search`
- `web_pdf_screenshot`
- `web_news_search`
- `web_finance`
- `web_weather`

不要在第一版直接复制全部 OpenAI `SearchCommands`. Search, open 和 find 已经足够覆盖大部分 coding agent 和研究场景.

## Thread Start 接入

在 `src/server/codex/appServerRuntime.ts:266` 的 `thread/start` 请求中增加:

```ts
{
  cwd: input.cwd,
  model: input.model ?? undefined,
  serviceName: "coz",
  threadSource: "user",
  dynamicTools: createWebSearchToolSpecs(),
  config: {
    web_search: "disabled",
  },
  ...yoloThreadOptions,
}
```

`web_search: "disabled"` 很重要. 它避免模型同时看到:

- provider-hosted `web_search`.
- coz dynamic `web_search`.

否则 custom provider 仍可能因为 hosted tool 不兼容而失败, 模型也可能面对两个语义相近的搜索入口.

是否注入 dynamic tools 应由 coz 的 search 配置决定:

- coz search 未配置时, 不注入, 保留 Codex 原生行为.
- coz search 已配置时, 注入 coz tools, 同时禁用 built-in search.
- 不需要按 provider 名称硬编码 `openai` 或 `custom`.
- 这样同一套能力也可以选择性替换 OpenAI native search.

Dynamic tools 会被写入 rollout session metadata. Codex 恢复线程时会从 conversation history 中恢复, 见 `third_party/codex/codex-rs/core/src/session/mod.rs:620`.

但存在一个重要限制: `dynamicTools` 只存在于 `thread/start`, `thread/resume` 没有这个字段, 见 `src/generated/codex-app-server/v2/ThreadStartParams.ts:57` 和 `src/generated/codex-app-server/v2/ThreadResumeParams.ts:29`.

因此:

- 新建线程可以启用.
- 创建时已经带 dynamic tools 的线程可以恢复.
- 历史上未带 tools 的旧线程无法在 resume 时热添加.
- MVP 应提示用户新建或 fork 一个启用 search 的线程.
- 如果必须对旧线程原地启用, 需要给 upstream app-server 增加动态更新 thread tools 的协议.

## `item/tool/call` 回调

app-server 发给 coz 的请求形状是:

```json
{
  "method": "item/tool/call",
  "id": 60,
  "params": {
    "threadId": "thr_123",
    "turnId": "turn_123",
    "callId": "call_123",
    "namespace": null,
    "tool": "web_search",
    "arguments": {
      "query": "latest Node.js release"
    }
  }
}
```

coz 执行后必须响应:

```json
{
  "id": 60,
  "result": {
    "contentItems": [
      {
        "type": "inputText",
        "text": "..."
      }
    ],
    "success": true
  }
}
```

失败也必须响应:

```json
{
  "id": 60,
  "result": {
    "contentItems": [
      {
        "type": "inputText",
        "text": "Web search failed: provider timeout"
      }
    ],
    "success": false
  }
}
```

不能让异常逃出后不发送 response. Codex core 会等待这个 response, 直到 dynamic tool call 被完成或 turn 被取消. 上游完整流转可见 `third_party/codex/codex-rs/core/src/tools/handlers/dynamic.rs:114`.

建议 timeout:

- 搜索 provider: 8 到 15 秒.
- 普通页面 fetch: 10 到 20 秒.
- browser renderer: 20 到 40 秒.
- 单 turn 总搜索预算: 60 到 120 秒.
- 单次输出: 建议限制在 32 KB 到 64 KB 文本.

## Search Output 和引用

搜索结果不应该只返回一段自然语言摘要. 建议返回稳定的引用格式:

```text
Search results for: node.js latest release

[S1] Node.js v24 release announcement
URL: https://nodejs.org/...
Published: 2026-05-01
Snippet: ...

[S2] Node.js releases
URL: https://nodejs.org/en/about/previous-releases
Snippet: ...
```

`web_open` 返回带行号正文:

```text
[P1] Node.js v24 release announcement
URL: https://nodejs.org/...
Fetched-At: 2026-07-11T10:00:00Z
Content-Hash: sha256:...

L1: Node.js 24 is now available.
L2: This release includes...
L3: ...
```

对于正式引用, 建议保存:

```ts
interface CitationSnapshot {
  documentId: string
  url: string
  title: string | null
  contentHash: string
  fetchedAt: string
  blockId: string
  quote: string
  startOffset: number
  endOffset: number
  evidenceKind: "page" | "search-snippet"
}
```

规则应明确:

- `search-snippet` 只用于发现, 证据等级较低.
- `page` 来自实际读取的页面快照, 可用于正式引用.
- 引用必须带 URL.
- quote 和 offset 必须对应相同 `contentHash`.
- 页面变化后, 不应将旧 offset 应用到新内容.
- Provider 生成的 answer 不进入 citation pipeline.

## SearchSessionStore

OpenAI standalone search 的 `open`, `click` 和 `find` 可以使用 `turnNsearchM` 等 ref ID. 这依赖服务端维护 session-scoped 浏览状态.

coz 如果要支持类似体验, 也需要 `SearchSessionStore`:

```ts
interface SearchSessionStore {
  putSearchResults(threadId: string, results: SearchResult[]): Promise<void>
  resolveSearchRef(threadId: string, ref: string): Promise<SearchResult | null>
  putDocument(threadId: string, document: PageDocument): Promise<void>
  resolveDocumentRef(threadId: string, ref: string): Promise<PageDocument | null>
  putLinks(threadId: string, documentId: string, links: PageLink[]): Promise<void>
}
```

建议 ref 格式保持简单:

```text
S1, S2, S3
P1, P2
L1, L2
```

存储策略:

- MVP 可以使用 in-memory bounded LRU.
- 生产版本建议写入 `.coz/coz.sqlite`.
- 记录设置 TTL 和总字节上限.
- 页面正文按 `contentHash` 去重.
- thread 删除或 archive 时可以异步清理引用映射.
- 即使 ref 状态丢失, `web_open` 仍应接受完整 URL.

## 后端选型

### 默认独立方案: 私有 SearXNG

推荐作为不依赖单一商业供应商的默认实现:

```text
Private SearXNG
  + coz PageReader
  + HTML Readability extraction
  + SQLite cache
```

优点:

- 不依赖 OpenAI.
- 自托管.
- JSON Search API.
- 可以聚合多个 engine.
- 支持 language, categories, time range 和 safe search 等参数.
- provider adapter 简单.

限制:

- SearXNG 是聚合层, 不是独立搜索索引.
- 上游 engine 的限流和反爬会影响稳定性.
- 公共 SearXNG 实例不适合作为生产依赖.
- JSON API 需要在实例侧正确启用.
- 需要运维一个私有实例.

参考: https://docs.searxng.org/dev/search_api.html

### 推荐 managed primary: Brave Search API

如果希望减少运维并提高通用搜索稳定性, Brave 更适合作为生产主后端:

- 独立索引.
- API 简单.
- 支持 freshness, country, language 和 safe search.
- 搜索与页面 reader 可以保持解耦.
- 不依赖 OpenAI.

参考: https://api-dashboard.search.brave.com/app/documentation/web-search

推荐生产组合:

```text
Brave primary
SearXNG fallback
coz PageReader
optional Exa research provider
```

### 最快 MVP: Tavily

Tavily 提供 Search 和 Extract, 能较快完成 agent-ready search:

- 开发速度快.
- 搜索和正文提取接口现成.
- 适合验证 dynamic tool 端到端流程.

但建议:

- 设置 `include_answer = false`.
- 结果必须归一化到 coz schema.
- 最终引用最好由 coz PageReader 重新抓取原 URL.
- 不要让 tool contract 直接暴露 Tavily 原始字段.

参考: https://docs.tavily.com/documentation/api-reference/endpoint/search

### Research mode: Exa

Exa 更适合:

- 语义检索.
- 研究论文.
- 技术主题的深度发现.
- research mode.

它不应替代通用导航型 search, 但可以作为第二 provider 或 research 专用 provider.

参考: https://exa.ai/docs/reference/search

### 不建议的新后端

- Bing Web Search API 已进入 retired 状态, 不应作为新架构依赖.
- Google Custom Search JSON API 不适合作为新默认, 新客户和产品生命周期存在明显限制.
- 公共 SearXNG instance 不适合生产.
- Firecrawl 功能完整, 但自托管和修改部署前需要评估 AGPL-3.0.
- Browser-based search scraping 不应作为默认 provider, 易受页面变化和反自动化策略影响.

## 排序和缓存

### 排序

单 provider 模式应优先保留 provider rank, 不要把不同 provider 的原始 score 直接比较.

多 provider 聚合建议使用 weighted Reciprocal Rank Fusion:

```text
rrfScore(url) = sum(providerWeight / (60 + providerRank))
```

然后增加轻量调整:

```text
finalScore =
  rrfScore
  + freshnessBoost
  + exactQueryMatchBoost
  + officialSourceBoost
  - duplicatePenalty
  - domainSaturationPenalty
```

建议:

- canonical URL 去除 fragment 和明确的 tracking 参数.
- 不要删除所有 query 参数, issue ID, 文档版本和语言参数可能有语义.
- 前 10 条结果默认每个 domain 最多 2 条.
- 技术查询轻量提升官方文档, 官方仓库, release notes 和 issue.
- 只有查询含 latest, today, news 或明确日期时才显著提升 freshness.
- 多 provider 第一版稳定后再做, 不要阻塞单 provider MVP.

### 缓存

Search cache 和 page cache 必须分开.

建议 TTL:

| 数据 | TTL |
|---|---:|
| 实时或新闻 query | 5 到 15 分钟 |
| 普通 web query | 1 到 6 小时 |
| 稳定技术文档 query | 6 到 24 小时 |
| provider error | 30 秒到 5 分钟 |
| 页面正文 | 1 到 24 小时 |

还应支持:

- 相同 query 的 singleflight.
- ETag 和 Last-Modified.
- bounded LRU 或按总字节清理.
- stale-while-revalidate.
- 正文按 content hash 去重.
- `cached` mode 只读缓存, miss 时明确返回.
- provider retention policy.
- 不缓存带 authorization, cookie, signed URL 或私有 token 的页面.

## 安全边界

`web_open(url)` 是整个系统风险最高的部分. 至少应实现以下保护:

- 只允许 `http:` 和 `https:`.
- 禁止 `file:`, `data:`, `ftp:`, `javascript:` 和自定义 scheme.
- DNS 解析后拒绝 loopback, private, link-local, multicast 和 metadata IP.
- 每次 redirect 后重新验证 scheme, hostname 和解析 IP.
- 防止 DNS rebinding.
- 默认只允许端口 80 和 443.
- 限制 redirects.
- 限制 connect timeout 和 total timeout.
- 限制 compressed 和 decompressed response bytes.
- 不转发 coz cookie, Authorization, provider key 或用户浏览器 header.
- Browser renderer 使用独立进程或容器.
- Browser renderer 不挂载 workspace, 不访问内网或 cloud metadata.
- 页面文本必须视为 untrusted data.
- 页面中的 prompt, system message 和 tool instruction 不具有控制权.
- 对搜索 query 日志做 secret 检测和脱敏.
- 对 thread 和 provider 设置并发, 请求数和费用预算.
- 内网页面访问应使用另一个明确授权的能力, 不应通过 web search 放开 SSRF.

## UI 和 Transcript

通过 dynamic tools 执行后, app-server 会生成 `dynamicToolCall`, 而不是原生 `webSearch`.

coz 当前已经将它映射为 system item, 见 `src/server/codex/appServerProtocol.ts:259`.

第一版可以直接显示:

```text
web_search completed
web_open completed
```

更好的 UI 是在 projection 层识别 tool name:

```text
dynamicToolCall.tool === "web_search"
dynamicToolCall.tool === "web_open"
dynamicToolCall.tool === "web_find"
```

然后展示成搜索专用卡片:

- query.
- provider.
- result count.
- URL.
- elapsed time.
- cache hit.
- open/find 状态.
- 错误和超时.

这只是 coz 的 presentation projection, 不需要伪造 upstream `WebSearchItem`.

## 为什么不首选 MCP

MCP 可以实现 web search, 但更适合 "用户自带通用 search server", 不适合作为 coz 默认内建能力.

与 dynamic tools 相比, MCP 会增加:

- 单独进程或 HTTP server 生命周期.
- MCP config 管理.
- 全局或 workspace-level 配置污染.
- tool name 和 server name 管理.
- 额外健康检查.
- 更复杂的错误和重连语义.
- 不容易按 coz thread 精确注入.

Dynamic tools 则天然是:

- 由 coz 按 thread 注入.
- 由 coz app-server connection 执行.
- 与现有 runtime 生命周期一致.
- 不需要修改用户 Codex MCP 配置.
- 可直接使用 threadId, turnId 和 callId.

建议保留 MCP 作为高级入口:

- 用户可以配置自己的 search MCP.
- coz 内建 search 使用 dynamic tools.
- 后续可以让 `WebSearchService` 同时暴露为 dynamic tool executor 和 MCP server, 但共用同一业务实现.

## 建议实施阶段

### Phase 1: 可用 MVP

目标是验证 custom provider 自主搜索闭环:

1. 定义 `WebSearchService` 和 `SearchProvider`.
2. 实现 flat `web_search`.
3. 在 `thread/start.dynamicTools` 注入 tool.
4. 同时设置 `config.web_search = "disabled"`.
5. 在 `handleServerRequest()` 处理 `item/tool/call`.
6. 接入私有 SearXNG 或 Tavily.
7. 返回 title, URL 和 snippet.
8. 增加 timeout, 参数校验和输出大小限制.
9. 测试 custom provider 能完成 tool call 和 follow-up answer.

### Phase 2: 可验证引用

1. 增加 `web_open`.
2. 实现 SSRF-safe PageReader.
3. 增加 HTML 正文提取和行号.
4. 增加 `web_find`.
5. 增加 thread-scoped refs.
6. 保存 URL, content hash, fetchedAt 和 quote.
7. UI 增加搜索专用卡片.
8. 增加 search cache 和 page cache.

### Phase 3: 生产化

1. Brave primary + SearXNG fallback.
2. Provider capability negotiation.
3. 限流, 熔断和预算.
4. SQLite SearchSessionStore.
5. 多 provider 去重和 RRF.
6. PDF extraction.
7. Browser renderer worker.
8. Exa research mode.
9. provider metrics 和故障诊断.
10. 旧线程启用 search 的迁移或 upstream 协议扩展.

## 测试重点

至少覆盖:

- `thread/start` 包含 dynamic tool.
- `thread/start.config.web_search` 为 `disabled`.
- `item/tool/call` 成功响应.
- provider 4xx, 5xx 和 timeout.
- 非法 arguments.
- 未知 dynamic tool.
- turn 被中断时 AbortSignal 生效.
- app-server 断线时 pending calls 被清理.
- 输出被截断但 JSON-RPC response 仍有效.
- custom provider 收到普通 function tool, 不再收到 hosted `web_search`.
- `web_open` 拒绝 localhost, RFC1918, link-local 和 metadata endpoint.
- redirect 到内网被拒绝.
- search refs 不能跨 thread 访问.
- 历史上已经带 tools 的线程 resume 后仍可调用.
- 未带 tools 的旧线程行为明确.
- UI 正确显示 dynamic search lifecycle.

## 最终建议

目标架构应定为:

```text
Codex 负责 agent loop 和 function calling
coz 负责 web search tool execution
SearchProvider 负责发现 URL
PageReader 负责读取和提取证据
SearchSessionStore 负责 refs, snapshots 和 cache
custom model 只需要普通 function calling
```

不要把搜索绑定到 custom model provider. 不要要求 custom provider 实现 OpenAI hosted `web_search`. 不要把 Tavily, Brave 或 SearXNG 的私有字段暴露给模型.

第一版建议选择:

```text
flat web_search
+ thread/start.dynamicTools
+ item/tool/call handler
+ built-in web_search disabled
+ private SearXNG or Tavily adapter
```

随后尽快增加 `web_open` 和 `web_find`. 只有 search snippet 而没有页面读取与引用快照, 可以回答问题, 但还不算一个可靠的 Codex web search 实现.

本次只做了只读分析, 没有修改仓库文件. 官方 Codex manual helper 在当前环境返回 HTTP 403. 我已经按 `openai-docs` skill 的回退流程安装了 `openaiDeveloperDocs` MCP, 但需要重启 Codex 后当前会话才能使用. 上述 Codex 实现结论以仓库内当前 vendored source, commit `8960d28`, 为准.
