export type RunStatus = "queued" | "running" | "completed" | "blocked" | "failed" | "needs-follow-up" | "stopped";
export type RunKind = "orchestration" | "lane" | "agent" | "step" | "shell" | "command";
export type LaneBackend = "headless" | "pi-session" | "pane" | "command";
export type BudgetPreset = "cheap" | "balanced" | "fast" | "premium";
export type ModelTier = "cheap" | "balanced" | "premium";
export type SpawnMode = "auto" | "side-spawn" | "handoff" | "orchestrate";
export type ProfileName = "orchestrator" | "research" | "product" | "coding" | "review" | "shell";
export type ContextPolicy = "none" | "summary" | "explicit" | "inherit";
export type PromptMode = "replace" | "append";
export type EditPolicy = "none" | "worktree" | "current-worktree";
export type PromptVisibility = "metadata" | "summary" | "full";

export interface AgentProfile {
	name: ProfileName;
	description: string;
	promptMode: PromptMode;
	contextPolicy: ContextPolicy;
	tools: string[];
	modelTier: ModelTier;
	editPolicy: EditPolicy;
	requiresWorktree: boolean;
	canSpawn: boolean;
}

export interface RunBudget {
	preset: BudgetPreset;
	modelTier: ModelTier;
	maxTokens: number;
	maxTools: number;
	maxTurns: number;
	maxRuntimeMs: number;
}

export interface BudgetPolicy {
	preset: BudgetPreset;
	maxConcurrent: number;
	maxQueued: number;
	maxDepth: number;
	maxTotalTokens: number;
	defaultRunBudget: Omit<RunBudget, "preset" | "modelTier">;
	allowedModelTiers: ModelTier[];
	allowDowngrade: boolean;
}

export interface SchedulerSnapshot {
	running: number;
	queued: number;
	reservedTokens: number;
	usedTokens: number;
}

export interface RunRequest {
	originId: string;
	parentRunId?: string;
	stepId?: string;
	kind: RunKind;
	profile: ProfileName;
	intent: string;
	depth: number;
	laneBackend: LaneBackend;
	modelTier?: ModelTier;
	estimatedTokens?: number;
	editPolicy?: EditPolicy;
	isolation?: "worktree";
	promptVisibility?: PromptVisibility;
}

export interface AdmittedRun {
	request: RunRequest;
	budget: RunBudget;
	reservedTokens: number;
	queueReason?: string;
	warnings: string[];
}

export type AdmissionDecision =
	| { action: "start"; run: AdmittedRun }
	| { action: "queue"; run: AdmittedRun }
	| { action: "ask"; reason: string; request: RunRequest }
	| { action: "reject"; reason: string; request: RunRequest };

export interface RunMetrics {
	estimatedTokens?: number;
	inputTokens?: number;
	outputTokens?: number;
	cacheWriteTokens?: number;
	toolUses?: number;
	turns?: number;
	durationMs?: number;
}

export interface LaneRef {
	backend: LaneBackend;
	jumpable: boolean;
	promotable: boolean;
	sessionPath?: string;
	paneId?: string;
	windowId?: string;
	worktreePath?: string;
}

export type AcceptanceStatus = "pending" | "met" | "blocked" | "failed" | "needs-follow-up";

export interface AcceptanceState {
	criteria: string[];
	status: AcceptanceStatus;
	evidence: string[];
	followUps: string[];
}

export interface RunRecord {
	id: string;
	originId: string;
	parentRunId?: string;
	stepId?: string;
	kind: RunKind;
	profile: ProfileName;
	intent: string;
	status: RunStatus;
	depth: number;
	budgetPreset: BudgetPreset;
	modelTier: ModelTier;
	editPolicy: EditPolicy;
	contextPolicy: ContextPolicy;
	promptVisibility: PromptVisibility;
	lane: LaneRef;
	metrics: RunMetrics;
	acceptance: AcceptanceState;
	artifacts: string[];
	errors: string[];
	createdAt: number;
	updatedAt: number;
	startedAt?: number;
	completedAt?: number;
	summary?: string;
}

export interface TraceEvent {
	id: string;
	runId: string;
	originId: string;
	type:
		| "created"
		| "admitted"
		| "started"
		| "completed"
		| "blocked"
		| "failed"
		| "needs-follow-up"
		| "stopped"
		| "promoted"
		| "artifact";
	message: string;
	timestamp: number;
}

export interface RequestAnalysis {
	requirements: string[];
	unknowns: string[];
	risks: string[];
	acceptanceCriteria: string[];
	complexity: "low" | "medium" | "high";
	needsEdits: boolean;
	needsResearch: boolean;
}

export interface PipelineStep {
	id: string;
	title: string;
	profile: ProfileName;
	laneBackend: LaneBackend;
	editPolicy: EditPolicy;
	parallelGroup?: string;
	acceptance: string[];
	dependsOn: string[];
}

export interface PipelinePlan {
	originId: string;
	mode: SpawnMode;
	analysis: RequestAnalysis;
	budget: BudgetPreset;
	steps: PipelineStep[];
	admissions: AdmissionDecision[];
}
