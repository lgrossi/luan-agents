import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { registerAction } from "@luan-pi/pi-libactions/sdk";

export function registerCopyModeAction(run: (ctx: ExtensionContext) => void): () => void {
	return registerAction({ id: "copy-mode.enter", description: "Enter transcript copy mode", run });
}
