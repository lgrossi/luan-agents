# @luan-pi/pi-libcontext

`@luan-pi/pi-libcontext` is a small TypeScript library for Pi extension
authors. It defines a shared, UI-free protocol for context-window preferences:
one extension can publish a requested preset (for example `"large"`), and a
provider extension that owns the model can read that request and decide what
it means for the current model. Neither side has to import the other.

This is a library, not a Pi extension. It has no settings, persistence,
commands, keybindings, tools, or UI, and it does nothing on its own until a
provider calls `requestedContextWindowPreset()`.

## Install

Add it to the extension package that will register or read presets. Bundle it
so the installed extension carries its own copy:

```json
{
  "dependencies": {
    "@luan-pi/pi-libcontext": "^0.1.0"
  },
  "bundledDependencies": ["@luan-pi/pi-libcontext"]
}
```

Then import the public SDK:

```ts
import {
  CONTEXT_WINDOW_PRESETS,
  ensureContextWindowSourceRegistry,
  requestedContextWindowPreset,
  type ContextWindowPreset,
} from "@luan-pi/pi-libcontext/sdk";
```

The package root (`@luan-pi/pi-libcontext`) re-exports the same names. It has
no runtime dependencies. Its only peer dependency is
`@earendil-works/pi-coding-agent`, which supplies the `ExtensionContext` type
passed to sources.

Optional companion: `pi install npm:@luan-pi/pi-codex-native` is a provider
that reads the first valid request from this registry and applies it to
eligible Codex models; without it (or another provider), registered sources
are stored but never consulted.

## Presets

`ContextWindowPreset` is one of these exact lowercase values, in increasing
size order:

```ts
const CONTEXT_WINDOW_PRESETS = ["smart", "balanced", "enhanced", "large", "max"] as const;
```

`ContextWindowPreference` adds `"default"` at the front:

```ts
const CONTEXT_WINDOW_PREFERENCES = ["default", "smart", "balanced", "enhanced", "large", "max"] as const;
```

`"default"` means the provider's own setting should win. It is a preference
value for provider-side settings, not a preset, and is never returned by
`requestedContextWindowPreset()`.

`isContextWindowPreset(value)` validates an untyped value. It accepts only the
five strings in `CONTEXT_WINDOW_PRESETS`; `"default"`, `undefined`, and any
other value are rejected.

## Publishing a request (source side)

A source has an `id` and a `preset(ctx)` function that derives a preset for the
current `ExtensionContext`, or returns `undefined` to make no request:

```ts
import { ensureContextWindowSourceRegistry, type ContextWindowPreset } from "@luan-pi/pi-libcontext/sdk";

const unregister = ensureContextWindowSourceRegistry().register({
  id: "example",
  preset(_ctx): ContextWindowPreset | undefined {
    return "large";
  },
});

// Call when the contributing extension is disposed or reloaded.
unregister();
```

`register()` returns a disposer. Register and dispose with your extension
lifecycle so reloads do not leave stale sources behind.

Registrations are keyed by source object identity, not by `id`. Registering a
second source with the same `id` does not replace the first; both stay active,
and each disposer removes only the object it was created for. The `id` is
descriptive only.

## Reading a request (provider side)

```ts
const requested = requestedContextWindowPreset(ctx);
```

Sources are checked in registration order. The first source whose `preset()`
returns a valid preset wins. A source that returns `undefined` or an invalid
value is skipped. A source that throws is also skipped and the error is
swallowed, so a broken contributor cannot break the provider. If no source
returns a valid preset, the result is `undefined`.

The library has no built-in default and never applies a context window itself.
The provider owns model eligibility, numeric window sizes, fallback behaviour,
and any stronger provider-side override.

## Registry details

The registry lives on `globalThis` under `Symbol.for("pi-libcontext/sources/v1")`
(exported as `CONTEXT_WINDOW_SOURCES_KEY`). It exposes:

| Member | Value |
| --- | --- |
| `protocol` | `"pi-libcontext/sources/v1"` (`CONTEXT_WINDOW_SOURCES_PROTOCOL`) |
| `version` | `1` |
| `register(source)` | returns a disposer function |

`ensureContextWindowSourceRegistry()` creates the registry on first call and
returns the existing one afterwards. Because the key uses `Symbol.for`,
separate copies of this package loaded in the same JavaScript realm (for
example two extensions that each bundle it) share one registry and one source
list. An existing value at that key is reused only if it has the matching
`protocol`, `version`, and a `register` function; otherwise it is replaced.

`ensureContextWindowSourceRegistry(scope)` accepts a custom global-like object
instead of `globalThis` when an isolated registry is needed, such as in tests.
`requestedContextWindowPreset()` always reads the `globalThis` registry.

The SDK also exports the `ContextWindowSource` and
`ContextWindowSourceRegistry` types for hosts that inspect the capability
directly.

## Layout

| Responsibility | File |
| --- | --- |
| Preset constants, validator, registry, resolution | `src/protocol/context-window.ts` |
| Public SDK surface (`@luan-pi/pi-libcontext/sdk`) | `src/sdk.ts` |
| Package root re-export | `src/index.ts` |
| Registry behaviour tests | `test/registry.test.ts` |

## Develop

Source: https://github.com/luan/agents, directory
`harnesses/pi/agent/packages/pi-libcontext`. Run `bun run typecheck` and
`bun test test` in that directory.
