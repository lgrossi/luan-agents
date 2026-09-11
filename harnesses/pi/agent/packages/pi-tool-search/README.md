# pi-tool-search

`@luan-pi/pi-tool-search` adds `tool_search`, a normal Pi tool that finds and
activates tools which are currently inactive. It searches only the scope
assigned to it. It does not inspect or modify the global tool hierarchy.

## Install

```sh
pi install npm:@luan-pi/pi-tool-search
```

Requires a Rust toolchain (https://rustup.rs). The `code-mode-host` binary
builds itself on first use under Pi's agent directory
(`native/code-mode-host/<version>/`). Set `PI_CODE_MODE_HOST_BINARY` to use a
prebuilt binary.

Optional companion: `pi install npm:@luan-pi/pi-xsettings` adds the
`/xsettings` editor for the deferred-tool picker described below; without it
the default (no deferred tools) applies.

The package registers no keybindings and no commands. It uses Pi's dynamic
tool APIs (`getAllTools`, `getActiveTools`, `setActiveTools`).

## Direct use and use under `exec`

Code Mode owns placement. `pi-tool-search` never decides whether `tool_search`
is direct or under `exec`.

- When `tool_search` is direct, its assigned scope is the other tools that
  were active in Pi at session start. Loading a match calls
  `pi.setActiveTools()` in that direct scope.
- When Code Mode puts `tool_search` under `exec`, its assigned scope is the
  sibling tools that Code Mode put under `exec`. Loading a match keeps the
  newly active tool under `exec`; it does not move the tool to Pi's direct
  list.

The Code Mode bridge is an execution adapter only. It gives Tool Search the
current sibling scope when Code Mode asks for it. Code Mode still owns the
direct-versus-`exec` decision and its settings. This is the only information
Tool Search receives about Code Mode.

## Deferred scope

All tools remain registered with Pi, but checked tools start inactive. At
session start, the package builds the deferred-tool picker from its assigned
scope. It does not use every tool returned by `pi.getAllTools()` as a global
search index.

The assigned scope is the boundary for both the picker and the search:

- A direct scope contains only the active direct tools that Tool Search was
  assigned.
- A nested scope contains only the other tools currently under `exec`.
- Registered tools outside that scope are invisible to `tool_search`.
- Disabled tools, tools omitted by a strict `--tools` selection, and tools
  outside the current scope are not deferred and do not appear in the picker.

Checked names are removed from that scope before the first model request.
`tool_search` itself stays active so the model can load a capability later.
When a query matches, activation is additive: existing active tools stay
active and only the matching tools are added. A no-match query changes
nothing. Loaded tools stay active for the rest of the session unless another
owner changes the scope.

## Settings

Settings live in the `pi-tool-search` namespace (label "Tool Search",
category `tools`). Edit them with `/xsettings` when `@luan-pi/pi-xsettings` is
installed; otherwise the defaults apply.

| Key | Type | Default | Meaning |
| --- | --- | --- | --- |
| `tools` | unordered multi-select | `[]` | Checked tools are hidden until `tool_search` loads them. |

The selection is stored in `~/.pi/agent/xsettings.toml`:

```toml
[tools]
pi-tool-search.tools = ["exec_command", "web__run"]
```

The options are rebuilt from the assigned scope at session start and include
each tool's name and description. Reopen the session after changing the
selection so the initial deferred set is applied. The setting does not create
or enable a tool that Pi did not already make available.

## Use the tool

The input is an object with a required query and an optional result limit
(integer, 1 to 8):

```json
{"query":"search the web","limit":3}
```

Search covers tool names, descriptions, parameter names, and parameter
descriptions, ranked with BM25 over stemmed tokens with prefix matching for
terms of three or more characters. It returns at most eight ranked matches.
A successful result reports `Loaded tools: ...`; a no-match result reports
that no inactive tool matched. Tool Search activates matches on the next model
request, using Pi's normal dynamic-tool loading behavior.

If `tool_search` is under `exec`, call it as a nested method:

```js
const result = await tools.tool_search({ query: "search the web" });
text(result);
```

`tool_search` is not a parallel-call helper. There is no
`multi_tool_use.parallel` tool unless another package has separately
registered one. Use normal JavaScript such as `Promise.all` when calling
independent nested tools from `exec`.

## API contract

The package's Pi entry point is `src/extension.ts`. The module entry
(`src/index.ts`) exports `createToolSearchResult` for consumers that need to
build the same model-visible result shape, plus the stable result types
`ToolSearchDetails` and `ToolSearchRankedMatch`.

The result details are JSON-serializable and versioned:

```ts
type ToolSearchDetails = {
  version: 2;
  tool: "tool_search";
  status: "loaded" | "no_match";
  input: { query: string; normalizedQuery: string; limit: number };
  rankedMatches: Array<{ name: string; description: string; score: number }>;
  activation: { before: string[]; added: string[]; after: string[] };
  counts: { registered: number; searchable: number; matches: number; added: number };
  timing: { durationMs: number };
};
```

A scope passed to the tool has these operations:

```ts
type ToolSearchScope = {
  tools(): readonly { name: string; description: string; parameters?: unknown }[];
  active(): readonly string[];
  setActive(names: readonly string[]): void;
};
```

The scope owner remains responsible for deciding which names are available.
Tool Search only ranks inactive entries and asks that owner to add matches.

## Troubleshooting

- **A tool is not in the picker:** it was inactive before Tool Search built its
  scope, disabled by Pi's tool selection, outside the current `exec` sibling
  set, or has not been registered yet. Tool Search does not make it deferred.
- **A checked tool still appears direct:** confirm `tool_search` is direct or
  under `exec` as intended, then restart the session. Placement belongs to
  Code Mode; Tool Search cannot change it.
- **A nested search cannot find a direct tool:** that is expected. A nested
  Tool Search can see only its sibling tools under `exec`.
- **A direct search cannot load a tool under `exec`:** that is also expected.
  Use a `tool_search` instance assigned to that nested scope.
- **A query returns no matches:** search is limited to inactive tools in the
  assigned scope. Check the exact name and description exposed by the picker.

## Layout

| Responsibility | File |
| --- | --- |
| Extension entry, scope selection, deferred activation | `src/extension.ts` |
| Tool definition and execution | `src/tools/tool-search/definition.ts` |
| Result shape (`createToolSearchResult`) | `src/tools/tool-search/result.ts` |
| Transcript rendering | `src/tools/tool-search/presentation.ts` |
| Search and ranking | `src/search.ts` |
| Code Mode execution bridge | `src/code-mode-adapter.ts` |
| Settings definitions | `src/contributions/xsettings.ts` |
| Module exports | `src/index.ts` |

## Develop

Source: https://github.com/luan/agents, directory
harnesses/pi/agent/packages/pi-tool-search. Run `bun run typecheck` and
`bun test test` in that directory.
