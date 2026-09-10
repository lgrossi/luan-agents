# pi-custom-editor

`pi-custom-editor` installs a real `CustomEditor` layer and replaces Pi's
built-in footer. It preserves Pi's native input rows, cursor, and autocomplete
output, then passes them through `pi-libtui`'s declarative editor composition
renderer with semantic surfaces, rules, independently configurable rails,
prompt-marker sequences, project/model metadata, status segments, context
usage, and the shared working animation.

## Install

```sh
pi install npm:@luan-pi/pi-custom-editor
```

From a checkout of this repository:

```sh
pi install ./harnesses/pi/agent/packages/pi-custom-editor
```

The package composes through Pi's `setEditorComponent` and `setFooter` APIs. The
editor is `PiCustomEditor`, which extends `pi-libtui`'s `SemanticEditor` and
therefore Pi's `CustomEditor`; pre-existing editor factories are decorated
instead of replaced. Its animation uses the shared `pi-libtui` motion scheduler
and follows live appearance settings. The built-in Pi working row is hidden
only when working activity is moved into the editor or explicitly hidden.

It also owns the optional, versioned `pi-custom-editor/highlights/v1`
capability. Highlight contributions match rendered editor text and request a
semantic foreground or destination-aware pill. One `pi-libtui/editor` render
decorator composes all contributions without adding another editor factory
layer. Built-in contributions render `@file` and `@directory` references as
subdued pills with filetype-aware Nerd Font icons; missing paths use the
negative tone. Known leading slash commands are positive and unknown leading
commands are negative. Inline and fenced Markdown code suppresses all
contributed highlights.

`/xsettings` exposes these live controls on the top-level **Editor** page:

- declarative Claude Code, Pi, Borderless, Top rule, Minimal field, Compact
  field, Full field, and Status band presets;
- transparent, base, editor, raised, inset, and accent-wash semantic surfaces;
- independent top treatment and bottom rule controls;
- off, static, or working-animated left and right rails;
- a compact set of static Unicode and Nerd Font prompt markers;
- preset or custom ordered segments for the top-left, top-right, bottom-left,
  and bottom-right quadrants;
- an independent bottom status row toggle; and
- status separator and band style.

Working activity defaults to Pi's native transcript row. It can instead be
hidden or placed at either end of any editor quadrant. Its indicator, message,
text effect, pulse, and presentation remain owned exclusively by the shared
**Animations → Working** settings. The editor acquires its animation target
from the editor mount itself, so animation does not depend on the footer
rendering first.

Explicit controls display `Preset` when they inherit the selected composition.
Every visual enum uses xsettings' production-rendered candidate preview; Enter
saves and Escape leaves the active value unchanged. Global animation speed,
smoothness, and reduced-motion behavior remain owned by `pi-libtui`.

## Architecture

| Responsibility | Owner |
| --- | --- |
| Tool definition | None; this package adds no model-facing tool |
| Execution owner | Pi lifecycle events |
| State owner | `src/runtime/state.ts` |
| Native boundary | Pi editor/footer APIs and git status |
| Presentation owner | `src/core/composition.ts`, `src/ui/pi-custom-editor.ts`, `src/ui/status.ts`, and `src/ui/footer.ts` |
| Public capabilities | `src/index.ts` timer helpers and the versioned editor-highlight registry |

Run `bun run typecheck` and `bun test test` from this package directory.
