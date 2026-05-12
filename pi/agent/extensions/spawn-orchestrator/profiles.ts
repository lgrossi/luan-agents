import type { AgentProfile, ProfileName } from "./types.ts";

const READ_ONLY_TOOLS = ["read", "grep", "find", "ls"];

export const DEFAULT_PROFILES: Record<ProfileName, AgentProfile> = {
	orchestrator: {
		name: "orchestrator",
		description: "Plan, schedule, monitor, and synthesize Spawn pipelines.",
		promptMode: "replace",
		contextPolicy: "summary",
		tools: ["orchestrate", "lane_status", "lane_result"],
		modelTier: "balanced",
		editPolicy: "none",
		requiresWorktree: false,
		canSpawn: true,
	},
	research: {
		name: "research",
		description: "Read-only exploration and fact gathering.",
		promptMode: "replace",
		contextPolicy: "explicit",
		tools: READ_ONLY_TOOLS,
		modelTier: "cheap",
		editPolicy: "none",
		requiresWorktree: false,
		canSpawn: false,
	},
	product: {
		name: "product",
		description: "Product direction, scope, and tradeoff analysis.",
		promptMode: "replace",
		contextPolicy: "explicit",
		tools: ["read", "grep", "find", "ls"],
		modelTier: "balanced",
		editPolicy: "none",
		requiresWorktree: false,
		canSpawn: false,
	},
	coding: {
		name: "coding",
		description: "Implementation in an isolated worktree.",
		promptMode: "replace",
		contextPolicy: "explicit",
		tools: ["read", "bash", "grep", "find", "ls", "edit", "write"],
		modelTier: "balanced",
		editPolicy: "worktree",
		requiresWorktree: true,
		canSpawn: false,
	},
	review: {
		name: "review",
		description: "Read-only adversarial review and verification.",
		promptMode: "replace",
		contextPolicy: "explicit",
		tools: READ_ONLY_TOOLS,
		modelTier: "balanced",
		editPolicy: "none",
		requiresWorktree: false,
		canSpawn: false,
	},
	shell: {
		name: "shell",
		description: "Human-inspectable shell or command lane.",
		promptMode: "replace",
		contextPolicy: "none",
		tools: [],
		modelTier: "cheap",
		editPolicy: "none",
		requiresWorktree: false,
		canSpawn: false,
	},
};

export function getProfile(name: ProfileName): AgentProfile {
	return DEFAULT_PROFILES[name];
}
