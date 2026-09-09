import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { SubagentCoordinator, SubagentSnapshot } from "../runtime/coordinator.ts";

export interface CollaborationToolScope {
	readonly pi: ExtensionAPI;
	coordinator(): SubagentCoordinator;
	callerPath(): string | undefined;
	otherLiveAgents(): readonly SubagentSnapshot[];
}
