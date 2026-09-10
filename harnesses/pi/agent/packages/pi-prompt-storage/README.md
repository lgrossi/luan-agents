# pi-prompt-storage

`pi-prompt-storage` adds a per-directory prompt stash and a searchable history
of past user prompts to Pi's editor. It stores both in a local SQLite database,
indexes session files lazily, and merges the current session's prompts live.

It is a Pi extension, not a model-facing tool. It registers no tools and no
side-panel tabs; it wraps the editor's input handling, adds one slash command,
and draws a one-line widget above the editor.

## Install

```sh
pi install npm:@luan-pi/pi-prompt-storage
```

From this repository:

```sh
pi install ./harnesses/pi/agent/packages/pi-prompt-storage
```

The package bundles `@luan-pi/pi-libtui`, whose extension is loaded alongside
this one for the shared editor layer, picker panel, and theme helpers. Pi's
`@earendil-works/pi-coding-agent` and `@earendil-works/pi-tui` are peer
dependencies and come from the host Pi installation.

## Use it

### Stash

`ctrl+s` in the editor does one of two things, based on the editor content:

- Editor has text: the draft is stashed for the current working directory and
  the editor is cleared.
- Editor is empty: with one stash, it is popped straight into the editor. With
  more than one, the Prompt Stash picker opens.

Stashes are scoped to `ctx.cwd`; a picker only lists stashes made from the
same directory.

The Prompt Stash picker is a `pi-libtui` `PickerPanel` anchored bottom-left
at full width. Keys inside it:

| Key | Action |
| --- | --- |
| Enter | Pop: put the stash in the editor and delete it |
| `ctrl+a` | Apply: put the stash in the editor and keep it |
| `ctrl+x` | Drop: delete the stash; the picker reopens on the row above |
| `/` | Filter by stash text or directory |
| `j`/`k`, arrows | Move |
| Escape | Cancel |

### History

`/prompt-history` opens the Prompt History picker: a centred overlay that
fuzzy-filters every indexed user prompt for the current directory by prompt
text or session name, with matching characters highlighted. Enter applies the
selected prompt to the editor; `ctrl+p`/`ctrl+n`, arrows, and Page Up/Down
move; Escape cancels. Rows show the session name (or `History`), a timestamp,
a preview, the directory, and an image marker when the original message
included an image.

While the background index is still running, the panel shows an
`Indexing sessions N/M…` or `Indexing prompts N/M…` line that updates live.

### Applying over a draft

Applying or popping while the editor holds a different non-empty draft first
stashes that draft, then replaces it. The notification says
`current draft auto-stashed` when this happens.

### Editor history

On install the editor layer preloads the current session branch's user prompts
into the editor's up-arrow history, so earlier prompts are reachable without
opening a picker.

### Stash widget

When at least one stash exists for the directory, a single muted row appears
above the editor: `Prompt stash (1)` for one stash, or
`Prompt stash (N) • <latest text>` for several. It disappears when the last
stash is popped or dropped.

## Storage and indexing

The database is `$XDG_STATE_HOME/pi/prompt-storage.sqlite`, or
`~/.local/state/pi/prompt-storage.sqlite` when `XDG_STATE_HOME` is unset. It
opens in WAL mode through `bun:sqlite` under Bun or `node:sqlite` under Node;
no native module is installed by the package.

Tables: `stashes` (text, cwd, created_at), `history_prompts` (one row per user
message per session file), and `session_index` (per-session modification time
so unchanged files are skipped). Indexing runs on `session_start` via
`SessionManager.list` for the current directory, at most once every 30 seconds
per directory, and each session file is written in its own transaction so one
bad file does not block the rest. Prompts from the live session are merged into
history results without waiting for the index.

## Settings

There are no user-facing settings. The package does not use `pi-xsettings`;
`src/config.ts` holds fixed values and states that intent:

| Key | Value | Effect |
| --- | --- | --- |
| `shortcuts.stash` | `ctrl+s` | Editor key for stash/pop |
| `history.includeSlashCommands` | `true` | Index prompts that start with `/` |
| `history.maxResults` | `120` | Cap on history picker results |
| `picker.maxVisible` | `10` | Rows shown at once in either picker |
| `picker.enterAction` | `pop` | What Enter does in the stash picker |

Change these by editing `src/config.ts`. Move a value to `pi-xsettings` when it
needs to be tunable at runtime.

## Keybinding notes

`ctrl+s` is not a `pi-libactions` action and does not appear in the managed
`keybindings.json`. The extension intercepts it inside a `pi-libtui` editor
layer, so any other extension or terminal binding on `ctrl+s` will conflict.
The picker keys (`ctrl+a`, `ctrl+x`, Enter, Escape) are fixed in
`src/ui/picker.ts`; Enter also honours the `tui.select.confirm` keybinding.

Without a TUI (print mode), the editor layer and widget are not installed and
`/prompt-history` only reports results through notifications.

## Layout

| Responsibility | File |
| --- | --- |
| Pi hooks, `ctrl+s` handling, `/prompt-history`, stash widget | `src/extension.ts` |
| Fixed configuration | `src/config.ts` |
| Types, search ranking, previews, widget text | `src/core/model.ts` |
| SQLite storage, session indexing, progress events | `src/runtime/store.ts` |
| Bun/Node SQLite driver selection | `src/native/sqlite.ts` |
| Stash and history pickers | `src/ui/picker.ts` |
| Public exports (`filterPrompts`, `queryMatchIndexes`, `PromptStorageStore`, types) | `src/index.ts` |

## Develop

```sh
cd harnesses/pi/agent/packages/pi-prompt-storage
bun run typecheck
bun test test
```

Tests cover search ranking and highlighting (`test/model.test.ts`), the stash
picker's keys and overlay placement (`test/picker.test.ts`), and the widget
line (`test/widget.test.ts`).
