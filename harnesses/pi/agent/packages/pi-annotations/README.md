# pi-annotations

`pi-annotations` turns a transcript selection into a comment attached to your
next request. It keeps the selected text and the comment together and sends
them in a `response-annotations` envelope at the top of the prompt.

The package installs three Pi extensions together: the annotation extension,
copy mode (`@luan-pi/pi-copy-mode`, which selects transcript text and offers
the comment/react actions), and the shared TUI layer they both use. It adds no
model-facing tool. Any extension that publishes `selection.comment` and
`selection.reaction` requests through the `pi-libtui/selection` capability can
trigger it; copy mode is the one that ships in the box.

## Preview

![pi-annotations in Bootty](https://github.com/luan/agents/releases/download/v0.2.2/pi-annotations.png)

[Watch the demo](https://github.com/luan/agents/releases/download/v0.2.2/pi-annotations.mp4).

## Install

```sh
pi install npm:@luan-pi/pi-annotations
```

Optional companions:

- `pi install npm:@luan-pi/pi-xsettings` adds the `/xsettings` UI for editing
  the reaction list and acts as the global shortcut host that binds
  `copy-mode.enter`. Without it the default reactions apply and copy mode is
  entered from the mouse action bar only.
- `pi install npm:@luan-pi/pi-developer-prompt` routes the annotation guidance
  for the model through its developer-message envelope. Without it the same
  guidance is appended to the system prompt when a prompt contains an envelope.

## Keybindings

Copy mode registers its actions through the action registry, which has no
default keys. Bind them in Pi's agent directory, normally
`~/.pi/agent/keybindings.json`. The file is a JSON object mapping action IDs to
one key ID or an array of key IDs (`modifier+base`, for example `alt+z`).

```json
{
  "copy-mode.enter": "alt+z",
  "copy-mode.toggleSelection": "v",
  "copy-mode.annotate": "c",
  "copy-mode.react": "r",
  "copy-mode.copy": "y",
  "copy-mode.cancel": "escape"
}
```

| Action | Where it applies | What it does |
| --- | --- | --- |
| `copy-mode.enter` | Global (needs `@luan-pi/pi-xsettings` as host) | Enter transcript copy mode |
| `copy-mode.toggleSelection` | Inside copy mode | Start or end a selection at the cursor |
| `copy-mode.annotate` | Inside copy mode, with a selection | Open a comment draft for the selection |
| `copy-mode.react` | Inside copy mode, with a selection | Open the reaction picker |
| `copy-mode.copy` | Inside copy mode, with a selection | Copy the selection |
| `copy-mode.cancel` | Inside copy mode | Leave copy mode |

Copy mode also has motion, line/column selection, and fold actions
(`copy-mode.up`, `copy-mode.wordForward`, `copy-mode.lineSelection`, and so
on); all follow the same `copy-mode.*` naming and are bound the same way.
`/reload` refreshes the keybinding snapshot. The keys above are examples, not
defaults.

## Use it

1. Trigger `copy-mode.enter` and select text with `copy-mode.toggleSelection`
   plus motions, or select transcript text with the mouse. Either way a small
   action bar with comment, react, and copy appears next to the selection.
2. Press your `copy-mode.annotate` key (or click "comment") to write a
   comment, or press `copy-mode.react` (or click "react") to pick a reaction.
3. Enter saves the draft. Escape cancels. The comment dialog also has
   Save/Cancel buttons; when editing an existing draft it adds Delete
   (`ctrl+d`).
4. Submit the prompt normally. The drafts become part of the request.

A draft appears as a numbered pill in the editor and as a handle in the
transcript, and the status line shows how many annotations are pending. Hover
a pill to see the selected text and comment; click it to edit or delete the
draft. Deleting a draft removes only its editor token and keeps the
surrounding prompt unchanged. If you remove a pill's token from the editor
text, the draft is dropped. Drafts are cleared once the message is sent.

Reactions are preset comment text. The defaults are:

- `👍 Looks good`
- `🚫 Rejected`
- `✅ Approved`
- `❓ Clarify`
- `🧬 Match existing patterns`
- `🔄 Consider alternatives`
- `🔍 Verify`

The transcript renders a submitted envelope as readable annotation blocks.
Assistant text containing `:pi-annotation{index="N"}` or the imported
`:codex-annotation{index="N"}` directive renders the corresponding annotation
as a hoverable pill. Directives inside inline or fenced code remain text.

## Settings

Settings are registered with `pi-xsettings` under namespace `pi-annotations`
(label "Annotations", category Interaction):

| Key | Type | Default |
| --- | --- | --- |
| `reactions` | ordered string list | the seven reactions listed above |

Edit them via `/xsettings` when `@luan-pi/pi-xsettings` is installed;
otherwise the defaults apply. An empty list disables the reaction picker with
a warning until at least one choice is configured. Copy mode contributes its
own `pi-copy-mode` namespace (`copyOnSelect`).

## Library API

`@luan-pi/pi-annotations` also exports pure helpers that do not start Pi:

- Envelope: `serializeEnvelope`, `parseEnvelope`, `projectEnvelope`,
  `responseAnnotations`, `annotationText`.
- Directives: `projectAnnotationDirectives`.
- Draft state: `AnnotationStore`, `tokenInsertion`, `tokenPreview`,
  `removeTokenAtom`.
- Presentation: `plainPill`, `composerPillContent`, `responsePillContent`,
  `transcriptPillContent`, `AnnotationPresentationGroups`.
- Settings: `DEFAULT_REACTIONS`, `getReactions`.
- Types: `AnnotationSelection`, `DraftAnnotation`, `ResponseAnnotation`,
  `ParsedResponseAnnotations`, `ResolvedAnnotationLink`.

```ts
import { parseEnvelope, projectEnvelope } from "@luan-pi/pi-annotations";

const parsed = parseEnvelope(messageText);
const readable = parsed ? projectEnvelope(messageText) : messageText;
```

## Wire format

When a prompt contains drafts, the editor submits this shape (with the real
JSON array in place of the example):

```text
# Response annotations:
Each item contains text selected from an earlier response and may include a user comment.
<response-annotations>
[
  { "text": "selected text", "annotation": "comment" }
]
</response-annotations>

## My request:
ordinary prompt text
```

Reactions are serialized as ordinary annotation text. Older envelopes that
used the previous `Reaction: “…”` spelling are still read when Pi redraws a
session.

## Troubleshooting and limits

- The comment and react keys do nothing unless a selection is active in copy
  mode; the action bar only appears next to a completed selection.
- "Configure at least one annotation reaction first" means the `reactions`
  list is empty.
- A selection without a stable message ID gets a best-effort screen anchor. A
  unique match in earlier assistant text upgrades it to a stable source
  offset.
- The package installs its custom editor only when no other custom editor is
  already configured, and it requires an interactive TUI session.

## Layout

| Responsibility | File |
| --- | --- |
| Extension wiring (hooks, decorators, editor install) | `src/extension.ts` |
| Public exports | `src/index.ts` |
| Reaction settings | `src/config/settings.ts` |
| Developer-prompt / system-prompt guidance | `src/contributions/developer-prompt.ts` |
| Envelope serialize/parse/project | `src/core/envelope.ts` |
| `:pi-annotation` directive projection | `src/core/directives.ts` |
| Draft store and editor tokens | `src/core/store.ts` |
| Pill text and transcript presentation | `src/core/pills.ts`, `src/core/presentation.ts` |
| Selection resolution, compose and edit flows | `src/runtime/annotations.ts` |
| Comment and reaction dialogs | `src/ui/composer-overlays.ts` |
| Custom editor with draft pills | `src/ui/editor.ts` |
| Transcript handles, reference pills, markers | `src/ui/screen-markers.ts`, `src/ui/reference-pills.ts`, `src/ui/annotation-markers.ts` |

## Develop

Source: https://github.com/luan/agents, directory
harnesses/pi/agent/packages/pi-annotations. Run `bun run typecheck` and
`bun test test` in that directory.
