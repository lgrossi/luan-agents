# @luan-pi/pi-side-chat

`@luan-pi/pi-side-chat` opens independent, interactive Pi sessions next to the
one you are working in. Each side chat is a real child `pi` process running in
a PTY. It starts with a copy of the parent session's model-visible history,
followed by a hidden boundary message that tells the model the inherited
history is reference only. Use it to ask questions or explore without
disturbing the main thread.

It is a Pi extension, not a model-facing tool. It registers one command
(`/side`), one action (`side-panel.chat.new`), and a side-panel provider.

## Preview

Independent side conversation beside the main Pi session.

![pi-side-chat in Bootty](https://github.com/luan/agents/releases/download/v0.2.2/pi-side-chat.png)

[Watch the demo](https://github.com/luan/agents/releases/download/v0.2.2/pi-side-chat.mp4).

## Install

```sh
pi install npm:@luan-pi/pi-side-chat
```

The package requires Pi's interactive TUI. In print or non-UI mode the `/side`
command reports that side chat is unavailable.

Optional companion: `pi install npm:@luan-pi/pi-side-panel` hosts each side
chat as a tab in a side panel; without it, side chats open in a fullscreen
overlay instead (see below).

### Native binary: `terminal_bridge`

Side chats are driven by the native `terminal_bridge` binary. Requires a Rust
toolchain (https://rustup.rs). The `terminal_bridge` binary builds itself on
first use under Pi's agent directory (`native/terminal-bridge/<version>/`).
Set `PI_TERMINAL_BRIDGE_BINARY` to use a prebuilt binary.

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
directory, together with the generated theme file
`side-chat-<uuid>.json`. When the parent runs without a session file
(`--no-session`), they go under `pi-side-chat/<parent-session-id>/` in the OS
temporary directory instead.

### Inherited history

When a side chat is created, every entry of the parent's current branch that
contributes to the model context is copied into the child session, followed by
a hidden custom message (`pi-side-chat-boundary`). The boundary tells the model
that everything before it is reference context, that it should answer
questions and do lightweight non-mutating exploration, that sub-agents are
off-limits, and that it must not modify files or state unless the user
explicitly asks after the boundary. The child session records the parent
session file as its parent.

### With and without `@luan-pi/pi-side-panel`

The package registers a side-panel provider. When a side-panel host is
present, each chat appears as a tab labelled `Side N` with a `󱐒` icon, and the
panel's empty state gains a "Side chat" action. Restored tabs are added
without starting their child processes until they are shown.

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

The `side-panel.chat.new` action has no default key. To bind one, add it to
`keybindings.json` in Pi's agent directory (normally
`~/.pi/agent/keybindings.json`). Each property name is an action ID and each
value is a key ID string or an array of them:

```json
{
  "side-panel.chat.new": "ctrl+shift+n"
}
```

Key IDs are a base key optionally preceded by `ctrl`, `shift`, `alt`, or
`super`, joined with `+`. The file is read on load, so reload extensions after
editing. Bindings only take effect when a shortcut host is installed
(`pi install npm:@luan-pi/pi-xsettings` provides one). `/side` works without
any binding.

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

Source: https://github.com/luan/agents, directory
harnesses/pi/agent/packages/pi-side-chat. Run `bun run typecheck` and
`bun test test` in that directory.
