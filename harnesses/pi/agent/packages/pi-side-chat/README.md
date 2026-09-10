# pi-side-chat

`pi-side-chat` opens independent, interactive Pi sessions next to the one you
are working in. Each side chat is a real child `pi` process running in a PTY.
It starts with a copy of the parent session's model-visible history, followed
by a hidden boundary message that tells the model the inherited history is
reference only. Use it to ask questions or explore without disturbing the main
thread.

It is a Pi extension, not a model-facing tool. It registers one command, one
action, and an optional side-panel provider.

## Install

```sh
pi install npm:@luan-pi/pi-side-chat
```

From a checkout of this repository:

```sh
pi install ./harnesses/pi/agent/packages/pi-side-chat
```

The package bundles its `pi-libtui` and `pi-libactions` dependencies and loads
the `pi-libtui` extension alongside its own. It requires Pi's interactive TUI;
in print or non-UI mode the `/side` command reports that side chat is
unavailable.

### External requirement: `terminal_bridge`

Side chats render through `PtyPane` from `pi-libtui`, which drives child
processes with the native `terminal_bridge` binary. It builds itself on first
use with `cargo`, so a Rust toolchain (<https://rustup.rs>) is required. Set
`PI_TERMINAL_BRIDGE_BINARY` to an absolute path to use a binary that is
installed elsewhere.

## Use it

| Input | Effect |
| --- | --- |
| `/side` | Start a new side chat |
| `/side <prompt>` | Start a new side chat and send `<prompt>` as its first message |
| `/side close` | Close the active side-chat tab (side-panel host only) |
| action `side-panel.chat.new` | Same as `/side` with no prompt |

Every side chat is new. The command never resumes an existing chat by name.
Each child gets a fresh UUID session id and a label of the form `Side N`,
where `N` increments for the life of the parent session.

The child runs `pi --tui-mode fullscreen` with the parent's current model and
thinking level, and a theme variation derived from the parent's theme so the
two surfaces are distinguishable. The environment variable
`PI_EMBEDDED_SIDE_CHAT=1` is set on the child process.

Child sessions are stored in `side-chats/<uuid>/` under the parent's session
directory. When the parent runs without a session file (`--no-session`), they
go under `pi-side-chat/<parent-session-id>/` in the OS temporary directory
instead.

### With and without `pi-side-panel`

The package registers a side-panel provider through `pi-libtui`. When a
side-panel host such as `pi-side-panel` is present, each chat appears as a
tab labelled `Side N` with a `󱐒` icon, and the panel's empty state gains a
"Side chat" action. Restored tabs are added without starting their child
processes until they are shown.

When no host is present, the same PTY pane opens in a fullscreen overlay
instead. Only one restored chat can be shown this way: on session start the
newest persisted chat is reopened in the overlay. Multiple simultaneous
restored chats need the tabbed panel. `/side close` has no effect in overlay
mode; leave the overlay or exit the child `pi` instead.

### Lifecycle

Open chats are recorded as a custom session entry (`side-chat:tabs-v1`) in
the parent session, so they survive `/reload` and session restore. On
`/reload` the live child processes are handed to the reloaded extension
intact, including any unsent editor text. Switching session or quitting Pi
terminates the children. A child exiting on its own removes its tab.

## Settings

The package declares no settings. It reads model, thinking level, theme, and
session location from the parent Pi context.

## Keybindings

The extension registers the `side-panel.chat.new` action through
`pi-libactions` without a default key. Bind it in your managed
`keybindings.json` if you want a shortcut; `/side` works without one.

## Layout

| Responsibility | File |
| --- | --- |
| `/side` command, `side-panel.chat.new` action, side-panel provider, session hooks | `src/extension.ts` |
| Child session creation, inherited history, boundary message, `pi` command line | `src/session.ts` |
| PTY processes, panel tabs, overlay fallback, close and dispose | `src/manager.ts` |
| Persisted tab state (`side-chat:tabs-v1`) and validation | `src/state.ts` |
| Handing live PTYs across extension reload | `src/process-registry.ts` |
| Public exports (`createSideChatCommand`, `prepareSideChatSession`, `latestSideChatState`, ...) | `src/index.ts` |

## Develop

From the package directory:

```sh
bun run typecheck
bun test test
```
