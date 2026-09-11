# @luan-pi/pi-libtui

Shared terminal UI for Pi extensions: layouts, split panes, dialogs, pickers,
selection actions, semantic colors, icons, cursors, syntax highlighting,
animated tool surfaces, streamed output, diffs, terminal projection, and the
protocols those pieces need. The primary audience is extension authors.

The package has two surfaces. `import "@luan-pi/pi-libtui"` is a
side-effect-free library: it does not start Pi, probe the terminal, register a
tool, or install UI. `src/extension.ts` is a Pi extension (listed in the
package's `pi.extensions`) that installs the generic mouse, cursor, and
editor-token bridges, keeps the shared native PTY host alive, measures terminal
colors, applies the `harmonious` theme fallback, drives Pi's streaming status
row, and registers the `/libtui:colors` 256-color palette diagnostic. It
registers no model-facing tools, keybindings, or feature-specific UI.

## Preview

The native palette diagnostic and shared picker components in Xsettings.

![pi-libtui in Bootty](https://github.com/luan/agents/releases/download/v0.2.2/pi-libtui.png)

[Watch the demo](https://github.com/luan/agents/releases/download/v0.2.2/pi-libtui.mp4).

## Install

```sh
pi install npm:@luan-pi/pi-libtui
```

This loads the host extension and the `harmonious` theme on its own. Feature
packages normally bundle their own copy instead: add `@luan-pi/pi-libtui` to
both `dependencies` and `bundledDependencies` in `package.json`, and list
`"./node_modules/@luan-pi/pi-libtui/src/extension.ts"` in the package's
`pi.extensions` so the mouse/cursor bridge is active. The host claims itself
once per process, so several installed copies do not conflict.

Optional companion: `pi install npm:@luan-pi/pi-xsettings` adds the `/xsettings`
UI that publishes the appearance settings below; without it the compiled
defaults apply.

## Themes

The manifest exposes `themes/harmonious.json`, which relies on the terminal's
indexed palette. If `harmonious` is active and the measured terminal reports
neither a generated 256-color palette nor an ANSI base-16 palette, the host
switches to Pi's built-in theme for the detected light or dark scheme (dark if
the measurement fails).

## Public modules

Every entry point is a side-effect-free import. "Host required" means the
Pi-native behaviour also needs the extension loaded.

| Import path | Principal exports / capability | Host required |
| --- | --- | --- |
| `@luan-pi/pi-libtui` | Layouts, split panes, side-panel protocol, dialogs, pickers, inputs, selection actions, semantic colors, icons, cursors, `PtyProcess`, `PtyPane`, `applyScrollbar`, `PointerInteractionController`, `RenderedLinesCache`, `SyntaxText`, motion/progress, appearance (`getTuiAppearance`, `configureTuiAppearance`, `subscribeTuiAppearance`), `ensureNativeBinary` | Rendering no; panes, PTYs, and bridges yes |
| `@luan-pi/pi-libtui/diff` | `createUnifiedDiffModel`, `parseUnifiedDiff`, `renderUnifiedDiff`, `UnifiedDiffView`, bounded diff models/viewports | No |
| `@luan-pi/pi-libtui/editor` | `ensureEditorRegistry`, `dispatchEditorPaste`, `dispatchEditorRender`, `SemanticEditor`, `semanticEditorTheme`, editor registry contracts | Only to connect the registry to Pi's editor |
| `@luan-pi/pi-libtui/folding` | `ensureFoldingRegistry`, `foldTargetAt`, `clearFoldingCurrent`, fold-target contracts | Only for copy-mode keyboard integration |
| `@luan-pi/pi-libtui/mouse` | `ensureMouseRegistry`, `registerModalPointerShield`, viewport handlers, pointer contracts, `getFullscreenLayoutCapability`, `publishFullscreenLayoutCapability`, `resolveFullscreenLayout` | Yes for terminal pointer events and layout geometry |
| `@luan-pi/pi-libtui/selection` | `ensureSelectionRegistry`, native selection geometry, completion events, action contracts | Yes for Pi-native selection events |
| `@luan-pi/pi-libtui/stream` | `BoundedStreamBuffer`, bounded UTF-8/ANSI-safe stream snapshots | No |
| `@luan-pi/pi-libtui/terminal` | `TerminalProjection`, incremental `TerminalOutput` for bounded PTY/ANSI projection | No |
| `@luan-pi/pi-libtui/tool` | `ToolAction`, `LiveToolAction`, `ToolDisclosureAction`, `ToolActivity`, `ToolOutput`, `ToolTranscript`, `ToolViewRegion`, tool-call preview helpers | No for rendering |

The `ensure*Registry` functions create or reuse a process-global capability
keyed by `Symbol.for`, so feature packages and the host share one instance.
Tool presentation has three layers: `ToolTranscript` (copy-friendly action plus
payload), `ToolActivity` (streaming, diff, terminal, and viewport state for a
live surface), and `ToolOutput` for text streams. `mountTranscriptProjection`
exposes native transcript entries to a feature-owned component through a
guarded Pi 0.84–0.85 adapter; unsupported hosts keep their native transcript.

## Native binaries

Feature packages shell out to Rust binaries such as `terminal_bridge` (the
exported `TERMINAL_BRIDGE` descriptor). Requires a Rust toolchain
(https://rustup.rs). The `terminal_bridge` binary builds itself on first use
under Pi's agent directory (`native/terminal-bridge/v<version>/`), where
`<version>` is this package's version. Set `PI_TERMINAL_BRIDGE_BINARY` to use
a prebuilt binary; it must point at an executable file.

`ensureNativeBinary(binary, hooks?)` resolves in this order: the descriptor's
env override, then `<agentDir>/native/<crate>/v<version>/bin/<name>`, building
it on first use when absent. Builds are keyed by crate and version, so every
installed copy shares them, and concurrent requests within one process share
one build. Pass `onBuild` to show the delay in the UI. The extension host keeps
the shared PTY host alive across an extension reload; a session switch or quit
shuts it down.

## Fullscreen split panes

`mountSplitPane()` composes one extension-owned pane beside Pi's complete
fullscreen layout. Pi's transcript, editor, widgets, status, and footer stay in
the main pane and reflow to its width. The highest-priority contribution is
visible, with the latest mount breaking ties; disposing it restores the
previous contribution or Pi's unwrapped layout.

```ts
const unmount = mountSplitPane({
	id: "example.details",
	position: "right",
	size: 32,
	initialRatio: 0.4,
	minMainSize: 1,
	priority: 10,
	onResize: (size) => saveCommittedWidth(size),
	component: (host, theme) => new DetailsPane(host, theme),
});
```

A draggable vertical border separates the pane from the main surface; Pi keeps
only `minMainSize`. `initialRatio` derives the first width when none is
restored, and `onResize` runs once when a drag commits. The pane hides when the
terminal cannot fit one pane cell, the border and gap, and the minimum main
size. The factory receives the active `tui`, viewport size, render requests,
and `focus()`, `blur()`, `isFocused()`; clicking either pane focuses it without
consuming the click. Split panes exist only in fullscreen mode. Pi 0.84.x has
`setLayoutRoot()` but no getter, so the host validates one private field
through a ref-counted prototype lease and leaves the layout unchanged if the
shape is absent.

## Appearance settings

This package has no settings store of its own. It exposes an appearance
registry with compiled defaults (`DEFAULT_TUI_APPEARANCE`) that a settings host
such as `@luan-pi/pi-xsettings` overrides through `configureTuiAppearance()`;
with pi-xsettings installed they are edited live via `/xsettings`. Keys and
defaults:

| Key | Default | Values |
| --- | --- | --- |
| `iconPack` | `unicode` | `unicode`, `nerd-fonts`, `emoji` |
| `activityIndicator` | `spinner` | `off`, `spinner`, `static`, and the Unicode/ASCII/Braille/Nerd Font animations in `TUI_ACTIVITY_INDICATOR_OPTIONS` |
| `activityMessage` | `phase` | `phase`, `typewriter` |
| `textEffect` | `off` | `off`, `sweep`, `glow`, `rainbow`, `rainbow-glow`, `lightning`, `aurora`, `glitch`, `crush` |
| `textEffectScope` | `message` | message only or the whole indicator, separator, and message unit |
| `pulseEffect` | `off` | dim-to-bright or contrasting-color pulse over any indicator/text effect |
| `statusPresentation` | `standard` | `standard`, mixed compositions such as `brainstorm`, or exclusive scenes in `TUI_STATUS_PRESENTATION_OPTIONS` |
| `animationSpeed` | `normal` | `slow`, `relaxed`, `normal`, `fast`, `very-fast` |
| `animationSmoothness` | `balanced` | `economy`, `balanced`, `smooth`, `ultra` (roughly 13 to 60 redraws per second) |
| `thinking*`, `working*`, `tool*` (`Indicator`, `Message`, `TextEffect`, `PulseEffect`, `Presentation`) | `inherit` | per-phase overrides of the general value |
| `powerline`, `powerlineButtons`, `softCursor` | `false` | Powerline separators, button caps, softer virtual cursor |
| `insertionCursor`, `navigationCursor`, `selectionCursor` | `virtual` | cursor styles |

Inline activity is composed as `indicator + message`, then the effect scope is
painted; an exclusive scene replaces that composition. The extension applies
the same renderer to Pi's streaming status row: Thinking takes priority over
Tool, which takes priority over Working. Feature surfaces may pass
`ActivityAnimationOverrides` to `activityFrame()` and
`mountConfiguredAnimation()`; omitted fields inherit the live appearance.

## Architecture

| Responsibility | Owner |
| --- | --- |
| Tool definition | None; the package adds no model-facing tool |
| Execution | None in the library; `src/extension.ts` owns host setup |
| State | Components own local state; `MouseBridgeHost` owns bridge state; `RequestAnimationController` owns request phase state |
| Shared contracts | `src/editor/protocol.ts` (via `src/editor.ts`), `src/folding.ts`, `src/selection.ts`, `src/decoration/pointer-interaction.ts`, the public contracts selected by `src/mouse.ts` |
| Native boundary | Mouse/cursor compatibility, terminal color queries, PTY host, host bridges in `src/host/` |

The host knows only generic TUI mechanics; feature labels, settings, actions,
and workflows stay in their owning packages. Color resolution has one path:
`src/color/theme.ts` owns the semantic-token table and resolves every paint
through `src/color/resolver.ts`. Feature code uses only the root color API:
`tuiTheme(theme)`, `createTuiThemeVariation(theme, name)`,
`tuiThemeAppearance(theme)`, `TuiForegroundToken`/`TuiBackgroundToken`,
`TuiSwatch` (seven ramps at shades `0`–`5`), opaque `TuiColor` handles, and
`TuiTheme.mixForeground()`.

## Layout

| Responsibility | Source |
| --- | --- |
| Extension entry and host | `src/extension.ts`, `src/host/` |
| Layout and rendering infrastructure | `src/background-surface.ts`, `src/component-stack.ts`, `src/line-layout.ts`, `src/render-cache.ts`, `src/scrollbar.ts` |
| Split panes and side panel | `src/split-pane.ts`, `src/host/split-pane-bridge.ts`, `src/side-panel.ts` |
| Overlays | `src/overlay/` |
| Controls | `src/controls/` |
| Text content, glyphs, status, pills, editor | `src/content/`, `src/decoration/`, `src/editor.ts`, `src/editor/` |
| Appearance, motion, request animation | `src/appearance.ts`, `src/motion.ts`, `src/request-animation.ts` |
| Colors and syntax | `src/color/`, `src/terminal-colors.ts`, `src/syntax.ts` |
| Streams, terminal projection, PTY host, diffs, tools | `src/stream.ts`, `src/terminal/`, `src/diff/`, `src/tool/` |
| Native binary discovery and first-use builds | `src/native-binary.ts` |

## Troubleshooting

- A feature renders but clicks do nothing: the host extension is not loaded.
  Install `@luan-pi/pi-libtui` as a Pi package or list its `src/extension.ts`
  in the feature package's `pi.extensions`.
- Nerd Font or Powerline glyphs are missing: set the icon pack to `unicode` and
  disable Powerline in `/xsettings`. Those are also the compiled defaults.
- `cargo was not found`: install Rust from https://rustup.rs, or set the
  binary's env override to a prebuilt executable.

## Develop

Source: https://github.com/luan/agents, directory
harnesses/pi/agent/packages/pi-libtui. Run `bun run typecheck` and
`bun test test` in that directory. When running from that checkout,
`ensureNativeBinary` also looks for `target/{release,debug}/<name>` in the Cargo
workspace and reports an unbuilt checkout instead of building; builds are pinned
to the `v<version>` git tag, so publishing requires a matching tag.
