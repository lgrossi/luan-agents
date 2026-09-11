import { registerAction } from "@luan.sh/pi-libactions/sdk";
import type { SidePanelSession } from "@luan.sh/pi-libtui";

export function registerSidePanelActions(panel: SidePanelSession): () => void {
	const disposers = [
		registerAction({ id: "panels.toggle", description: "Show or hide the side panel", run: () => panel.toggle() }),
		registerAction({
			id: "panels.main.focus",
			description: "Focus the main session",
			run: () => panel.focusMain(),
		}),
		registerAction({ id: "panels.focus", description: "Focus the side panel", run: () => panel.focus() }),
		registerAction({
			id: "panels.focus.next",
			description: "Move focus to the other split pane",
			run: () => panel.focusNext(),
		}),
		registerAction({
			id: "panels.zoom",
			description: "Expand or restore the side panel",
			run: () => panel.toggleZoom(),
		}),
		registerAction({
			id: "panels.tab.previous",
			description: "Select the previous side-panel tab",
			run: () => panel.activatePrevious(),
		}),
		registerAction({
			id: "panels.tab.next",
			description: "Select the next side-panel tab",
			run: () => panel.activateNext(),
		}),
	];
	return () => {
		for (const dispose of disposers) dispose();
	};
}
