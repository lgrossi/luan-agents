# @luan-pi/pi-side-panel

`@luan-pi/pi-side-panel` is a generic side-panel host for Pi's TUI. It mounts
a right-hand split pane and lets other Pi extensions contribute tabs to it.
The host owns the split layout, focus, pointer resizing, persisted width and
tab order, draggable pill tabs, the empty state, and the top-right show and
zoom controls. It contains no feature content of its own: with nothing else
installed the panel is empty. Tabs come from other packages, for example
`@luan-pi/pi-side-chat`, `@luan-pi/pi-tuicr`, `@luan-pi/pi-exec-command`,
`@luan-pi/pi-subagents`, and `@luan-pi/pi-xsettings`.

## Install

```sh
pi install npm:@luan-pi/pi-side-panel
```

The package ships its internal dependencies bundled and also loads the shared
`pi-libtui` extension entry so the registries it relies on exist. It runs only
in interactive TUI sessions; it does nothing in print mode, without a UI, or in
a child process started with `PI_EMBEDDED_SIDE_CHAT=1`.

Optional companion: `pi install npm:@luan-pi/pi-xsettings` provides a
shortcut host that binds the keys in your `keybindings.json` globally; without
it, the panel's shortcuts only work while the panel itself has focus, and the
panel is opened by contributed tabs or the top-right controls.

## Use it

The panel appears when a provider adds a tab, or when you run the toggle
action. The first mount takes 50% of the terminal width; dragging the divider
persists the new width. Clicking a tab activates it, dragging reorders it, and
closing the last tab hides the panel until it is reopened. Two icons in the
top-right corner of the screen toggle visibility and expand or restore the
panel; the expand icon is shown only while the panel is visible. Resizing the
divider while expanded returns the panel to its normal width.

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

None of these actions has a default key. Bindings live in `keybindings.json`
in Pi's agent directory (normally `~/.pi/agent/keybindings.json`). The file is
a JSON object; each property name is an action ID and each value is a key ID
string or an array of key ID strings. The file is read when extensions load,
so reload after editing. An example that binds every action group:

```json
{
  "side-panel.toggle": "ctrl+shift+b",
  "side-panel.zoom": "alt+shift+z",
  "side-panel.focus.next": "alt+o",
  "side-panel.tab.previous": "alt+h",
  "side-panel.tab.next": "alt+l"
}
```

While panel content has focus, the host checks the pressed key against the
bindings for `side-panel.toggle`, `side-panel.zoom`, `side-panel.focus.next`,
`side-panel.tab.previous`, and `side-panel.tab.next`, then for contributed
empty-state actions, then for the active tab's `inputActions`, before
forwarding the key to the tab's component. A matching shortcut runs the action
and is not passed on, so an embedded TUI cannot receive it. Header and
empty-state buttons show the bound shortcut when one exists. Errors thrown by
an action are reported as a notification.

## Contribute a tab

Providers register through `@luan-pi/pi-libtui`, not through this package, so
a contributor has no dependency on `pi-side-panel` and must keep working when
no host is installed. The contract is exported from `@luan-pi/pi-libtui`:

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
provider is replaced, unregistered, or the session detaches. Registering a
provider with an ID that is already registered replaces it. When no host is
installed, `attach` is never called, so a provider that needs a fallback
should check `ensureSidePanelRegistry(globalThis).hasHost()` and, for
example, open a fullscreen overlay instead. Errors thrown by `attach` are
reported through `context.ui.notify` and do not break the host.

A `SidePanelTab` has `id`, `label`, an optional `icon`, an optional
`headerAction` (`{ label, actionId }`, shown as a dropdown button at the right
of the tab bar), optional `inputActions` (action IDs whose shortcuts the host
intercepts while this tab is focused), `create(host, theme)`, and an optional
`onClose` called when the user closes the tab. `addTab` accepts
`{ activate, focus }` options; by default it activates the new tab, reveals the
panel, and focuses it. The `SidePanelSession` also offers `restoreTab` (re-adds
a tab without revealing the panel or persisting state), `updateTab`,
`removeTab`, `activate`, `activeTabId`, `registerEmptyAction` (a labelled
button shown when no tabs exist, returning a disposer), `show`, `toggle`,
`toggleZoom`, `focus`, `focusMain`, `focusNext`, `activatePrevious`,
`activateNext`, `isVisible`, `isZoomed`, and `requestRender`.

## Settings

The package has no settings and does not use `pi-xsettings`. Layout is
persisted per session as a custom session entry of type
`side-panel:layout-v1` holding `visible`, `width`, `order`, and
`activeTabId`; the most recent valid entry on the current branch is restored
on session start. Persisted state does not include tab contents, so
providers must re-add their tabs (usually with `restoreTab`).

## Layout

| Responsibility | Owner |
| --- | --- |
| Contribution protocol, registry, content types | `@luan-pi/pi-libtui` (`side-panel.ts`) |
| Pi registration, host install, top-right controls | `src/extension.ts` |
| Panel lifecycle, tab bookkeeping, split-pane mount, zoom | `src/controller.ts` |
| Persisted layout state and its parser | `src/state.ts` |
| Tab bar, header action, empty state, input routing | `src/view.ts` |
| Action registration | `src/actions.ts` |

## Develop

Source: https://github.com/luan/agents, directory
harnesses/pi/agent/packages/pi-side-panel. Run `bun run typecheck` and
`bun test test` in that directory.
