import type { ThinkingLevel } from "@earendil-works/pi-agent-core";

export interface AgentModelReference {
	provider: string;
	id: string;
}

/** Child-specific model and thinking-level choices. */
export interface AgentConfig {
	model?: AgentModelReference;
	thinkingLevel?: ThinkingLevel;
}
