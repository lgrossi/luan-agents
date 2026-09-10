# pi-thinking-binding

Anthropic binds every thinking block signature to the request prefix that produced
it: the `system` prompt, the `tools` set, and the messages before the block. When
that prefix changes, typically because an extension's tool description or the
system prompt changed and Pi was restarted into an existing session, every earlier
block is invalid. The API then drops each one on every later turn and Pi reports
`Anthropic dropped N thinking blocks: prefix_binding_mismatch` for the rest of the
session.

This extension does the drop itself, once. It fingerprints `system` and `tools` per
request and records the fingerprint on the session branch. When a request's
fingerprint differs from the recorded one, it strips the thinking blocks from that
request body, records the newest assistant timestamp as the stale cutoff, and
strips thinking from those older assistant messages on later requests. Newer
reasoning is left alone. The session file keeps the blocks; only the provider
request changes, which is what the API would have done anyway.

Install with `pi install npm:@luan-pi/pi-thinking-binding` (or
`pi install ./harnesses/pi/agent/packages/pi-thinking-binding` from a checkout).
No tools, settings, or keybindings.

## Architecture

| Concern | Owner |
| --- | --- |
| Pi registration and lifecycle | `src/extension.ts` (`context` and `before_provider_request` hooks, Anthropic models only) |
| Tool definition / execution | None |
| State | One `pi-thinking-binding` custom entry per prefix change on the session branch |
| Core logic | `src/core/binding.ts`: payload narrowing, fingerprint, stale cutoff, stripping |
| Native boundary | None |
| Presentation | None; Pi's default rendering is unchanged |
| Public surface | `src/index.ts` re-exports the core functions for tests |
