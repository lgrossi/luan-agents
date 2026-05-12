import { getProfile } from "./profiles.ts";
import type {
	AdmissionDecision,
	AdmittedRun,
	BudgetPolicy,
	BudgetPreset,
	ModelTier,
	RunBudget,
	RunRequest,
	SchedulerSnapshot,
} from "./types.ts";

const TIER_ORDER: ModelTier[] = ["cheap", "balanced", "premium"];

export const DEFAULT_BUDGET_POLICIES: Record<BudgetPreset, BudgetPolicy> = {
	cheap: {
		preset: "cheap",
		maxConcurrent: 1,
		maxQueued: 4,
		maxDepth: 1,
		maxTotalTokens: 60_000,
		defaultRunBudget: { maxTokens: 12_000, maxTools: 20, maxTurns: 4, maxRuntimeMs: 10 * 60_000 },
		allowedModelTiers: ["cheap"],
		allowDowngrade: true,
	},
	balanced: {
		preset: "balanced",
		maxConcurrent: 2,
		maxQueued: 8,
		maxDepth: 2,
		maxTotalTokens: 120_000,
		defaultRunBudget: { maxTokens: 20_000, maxTools: 40, maxTurns: 8, maxRuntimeMs: 20 * 60_000 },
		allowedModelTiers: ["cheap", "balanced"],
		allowDowngrade: true,
	},
	fast: {
		preset: "fast",
		maxConcurrent: 4,
		maxQueued: 8,
		maxDepth: 2,
		maxTotalTokens: 180_000,
		defaultRunBudget: { maxTokens: 24_000, maxTools: 50, maxTurns: 8, maxRuntimeMs: 15 * 60_000 },
		allowedModelTiers: ["cheap", "balanced"],
		allowDowngrade: true,
	},
	premium: {
		preset: "premium",
		maxConcurrent: 3,
		maxQueued: 10,
		maxDepth: 3,
		maxTotalTokens: 240_000,
		defaultRunBudget: { maxTokens: 40_000, maxTools: 80, maxTurns: 12, maxRuntimeMs: 30 * 60_000 },
		allowedModelTiers: ["cheap", "balanced", "premium"],
		allowDowngrade: false,
	},
};

export function getBudgetPolicy(preset: BudgetPreset = "balanced"): BudgetPolicy {
	return DEFAULT_BUDGET_POLICIES[preset];
}

export function emptySchedulerSnapshot(): SchedulerSnapshot {
	return { running: 0, queued: 0, reservedTokens: 0, usedTokens: 0 };
}

export function applyAdmission(snapshot: SchedulerSnapshot, decision: AdmissionDecision): SchedulerSnapshot {
	if (decision.action === "start") {
		return {
			...snapshot,
			running: snapshot.running + 1,
			reservedTokens: snapshot.reservedTokens + decision.run.reservedTokens,
		};
	}
	if (decision.action === "queue") {
		return {
			...snapshot,
			queued: snapshot.queued + 1,
			reservedTokens: snapshot.reservedTokens + decision.run.reservedTokens,
		};
	}
	return snapshot;
}

export function admitRun(
	request: RunRequest,
	policy: BudgetPolicy = getBudgetPolicy("balanced"),
	snapshot: SchedulerSnapshot = emptySchedulerSnapshot(),
): AdmissionDecision {
	if (request.depth > policy.maxDepth) {
		return { action: "reject", reason: `Depth ${request.depth} exceeds max depth ${policy.maxDepth}`, request };
	}

	const profile = getProfile(request.profile);
	const editPolicy = request.editPolicy ?? profile.editPolicy;
	if ((profile.requiresWorktree || editPolicy === "worktree") && request.isolation !== "worktree") {
		return { action: "reject", reason: "Write-capable runs require worktree isolation", request };
	}

	const warnings: string[] = [];
	const requestedTier = request.modelTier ?? profile.modelTier;
	const modelTier = resolveModelTier(requestedTier, policy);
	if (!modelTier) {
		return {
			action: "ask",
			reason: `Model tier ${requestedTier} is outside ${policy.preset} budget`,
			request,
		};
	}
	if (modelTier !== requestedTier) warnings.push(`Downgraded model tier from ${requestedTier} to ${modelTier}`);

	const budget: RunBudget = {
		preset: policy.preset,
		modelTier,
		...policy.defaultRunBudget,
	};
	const estimatedTokens = request.estimatedTokens ?? budget.maxTokens;
	if (estimatedTokens > budget.maxTokens) {
		return {
			action: "ask",
			reason: `Run estimate ${estimatedTokens} exceeds per-run cap ${budget.maxTokens}`,
			request,
		};
	}
	if (snapshot.usedTokens + snapshot.reservedTokens + estimatedTokens > policy.maxTotalTokens) {
		return {
			action: "reject",
			reason: `Total token budget ${policy.maxTotalTokens} would be exceeded`,
			request,
		};
	}

	const admitted: AdmittedRun = { request, budget, reservedTokens: estimatedTokens, warnings };
	if (snapshot.running < policy.maxConcurrent) return { action: "start", run: admitted };
	if (snapshot.queued < policy.maxQueued) {
		return {
			action: "queue",
			run: { ...admitted, queueReason: `Concurrency cap ${policy.maxConcurrent} reached` },
		};
	}
	return { action: "ask", reason: `Queue cap ${policy.maxQueued} reached`, request };
}

function resolveModelTier(requested: ModelTier, policy: BudgetPolicy): ModelTier | undefined {
	if (policy.allowedModelTiers.includes(requested)) return requested;
	if (!policy.allowDowngrade) return undefined;
	const requestedIndex = TIER_ORDER.indexOf(requested);
	return [...policy.allowedModelTiers]
		.sort((a, b) => TIER_ORDER.indexOf(b) - TIER_ORDER.indexOf(a))
		.find((tier) => TIER_ORDER.indexOf(tier) <= requestedIndex);
}
