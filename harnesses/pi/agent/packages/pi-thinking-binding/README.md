# @luan-pi/pi-thinking-binding

A Pi extension that drops Anthropic thinking blocks a system prompt or tool
change has already invalidated, so the `prefix_binding_mismatch` warning
appears once instead of on every turn.

## Install

```
pi install npm:@luan-pi/pi-thinking-binding
```

Nothing else is needed. The extension registers no tools, commands, settings,
or keybindings, and it has no companion packages.

## The problem

Anthropic binds every thinking block signature to the request prefix that
produced it: the `system` prompt, the `tools` set, and the messages before the
block. When that prefix changes, typically because an extension's tool
description or the system prompt changed and Pi was restarted into an existing
session, every earlier block is invalid. The API then drops each one on every
later turn and Pi reports
`Anthropic dropped N thinking blocks: prefix_binding_mismatch` for the rest of
the session.

## What it does

The extension does the drop itself, once. It only acts on models whose API is
`anthropic-messages`; other providers are untouched.

1. On each `before_provider_request`, it fingerprints the request's `system`
   and `tools` (a SHA-256 over their JSON) and compares it with the fingerprint
   recorded on the current session branch.
2. If the fingerprint is new for this branch, it records it. The first sighting
   in a session invalidates nothing.
3. If the fingerprint differs from the recorded one, it strips `thinking` and
   `redacted_thinking` blocks from the assistant messages in that request body
   and records the newest assistant message timestamp as the stale cutoff.
4. On later turns, the `context` hook removes thinking from assistant messages
   at or before the cutoff before they reach the provider. Newer reasoning is
   left alone.
5. For sessions that were already broken before a fingerprint was recorded,
   the `message_end` hook trusts Anthropic's own
   `thinking_dropped` / `prefix_binding_mismatch` diagnostic once and records
   the cutoff from it.

A message whose only content is thinking is never emptied; it is left as is.

## State

State lives in the session as `custom` entries of type `pi-thinking-binding`,
one per prefix change on the branch:

```json
{ "version": 1, "fingerprint": "<sha256 hex>", "staleThrough": 1712345678901 }
```

`staleThrough` is the assistant message timestamp at or before which thinking
is dead; it is absent until the first prefix change. The newest valid entry on
the branch wins.

The session file keeps the original thinking blocks. Only the messages handed
to the provider are changed, which is what the API would have done anyway.

## Configuration

There is none. Behaviour is fixed in source; there are no settings,
keybindings, or environment variables.

## Programmatic use

`@luan-pi/pi-thinking-binding` exports the core functions for reuse or
testing: `BINDING_ENTRY_TYPE`, `BindingState`, `fingerprintPrefix`,
`newestAssistantTimestamp`, `parseAnthropicPayload`, `readBindingState`,
`reportsPrefixMismatch`, `stripPayloadThinking`, `stripStaleThinking`.

## Layout

| Responsibility | File |
| --- | --- |
| Pi registration; `context`, `before_provider_request`, `message_end` hooks | `src/extension.ts` |
| Payload narrowing, fingerprint, state read, stale cutoff, stripping | `src/core/binding.ts` |
| Public exports | `src/index.ts` |

## Develop

Source: https://github.com/luan/agents, directory
harnesses/pi/agent/packages/pi-thinking-binding. Run `bun run typecheck` and
`bun test test` in that directory.
