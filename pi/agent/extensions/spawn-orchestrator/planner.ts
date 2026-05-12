import { admitRun, applyAdmission, emptySchedulerSnapshot, getBudgetPolicy } from "./budget.ts";
import type {
	AdmissionDecision,
	BudgetPreset,
	EditPolicy,
	LaneBackend,
	PipelinePlan,
	PipelineStep,
	ProfileName,
	RequestAnalysis,
	RunRequest,
	SpawnMode,
} from "./types.ts";

export interface CompilePipelineOptions {
	mode?: SpawnMode;
	budget?: BudgetPreset;
	originId?: string;
	depth?: number;
	researchFanout?: number;
	interactive?: boolean;
}

export function analyzeRequest(request: string): RequestAnalysis {
	const normalized = request.toLowerCase();
	const needsEdits = /\b(implement|build|fix|change|edit|write|refactor|develop)\b/.test(normalized);
	const needsResearch = /\b(research|investigate|compare|explore|find|where|how|why|unknown)\b/.test(normalized);
	const highRisk = /\b(security|auth|payment|billing|migration|data loss|production|privacy)\b/.test(normalized);
	const requirements = extractListAfterHeading(request, /requirements?|must|needs?/i);
	const acceptanceCriteria = extractListAfterHeading(request, /acceptance|done|verify|criteria/i);
	const unknowns =
		request.includes("?") || /\bunknown|unclear|ambiguous|investigate\b/i.test(request)
			? ["Resolve open questions before write-capable work"]
			: [];
	const risks = [
		...(highRisk ? ["High-impact domain requires explicit verification"] : []),
		...(needsEdits ? ["Code edits must be isolated to write-capable pipeline steps"] : []),
	];
	const wordCount = request.trim().split(/\s+/).filter(Boolean).length;
	const complexity =
		highRisk || wordCount > 160 ? "high" : needsEdits || needsResearch || wordCount > 60 ? "medium" : "low";

	return {
		requirements: requirements.length ? requirements : [request.trim()],
		unknowns,
		risks,
		acceptanceCriteria: acceptanceCriteria.length
			? acceptanceCriteria
			: ["Pipeline criteria are verified or blocked with reasons"],
		complexity,
		needsEdits,
		needsResearch,
	};
}

export function compilePipeline(request: string, options: CompilePipelineOptions = {}): PipelinePlan {
	const budget = options.budget ?? "balanced";
	const originId = options.originId ?? `origin-${stableHash(request)}`;
	const mode = resolveMode(request, analyzeRequest(request), options.mode ?? "auto");
	const analysis = analyzeRequest(request);
	const steps = buildSteps(analysis, mode, options);
	const admissions = admitSteps(originId, steps, budget, options.depth ?? 0);
	return { originId, mode, analysis, budget, steps, admissions };
}

function resolveMode(request: string, analysis: RequestAnalysis, mode: SpawnMode): SpawnMode {
	if (mode !== "auto") return mode;
	const normalized = request.toLowerCase();
	if (/\b(handoff|continue in another lane|child lane)\b/.test(normalized)) return "handoff";
	if (/\b(side[- ]?spawn|side lane|parallel lane)\b/.test(normalized)) return "side-spawn";
	if (analysis.needsEdits || analysis.needsResearch || analysis.complexity !== "low") return "orchestrate";
	return "side-spawn";
}

function buildSteps(analysis: RequestAnalysis, mode: SpawnMode, options: CompilePipelineOptions): PipelineStep[] {
	if (mode === "side-spawn" || mode === "handoff") {
		return [
			step({
				id: "lane",
				title: mode === "handoff" ? "Open handoff lane" : "Open side-spawn lane",
				profile: "research",
				laneBackend: options.interactive ? "pi-session" : "headless",
				acceptance: analysis.acceptanceCriteria,
			}),
		];
	}

	const steps: PipelineStep[] = [];
	const fanout = Math.max(1, Math.min(options.researchFanout ?? (analysis.complexity === "high" ? 5 : 2), 8));
	if (analysis.needsResearch || analysis.unknowns.length > 0 || analysis.complexity !== "low") {
		for (let index = 0; index < fanout; index++) {
			steps.push(
				step({
					id: `research-${index + 1}`,
					title: `Parallel research ${index + 1}`,
					profile: "research",
					laneBackend: "headless",
					parallelGroup: "research",
					acceptance: ["Return concise findings, risks, and source/code references"],
				}),
			);
		}
		steps.push(
			step({
				id: "synthesis",
				title: "Synthesize requirements and plan",
				profile: "orchestrator",
				laneBackend: "headless",
				dependsOn: steps.map((item) => item.id),
				acceptance: ["Unknowns, risks, and acceptance criteria are explicit"],
			}),
		);
	}

	if (analysis.needsEdits) {
		steps.push(
			step({
				id: "implementation",
				title: "Implement scoped code changes",
				profile: "coding",
				laneBackend: "headless",
				editPolicy: "worktree",
				dependsOn: steps.length ? [steps[steps.length - 1]!.id] : [],
				acceptance: ["Code changes are isolated in a worktree and satisfy the plan"],
			}),
		);
	}

	steps.push(
		step({
			id: "verification",
			title: "Verify acceptance criteria",
			profile: "review",
			laneBackend: "headless",
			dependsOn: steps.length ? [steps[steps.length - 1]!.id] : [],
			acceptance: analysis.acceptanceCriteria,
		}),
	);
	return steps;
}

function admitSteps(originId: string, steps: PipelineStep[], budget: BudgetPreset, depth: number): AdmissionDecision[] {
	let snapshot = emptySchedulerSnapshot();
	const policy = getBudgetPolicy(budget);
	const decisions: AdmissionDecision[] = [];
	for (const item of steps) {
		const request: RunRequest = {
			originId,
			stepId: item.id,
			kind: "step",
			profile: item.profile,
			intent: item.title,
			depth,
			laneBackend: item.laneBackend,
			editPolicy: item.editPolicy,
			isolation: item.editPolicy === "worktree" ? "worktree" : undefined,
			estimatedTokens:
				item.profile === "coding"
					? policy.defaultRunBudget.maxTokens
					: Math.floor(policy.defaultRunBudget.maxTokens / 2),
		};
		const decision = admitRun(request, policy, snapshot);
		decisions.push(decision);
		snapshot = applyAdmission(snapshot, decision);
	}
	return decisions;
}

function step(input: {
	id: string;
	title: string;
	profile: ProfileName;
	laneBackend: LaneBackend;
	editPolicy?: EditPolicy;
	parallelGroup?: string;
	dependsOn?: string[];
	acceptance: string[];
}): PipelineStep {
	return {
		id: input.id,
		title: input.title,
		profile: input.profile,
		laneBackend: input.laneBackend,
		editPolicy: input.editPolicy ?? "none",
		parallelGroup: input.parallelGroup,
		dependsOn: input.dependsOn ?? [],
		acceptance: input.acceptance,
	};
}

function extractListAfterHeading(text: string, heading: RegExp): string[] {
	const lines = text.split("\n");
	const out: string[] = [];
	let active = false;
	for (const line of lines) {
		if (heading.test(line)) {
			active = true;
			continue;
		}
		if (!active) continue;
		if (/^\s*$/.test(line)) break;
		const item = line.replace(/^\s*[-*]\s*/, "").trim();
		if (item) out.push(item);
	}
	return out.slice(0, 8);
}

function stableHash(input: string): string {
	let hash = 5381;
	for (const char of input) hash = (hash * 33) ^ char.charCodeAt(0);
	return (hash >>> 0).toString(36);
}
