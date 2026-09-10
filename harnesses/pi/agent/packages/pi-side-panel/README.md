# pi-side-panel

`pi-side-panel` is a generic side-panel host for Pi's TUI. It mounts a
right-hand split pane and lets other extensions contribute tabs to it. The
host owns the split layout, focus, pointer resizing, persisted width and tab
order, draggable pill tabs, the empty state, and the top-right show and zoom
controls. It contains no feature content of its own: side chat, review,
settings, and process views come from other packages.

## Install

```sh
pi install npm:@luan-pi/pi-side-panel
```

From a checkout of this repository:

```sh
pi install ./harnesses/pi/agent/packages/pi-side-panel
```

The package bundles `pi-libtui` and `pi-libactions` and also loads the
`pi-libtui` extension entry so the shared registries exist. It runs only in
interactive TUI sessions; it does nothing in print mode, without a UI, or in a
child process started with `PI_EMBEDDED_SIDE_CHAT=1`.

## Use it

The panel appears when a provider adds a tab, or when you run the toggle
action. The first mount takes 50% of the terminal width; dragging the divider
persists the new width. Clicking a tab activates it, dragging reorders it, and
closing the last tab hides the panel until it is reopened. Two icons in the
top-right corner of the screen toggle visibility and expand or restore the
panel.

The extension registers these actions through `pi-libactions`. It adds no
slash commands.

| Action | Effect |
| --- | --- |
| `side-panel.toggle` | Show or hide the side panel |
| `side-panel.focus` | Focus the side panel (showing it first if needed) |
| `side-panel.main.focus` | Focus the main session |
| `side-panel.focus.next` | Move focus to the other split pane |
| `side-panel.zoom` | Expand the panel to the full width, or restore it |
| `side-panel.tab.previous` | Select the previous tab |
| `side-panel.tab.next` | Select the next tab |

## Keybindings

The package does not register default shortcuts. Actions are bound in the
managed `keybindings.json` read by `pi-libactions`; add entries there keyed by
action ID. This repository's `harnesses/pi/agent/keybindings.json` binds, for
example, `side-panel.toggle` to `ctrl+shift+b`, `side-panel.focus.next` to
`alt+o`, `side-panel.tab.previous`/`side-panel.tab.next` to `alt+h`/`alt+l`,
and `side-panel.zoom` to `alt+shift+z`. Copy what you want into your own file.

While panel content has focus, the host checks the pressed key against the
bindings for its own actions, then for contributed empty-state actions, then
for the active tab's `inputActions`, before forwarding the key to the tab's
component. A matching shortcut runs the action and is not passed on, so an
embedded TUI cannot receive it. Header and empty-state buttons show the bound
shortcut when one exists.

## Contribute a tab

Providers register through `pi-libtui`, not through this package, so a
contributor has no dependency on `pi-side-panel` and must keep working when
no host is installed. The contract lives in `pi-libtui/src/side-panel.ts`:

```ts
import { registerSidePanelProvider, type SidePanelSession } from "@luan-pi/pi-libtui";

const dispose = registerSidePanelProvider(
	{
		id: "my-extension",
		session: context.sessionManager,
		attach(panel: SidePanelSession) {
			panel.addTab({
				id: "my-tab",
				label: "My tab",
				create: (host, theme) => new MyComponent(host, theme),
				onClose: () => cleanUp(),
			});
			return () => panel.removeTab("my-tab");
		},
	},
	globalThis,
);
```

`registerSidePanelProvider` stores the provider in a process-wide registry
keyed by `Symbol.for("pi-side-panel/registry/v1")`. When this host is present
it calls `attach` with a `SidePanelSession`, but only for providers whose
`session` matches the current Pi session; the returned function runs when the
provider is replaced, unregistered, or the session detaches. When no host is
installed, `attach` is never called, so a provider that needs a fallback
should check `ensureSidePanelRegistry(globalThis).hasHost()` and, for
example, open a fullscreen overlay instead. Errors thrown by `attach` are
reported through `context.ui.notify` and do not break the host.

A `SidePanelTab` has `id`, `label`, an optional `icon`, an optional
`headerAction` (`{ label, actionId }`, shown as a dropdown button at the right
of the tab bar), optional `inputActions` (action IDs whose shortcuts the host
intercepts while this tab is focused), `create(host, theme)`, and `onClose`.
The `SidePanelSession` also offers `restoreTab` (re-adds a tab without
revealing the panel or persisting state), `updateTab`, `activate`,
`registerEmptyAction` (a labelled button shown when no tabs exist), `show`,
`toggle`, `toggleZoom`, focus helpers, and `requestRender`.

## Settings

The package has no settings. It does not use `pi-xsettings`. Layout is
persisted per session as a custom session entry of type
`side-panel:layout-v1` holding `visible`, `width`, `order`, and
`activeTabId`; the most recent valid entry on the current branch is restored
on session start. Persisted state does not include tab contents, so
providers must re-add their tabs (usually with `restoreTab`).

## Layout

| Responsibility | Owner |
| --- | --- |
| Contribution protocol, registry, content types | `pi-libtui/src/side-panel.ts` |
| Pi registration, host install, top-right controls | `src/extension.ts` |
| Panel lifecycle, tab bookkeeping, split-pane mount, zoom | `src/controller.ts` |
| Persisted layout state and its parser | `src/state.ts` |
| Tab bar, header action, empty state, input routing | `src/view.ts` |
| Action registration | `src/actions.ts` |

## Develop

```sh
cd harnesses/pi/agent/packages/pi-side-panel
bun run typecheck
bun test test
```
