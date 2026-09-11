# Agents

This repository keeps the agent instructions, Pi extensions, themes, and native tools I use every day. The files stay in Git; `cargo xtask harness setup` links only the managed pieces into the real Claude, Codex, and Pi directories.

The useful part is under `harnesses/pi/agent/packages`: thirteen Pi extensions, two small shared libraries, and no framework hiding how they fit together.

## Set up

You need Rust, Bun 1.3.14, [`just`](https://github.com/casey/just), and Pi.

```sh
git clone https://github.com/luan/agents.git
cd agents
just setup
```

`just setup` builds the Rust binaries, installs the JavaScript dependencies from the lockfile, creates the managed harness links, and runs the complete check suite.

The harness roots remain ordinary directories: `~/.claude`, `~/.codex`, and `~/.pi` are never replaced with symlinks. The setup tool links only the paths listed in `managed.toml`. It refuses to overwrite an unexpected file or a link owned by something else.

Pi's `settings.json` is deliberately mutable. Pi may update the repository copy through its managed link. Credentials, sessions, caches, model stores, and other generated state stay local and out of Git.

To inspect or remove the links:

```sh
cargo xtask harness check
just unlink
```

`just unlink` removes only links that point back to this checkout.

## Pi extensions

Each extension can be loaded from this checkout or installed on its own. Its README explains its settings and public API.

| Package | What it adds | Gallery |
| --- | --- | --- |
| [`pi-fileops`](harnesses/pi/agent/packages/pi-fileops/README.md) | A Codex-compatible `apply_patch` tool backed by the Rust patch parser. | [Pi gallery](https://pi.dev/packages/pi-fileops) |
| [`@cfcluan/pi-code-mode`](harnesses/pi/agent/packages/pi-code-mode/README.md) | Restricted JavaScript composition through `exec`, with selected tools available under `tools.*`. | [Pi gallery](https://pi.dev/packages/@cfcluan/pi-code-mode) |
| [`pi-codex-native`](harnesses/pi/agent/packages/pi-codex-native/README.md) | The Codex Responses provider, models, native web tool, compaction, and provider controls. | [Pi gallery](https://pi.dev/packages/pi-codex-native) |
| [`pi-copy-mode`](harnesses/pi/agent/packages/pi-copy-mode/README.md) | Vim-style transcript selection, copying, comments, and reactions. | [Pi gallery](https://pi.dev/packages/pi-copy-mode) |
| [`pi-collapse-transcript`](harnesses/pi/agent/packages/pi-collapse-transcript/README.md) | Collapsible tools and thinking sections with a live activity summary. | [Pi gallery](https://pi.dev/packages/pi-collapse-transcript) |
| [`pi-developer-messages`](harnesses/pi/agent/packages/pi-developer-messages/README.md) | Provider instructions, developer messages, environment context, and prompt inspection. | [Pi gallery](https://pi.dev/packages/pi-developer-messages) |
| [`pi-exec-command`](harnesses/pi/agent/packages/pi-exec-command/README.md) | Bounded shell commands and persistent PTY sessions through `exec_command` and `write_stdin`. | [Pi gallery](https://pi.dev/packages/pi-exec-command) |
| [`pi-libtui`](harnesses/pi/agent/packages/pi-libtui/README.md) | Shared terminal components, semantic colors, mouse handling, selection bridges, and tool presentation. | [Pi gallery](https://pi.dev/packages/pi-libtui) |
| [`@cfcluan/pi-skills`](harnesses/pi/agent/packages/pi-skills/README.md) | Exact-name skill loading through the `skill` tool. | [Pi gallery](https://pi.dev/packages/@cfcluan/pi-skills) |
| [`@cfcluan/pi-tool-search`](harnesses/pi/agent/packages/pi-tool-search/README.md) | Search and activation for a configured set of deferred tools. | [Pi gallery](https://pi.dev/packages/@cfcluan/pi-tool-search) |
| [`pi-view-image`](harnesses/pi/agent/packages/pi-view-image/README.md) | A Codex-compatible native image attachment tool. | [Pi gallery](https://pi.dev/packages/pi-view-image) |
| [`pi-xsettings`](harnesses/pi/agent/packages/pi-xsettings/README.md) | Typed settings registration, TOML persistence, keybindings, and the `/xsettings` editor. | [Pi gallery](https://pi.dev/packages/pi-xsettings) |
| [`pi-custom-editor`](harnesses/pi/agent/packages/pi-custom-editor/README.md) | Custom editor layouts, file and skill tokens, and a semantic status footer. | [Pi gallery](https://pi.dev/packages/pi-custom-editor) |
| [`pi-panels`](harnesses/pi/agent/packages/pi-panels/README.md) | Contributed side-panel tabs with focus, resize, reorder, and zoom controls. | [Pi gallery](https://pi.dev/packages/pi-panels) |
| [`pi-prompt-storage`](harnesses/pi/agent/packages/pi-prompt-storage/README.md) | Draft stashing and searchable prompt history. | [Pi gallery](https://pi.dev/packages/pi-prompt-storage) |
| [`pi-side`](harnesses/pi/agent/packages/pi-side/README.md) | Independent side conversations alongside the main session. | [Pi gallery](https://pi.dev/packages/pi-side) |
| [`@cfcluan/pi-subagents`](harnesses/pi/agent/packages/pi-subagents/README.md) | Concurrent, nested subagents with an Agent Hub for inspecting their work. | [Pi gallery](https://pi.dev/packages/@cfcluan/pi-subagents) |
| [`pi-thinking-binding`](harnesses/pi/agent/packages/pi-thinking-binding/README.md) | Drops Anthropic thinking blocks invalidated by system-prompt or tool changes. | [Pi gallery](https://pi.dev/packages/pi-thinking-binding) |
| [`@cfcluan/pi-tuicr`](harnesses/pi/agent/packages/pi-tuicr/README.md) | Embedded Tuicr review with comments returned to Pi as prompt attachments. | [Pi gallery](https://pi.dev/packages/@cfcluan/pi-tuicr) |

## Shared Pi libraries

These packages register no Pi extension by themselves.

| Package | What it owns | Gallery |
| --- | --- | --- |
| [`pi-libactions`](harnesses/pi/agent/packages/pi-libactions/README.md) | The UI-free custom-action registry and validated `keybindings.json` loader. | [Pi gallery](https://pi.dev/packages/pi-libactions) |

`pi-libtui` is the one deliberate dual-role package: imports expose reusable components without side effects, while its extension entry point installs generic terminal compatibility for Pi.

## Native tools

TypeScript registers and composes Pi features. Rust owns the process, patch, protocol, and JavaScript-runtime boundaries.

| Crate | Responsibility |
| --- | --- |
| `apply-patch` | Parses and applies structured patches. |
| `code-mode-host` | Runs the Code Mode host process. |
| `code-mode-protocol` | Defines the host wire protocol. |
| `code-mode-runtime` | Executes restricted JavaScript and coordinates nested calls. |
| `terminal-bridge` | Runs bounded pipes and persistent PTY sessions. |
| `web-run` | Executes the native Codex web request contract. |
| `view-image` | Reads local images for Codex-compatible attachment previews. |
| `xtask` | Sets up, checks, and removes managed harness links. |

## Configure Pi

The checked-in Pi setup uses three files:

- `harnesses/pi/agent/settings.json` selects packages, models, theme, and Pi-owned behavior.
- `harnesses/pi/agent/xsettings.toml` stores settings contributed by extensions. Open it interactively with `/xsettings` or `Ctrl-,`.
- `harnesses/pi/agent/keybindings.json` owns Pi bindings and every custom extension action.

Use `Alt+P` for Pi's model picker and `Alt+,` / `Alt+.` to decrease or increase
reasoning effort. Subagents inherit the parent's model and effort unless a
spawn supplies direct overrides.

Tool visibility has three separate controls:

- `pi.defaultTools` selects direct tools.
- `pi-code-mode.tools` moves selected active tools under `exec`.
- `pi-tool-search.tools` defers selected tools within the scope where `tool_search` runs.

Code Mode alone changes tool hierarchy. Tool Search only controls deferred membership; a disabled tool is not silently made deferred.

Run `/reload` after changing package loading, keybindings, or a setting documented as reload-only. Appearance and other live settings apply immediately when their package says they do.

## Work on the repository

```sh
just check
```

On a warm checkout this builds the release binaries once, then runs the checks in phases:

- Biome formatting and Pi policy lint;
- cached TypeScript checks for every package;
- every package's test command in a separate process, run in parallel with
  package-labelled output (no shared cross-package test state);
- Rust formatting, Clippy, and the complete workspace through Nextest;
- managed harness validation.

No Rust test is ignored. `cargo nextest run --locked` runs the whole virtual Rust workspace.
Each check prints its command; `All checks passed.` appears only after every
phase succeeds. The test runner does not retry failures.

Useful narrower commands:

```sh
bun run typecheck
bun run test:pi
cargo nextest run --locked
```

See [the package migration](docs/pi-package-migration.md) for renamed packages and upgrade instructions.

## Release

Pi packages publish under their unscoped names, except `@cfcluan/pi-skills`, `@cfcluan/pi-code-mode`, `@cfcluan/pi-subagents`,
`@cfcluan/pi-tuicr`, and `@cfcluan/pi-tool-search`. Bump every
package version, commit, then tag and push:

```sh
git tag v0.3.3 && git push origin main v0.3.3
```

`.github/workflows/publish.yml` publishes each package whose version matches the
tag and skips versions already on the registry. It authenticates with npm
trusted publishing (OIDC), so no token is stored; each package must list this
repository's `publish.yml` as a trusted publisher on npmjs.com once. Native
binaries build on first use from the same tag, so never move or delete a
released tag. `just pi-publish <package>` runs the same steps locally.

## Common problems

**A native tool says its binary is missing.** Run `cargo build --locked --release`, or `just setup` to rebuild and check everything.

**A tool is not visible.** Check all three tool lists above. Under strict selection, `exec`, `tool_search`, and direct tools exist only when the active scope includes them.

**A fullscreen interaction is absent.** Copy mode, mouse overlays, and some selection UI require Pi's fullscreen TUI. Check `pi.tuiMode` in `xsettings.toml`.

**Setup refuses a path.** Inspect it before changing anything. The refusal means a real file or an unexpected link occupies a managed location; setup will not delete it for you.

**A package works here but not alone.** From `harnesses/pi/agent`, run `pi install packages/<name>`. Each package keeps its runtime dependencies in its own manifest, so a standalone install failure is a package bug.
