import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { registerAction } from "@luan.sh/pi-libactions/sdk";

export function registerSubagentActions(actions: { open(ctx: ExtensionContext): void | Promise<void> }): () => void {
	return registerAction({ id: "subagents.open", description: "Open the Agent Hub", run: actions.open });
}
