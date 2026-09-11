# @luan-pi/pi-developer-prompt

`pi-developer-prompt` is a Pi extension that builds the provider-ready prompt
envelope for each turn. It keeps three kinds of instructions in their intended
roles: provider (system) instructions, developer messages, and project context
files such as `AGENTS.md`. It does not register tools, keybindings, or
commands, and it does not decide how a provider serializes its request.

## Preview

![pi-developer-prompt in Bootty](https://github.com/luan/agents/releases/download/v0.2.2/pi-developer-prompt.png)

[Watch the demo](https://github.com/luan/agents/releases/download/v0.2.2/pi-developer-prompt.mp4).

## Install

```sh
pi install npm:@luan-pi/pi-developer-prompt
```

The extension loads on its own, but it can only change what a provider
actually receives when a provider package registers a payload adapter (see
"Provider adapters"). `@luan-pi/pi-codex-native` registers the adapter for the
`openai-codex` provider (`pi install npm:@luan-pi/pi-codex-native`); without an
adapter, Pi's request goes out unchanged and only the `before_agent_start`
system-prompt override applies.

`@luan-pi/pi-xsettings` (`pi install npm:@luan-pi/pi-xsettings`) adds a
`/xsettings` UI for the audit setting below; without it the compiled default is
used and no settings file is created.

Other extensions can add developer messages when they are installed alongside
this package. For example `@luan-pi/pi-annotations` contributes annotation
guidance, and `@luan-pi/pi-subagents` and `@luan-pi/pi-skills` contribute
their own messages. Absent, those messages are simply not present.

## What Pi sends

On every `before_agent_start`, the extension composes three separate parts:

1. **Provider instructions.** If Pi supplied a custom prompt (a `SYSTEM.md`
   override), that prompt is used, followed by Pi's append-system text. If no
   custom prompt exists, Pi's already-built system prompt is kept as is.
2. **Developer messages.** Registered extension contributions, filtered and
   ordered, followed by one final `environment` message:

   ```xml
   <environment_context>
     <cwd>/path/to/project</cwd>
     <shell>zsh</shell>
     <current_date>2025-01-31</current_date>
     <timezone>Europe/Lisbon</timezone>
   </environment_context>
   ```

   When the `exec_command` tool is active and the login shell is `fish`, the
   shell is reported as the first of `zsh`/`bash`/`sh` found on the system
   (`bash.exe` on Windows).
3. **Contextual user instructions.** Pi's discovered context files
   (`AGENTS.md`, `CLAUDE.md`, and similar) are combined into one hidden custom
   message of type `pi-developer-prompt/agents-md`, inserted before the
   conversation history in the `context` hook. If the first file lives in Pi's
   agent directory (global instructions), it is separated from project files
   with a `--- project-doc ---` divider. Context files are never mapped to a
   developer message.

The envelope is remembered per session so compaction and provider retries can
rebuild it. If building fails, the extension notifies the UI and reuses the
last good prompt for the same provider. Audit copies (current types and legacy
`pi-system-prompt/*` types) are removed from the model context, compaction
input, and tree-summary input.

## Add a developer contribution

Extensions import from `@luan-pi/pi-developer-prompt` and register content:

```ts
import { registerDeveloperMessageContribution } from "@luan-pi/pi-developer-prompt";

const unregister = registerDeveloperMessageContribution({
	id: "my-extension/mode",
	priority: 100,
	providers: ["openai-codex"],
	activeTools: ["read"],
	content: ({ sessionId, prompt }) =>
		prompt ? `<mode session="${sessionId}">...</mode>` : undefined,
});
```

- `id` is required and unique; registering the same id again replaces the
  earlier contribution.
- `priority` sorts low to high (default `0`); `id` breaks ties alphabetically.
- `providers` restricts the contribution to those provider ids. A contribution
  with `providers` set is skipped when the current provider is unknown.
- `activeTools` requires every listed tool to be active.
- `content` is a string or a function of the render context (`provider`,
  `activeTools`, `sessionId`, `prompt`, `systemPromptOptions`). Empty or
  whitespace-only results are dropped.

### Registering without importing the package

The registry lives on `globalThis` under `Symbol.for("pi-developer-prompt/developer-messages/v1")`:
a `Map<id, contribution>` with `protocol` set to that same string and
`version: 1`. An extension without a hard dependency can create the map with
those two fields if it is missing and `set` its contribution directly; this
package adopts a pre-existing registry when it loads, and reads it on every
envelope build, so load order does not matter. Detect that this package is
active by checking `globalThis[Symbol.for("pi-developer-prompt/envelope-service/v1")]`.

## Provider adapters

Provider packages register an adapter through
`registerSystemPromptPayloadAdapter` (registry symbol
`pi-developer-prompt/provider-payload-adapters/v1`, same `Map` + `protocol` +
`version: 1` shape as above, keyed by provider id):

```ts
interface SystemPromptPayloadAdapter {
	provider: string;
	readSystemPrompt(payload: unknown): string | undefined;
	replaceSystemPrompt(payload: unknown, systemPrompt: string): unknown;
	replaceDeveloperMessages?(payload: unknown, messages: readonly { id: string; content: string }[]): unknown;
}
```

In `before_provider_request`, if `readSystemPrompt` returns Pi's original
system prompt, it is replaced with the composed provider instructions. If
`replaceDeveloperMessages` exists, it receives the composed developer messages
so the provider can serialize them as native developer-role items. The
extension never turns a developer message into a user message.

## Prompt envelope service

`getPromptEnvelopeService()` returns the running service (or `undefined`):

- `capture(request)` builds and stores the envelope for a session and
  publishes audit entries. A non-user-triggered turn (for example a hidden
  subagent task) can call this before it starts so it uses the same
  developer-message path.
- `current(sessionId, overrides?)` rebuilds the envelope from the stored
  request, optionally overriding `provider`, `activeTools`, or `cwd`.
- `clear(sessionId)` forgets the stored request.

## Settings

Settings use the `pi-developer-prompt` namespace and are edited with
`/xsettings` when `@luan-pi/pi-xsettings` is installed; otherwise the defaults
apply.

| Key | Default | Meaning |
| --- | --- | --- |
| `auditEntries` | `["developer", "context-user"]` | Which composed roles are persisted as inspectable session entries. |

In `~/.pi/agent/xsettings.toml` this is stored as:

```toml
[appearance]
pi-developer-prompt.auditEntries = ["developer", "context-user"]
```

Set it to `[]`, `["developer"]`, or `["context-user"]` to reduce what is
persisted. Audit entries are stored as one `pi-developer-prompt/group` custom
entry per envelope (skipped when identical to the latest group) and rendered as
collapsible rows. They only affect the transcript; the model request is
unchanged.

## Troubleshooting

- A contribution is missing: check its `id`, provider id, active tool names,
  and whether its callback returns non-empty text. Filtering happens before
  ordering.
- A provider still receives the old prompt: no adapter is registered for that
  provider id, or `readSystemPrompt` did not return Pi's original prompt.
- `AGENTS.md` appears twice after compaction: inspect custom messages of type
  `pi-developer-prompt/agents-md`; current and legacy copies are removed before
  re-injection.
- Audit entries are not visible: include `developer` or `context-user` in
  `auditEntries`, then expand the custom session entries.

## Layout

| Responsibility | File |
| --- | --- |
| Pi hooks and session lifecycle | `src/extension.ts` |
| Contribution registry, ordering, environment message | `src/developer-messages.ts` |
| Provider/system prompt selection | `src/provider-instructions.ts` |
| Provider payload adapter capability | `src/provider-payload.ts` |
| Context-files message | `src/context-messages.ts` |
| Prompt envelope service | `src/prompt-envelope.ts` |
| Audit persistence and renderers | `src/audit-entries.ts` |
| Typed settings and public exports | `src/contributions/xsettings.ts`, `src/index.ts` |

## Develop

Source: https://github.com/luan/agents, directory
harnesses/pi/agent/packages/pi-developer-prompt. Run `bun run typecheck` and
`bun test test` in that directory.
