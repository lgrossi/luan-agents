# pi-copy-mode

`@luan-pi/pi-copy-mode` is a keyboard-driven copy mode for Pi's fullscreen
transcript. It adds a Vim-like cursor, character/line/column selection,
clipboard copy, and a small action bar next to the selected text.

It is a Pi extension, not a model-facing tool. It adds no tools and no slash
commands.

## Install

```sh
pi install npm:@luan-pi/pi-copy-mode
```

Optional companions:

- `pi install npm:@luan-pi/pi-xsettings` adds the `/xsettings` UI for the
  setting below and binds the `copy-mode.enter` action to a global key from
  `keybindings.json`; without it the default setting applies and copy mode can
  only be entered from a mouse selection (see below).
- `pi install npm:@luan-pi/pi-annotations` consumes the comment and reaction
  actions; without an extension like it those two actions do nothing.

## Use it

Copy mode works only in Pi's interactive fullscreen TUI; elsewhere the entry
action shows a warning. There are two ways in:

- Run the `copy-mode.enter` action from a key you bound to it. The cursor
  starts on the bottom visible transcript row.
- Select text with the mouse. The selection stays a normal Pi selection, and
  an action bar (comment, react, copy) appears next to it. Clicking a bar
  action, or pressing any key bound to a copy-mode motion or selection action,
  adopts the range as a character selection and enters copy mode. A key bound
  to `copy-mode.halfPageDown` that is literally `ctrl+d` does not adopt.

Inside copy mode the status line shows `COPY MODE` plus the selection kind, a
pending count, or a pending find motion. Unbound keys are swallowed. A focused
overlay (dialog, picker) receives keys as usual; copy mode stays active behind
it.

Behaviour of the actions:

- Motions move the cursor and keep it on screen. Digits typed before a motion
  form a count (capped at 9999); a bare `0` is not a count, so it can be bound
  to `copy-mode.lineStart`. Find/till motions wait for the next printable
  character; a non-printable key cancels them.
- `toggleSelection`, `lineSelection`, and `columnSelection` start a selection
  of that kind anchored at the cursor, switch kind if one is active, or return
  to a bare cursor when pressed again in the same kind. `swapEnds` moves the
  cursor to the other end. `clearSelection` first cancels a pending count or
  find, then collapses the selection and stays in copy mode. `ctrl+[` is
  treated as the same key as `escape`.
- `copy` copies the selection (or the character under the cursor) and leaves
  copy mode. Character selections trim trailing whitespace per row; line
  selections keep trailing spaces and end with a newline; column selections
  copy the exact rectangle, padding short rows with spaces. Copy uses Pi's
  clipboard when Pi provides one and falls back to an OSC 52 escape sequence
  otherwise. A "Copied!" or "Copy failed" pill appears at the cursor.
- `annotate` and `react` publish `selection.comment` and `selection.reaction`
  requests through the `pi-libtui/selection` registry. They are absent unless
  an extension such as `@luan-pi/pi-annotations` is installed to handle them.
  While the handler runs, copy-mode input is suspended. A confirmed request
  collapses the selection to the cursor and keeps copy mode active; a
  cancelled one keeps the range. When the request was started from a mouse
  selection, copy mode exits afterwards.
- `cancel` clears the selection and leaves copy mode.
- Folds: `foldPrefix` arms a prefix; the next key is matched against
  `foldOpen`, `foldClose`, `foldOpenAll`, and `foldCloseAll`. The suffix keys
  do nothing without the prefix. Open/close apply to the fold under the
  cursor, provided by other extensions through the `pi-libtui/folding`
  registry.

A left click inside copy mode moves the cursor to that cell and drops the
selection; a drag after it is a normal mouse selection.

## Keybindings

No action in this package has a default key. Actions are registered through
`pi-libactions`, and keys come from `keybindings.json` in Pi's agent
directory, normally `~/.pi/agent/keybindings.json`. The file is a JSON object
mapping action ID to one key ID or an array of key IDs. Key IDs are lowercase:
write `shift+v` rather than `V`, `escape` rather than `Escape`. Invalid key IDs
are ignored. The file is read when a session starts; run `/reload` after
editing it.

Global entry (exposed as a shortcut only when `@luan-pi/pi-xsettings` is
installed):

```json
{ "copy-mode.enter": "alt+z" }
```

Modal actions, active only inside copy mode or on a completed mouse selection.
One example per group; the full ID list follows.

```json
{
  "copy-mode.up": ["k", "up"],
  "copy-mode.wordForward": "w",
  "copy-mode.findForward": "f",
  "copy-mode.paragraphForward": "}",
  "copy-mode.toggleSelection": ["v", "space"],
  "copy-mode.lineSelection": "shift+v",
  "copy-mode.columnSelection": "ctrl+v",
  "copy-mode.swapEnds": "o",
  "copy-mode.clearSelection": "escape",
  "copy-mode.copy": "y",
  "copy-mode.annotate": "c",
  "copy-mode.react": "r",
  "copy-mode.cancel": "q",
  "copy-mode.foldPrefix": "z",
  "copy-mode.foldOpen": "o",
  "copy-mode.foldClose": "c",
  "copy-mode.foldOpenAll": "shift+r",
  "copy-mode.foldCloseAll": "shift+m"
}
```

| Group | Action IDs (`copy-mode.` prefix) |
| --- | --- |
| Basic motion | `up`, `down`, `left`, `right`, `lineStart`, `lineEnd`, `top`, `bottom`, `halfPageUp`, `halfPageDown`, `pageUp`, `pageDown` |
| Word motion | `wordForward`, `wordEnd`, `wordBackward`, `bigWordForward`, `bigWordEnd`, `bigWordBackward` |
| Character find | `findForward`, `findBackward`, `tillForward`, `tillBackward`, `repeatFind`, `reverseFind` |
| Line/paragraph | `paragraphForward`, `paragraphBackward`, `firstNonblank`, `firstNonblankDown` |
| Selection | `toggleSelection`, `lineSelection`, `columnSelection`, `swapEnds`, `clearSelection` |
| Actions | `copy`, `annotate`, `react`, `cancel` |
| Folds | `foldPrefix`, `foldOpen`, `foldClose`, `foldOpenAll`, `foldCloseAll` |

## Settings

Namespace `pi-copy-mode`, one key:

| Key | Default | Meaning |
| --- | --- | --- |
| `copyOnSelect` | `false` | Copy text immediately when a mouse selection is completed. When off, the selection stays available for the action bar and keyboard adoption. |

Edit it under Interaction → Copy mode via `/xsettings` when
`@luan-pi/pi-xsettings` is installed; otherwise the default applies.

## Library API

Importing `@luan-pi/pi-copy-mode` does not start the extension. It exports:

- Keybinding contracts: `COPY_MODE_ACTIONS`, `loadCopyModeKeybindings`, and
  `matchCopyModeAction`, with the `CopyModeAction` and `CopyModeKeybindings`
  types.
- Cursor and motion helpers: `clampCursor`, `moveCursor`,
  `moveVirtualCursor`, `graphemeEnd`, and `scrollTopForCursor`, plus their
  document and point types.

## Architecture

The extension registers the `copy-mode.enter` action and the setting at load
time, and mounts one session-scoped host widget per TUI session. The host
reads the fullscreen transcript through a validated private Pi surface, draws
the cursor and selection as screen decorations, and talks to other extensions
only through the shared `pi-libtui` selection, folding, and mouse registries.
Other packages (for example `@luan-pi/pi-annotations`) bundle this one; if two
copies load, the first claims ownership and the second stays inert until the
owner releases on reload or quit.

## Layout

| Responsibility | File |
| --- | --- |
| Extension entry, ownership claim, session lifecycle | `src/extension.ts` |
| `copy-mode.enter` action registration | `src/contributions/actions.ts` |
| Action IDs, keybinding loading and matching | `src/config/keybindings.ts` |
| `copyOnSelect` setting | `src/config/settings.ts` |
| Modal host: input, selection kinds, copy, selection requests, folds | `src/runtime/copy-mode.ts` |
| Validated fullscreen surface and clipboard fallback | `src/runtime/fullscreen-surface.ts` |
| Cursor clamping and basic motions | `src/core/cursor.ts` |
| Word, find, paragraph motions | `src/core/vim-motions.ts` |
| Cursor and selection painting | `src/ui/screen-decoration.ts` |
| Public exports | `src/index.ts` |

## Troubleshooting

- A key does nothing: there are no built-in keys. Check the action ID and key
  ID in `keybindings.json` and run `/reload`. For `copy-mode.enter`,
  `@luan-pi/pi-xsettings` must be installed.
- Comment or react does nothing: no extension handles `pi-libtui/selection`
  actions.
- "Copy mode requires Pi's fullscreen TUI": the package targets Pi 0.84.2's
  private fullscreen surface and fails closed when the layout does not match.

## Develop

Source: https://github.com/luan/agents, directory
harnesses/pi/agent/packages/pi-copy-mode. Run `bun run typecheck` and
`bun test test` in that directory.
