import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { spawn as spawnLanePrimitive } from "../spawn/index.ts";
import { getBudgetPolicy } from "./budget.ts";
import { runHeadlessProfile } from "./headless-runner.ts";
import { compilePipeline } from "./planner.ts";
import { getProfile } from "./profiles.ts";
import { RunRegistry } from "./registry.ts";
import { ResultWatcher } from "./result-watcher.ts";
import { LANE_RESULT_TOOL, LANE_STATUS_TOOL, ORCHESTRATE_TOOL } from "./tool-surface.ts";
import { SpawnTraceLedger } from "./trace-ledger.ts";
import type {
	AdmissionDecision,
	BudgetPreset,
	LaneRef,
	PipelinePlan,
	PipelineStep,
	RunRecord,
	SpawnMode,
} from "./types.ts";

const TRACE_ENTRY_TYPE = "spawn:trace";

type TextResult = { content: { type: "text"; text: string }[]; details: unknown };
type OrchestrateParams = { request?: string; mode?: string; budget?: string };
type LaneStatusParams = { runId?: string; origin?: string };
type LaneResultParams = { runId: string; verbosity?: string };

type QueueItem = {
	record: RunRecord;
	step: PipelineStep;
	ctx: ExtensionContext;
	requestText: string;
	plan: PipelinePlan;
};

export class SpawnOrchestratorRuntime {
	private readonly registry = new RunRegistry();
	private readonly queue: QueueItem[] = [];
	private running = 0;
	private readonly background = new Map<string, Promise<void>>();
	private readonly watcher = new ResultWatcher();
	private ledger?: SpawnTraceLedger;
	private readonly runCwds = new Map<string, string>();

	constructor(private readonly pi: ExtensionAPI) {}

	async orchestrate(params: OrchestrateParams, ctx: ExtensionContext, signal?: AbortSignal): Promise<TextResult> {
		this.useLedger(ctx.cwd);
		const request = params.request?.trim();
		if (!request) throw new Error("orchestrate requires request");
		const mode = normalizeMode(params.mode);
		const budget = normalizeBudget(params.budget);
		const plan = compilePipeline(request, {
			mode,
			budget,
			originId: `spawn-${Date.now().toString(36)}`,
			interactive: mode === "side-spawn" || mode === "handoff",
		});

		const records = await this.createRuns(plan, request, ctx, signal);
		this.persistPlan(planSummary(plan, records), ctx.cwd);
		return textResult(formatPlan(plan, records));
	}

	status(params: LaneStatusParams, ctx?: ExtensionContext): TextResult {
		if (ctx) this.useLedger(ctx.cwd);
		else this.useLedger();
		const runs = params.runId
			? [this.resolveRun(params.runId, ctx?.cwd)].filter((run): run is RunRecord => Boolean(run))
			: this.registry.listRuns(params.origin).filter((run) => this.matchesCwd(run, ctx?.cwd));
		return textResult(formatStatus(runs, this.watcher.snapshot(params.runId), params.runId, params.origin), {
			runs,
			watcher: this.watcher.snapshot(params.runId),
		});
	}

	result(params: LaneResultParams, ctx?: ExtensionContext): TextResult {
		if (ctx) this.useLedger(ctx.cwd);
		else this.useLedger();
		const run = this.resolveRun(params.runId, ctx?.cwd);
		if (!run) return textResult(`Run not found: ${params.runId}`);
		const verbosity = params.verbosity === "full" || params.verbosity === "summary" ? params.verbosity : "metadata";
		return textResult(formatResult(run, verbosity), { run });
	}

	private async createRuns(
		plan: PipelinePlan,
		requestText: string,
		ctx: ExtensionContext,
		signal?: AbortSignal,
	): Promise<RunRecord[]> {
		const records: RunRecord[] = [];
		const stepsById = new Map(plan.steps.map((step) => [step.id, step]));
		for (const decision of plan.admissions) {
			if (decision.action === "ask" || decision.action === "reject") {
				continue;
			}
			const step = stepsById.get(decision.run.request.stepId ?? "");
			if (!step) continue;
			const record = this.registry.createRun(decision.run, laneForStep(step), step.acceptance);
			this.runCwds.set(record.id, ctx.cwd);
			records.push(record);
			this.persistRun(record.id);
			this.queue.push({ record, step, ctx, requestText, plan });
		}
		await this.drainQueue(signal);
		for (let index = 0; index < records.length; index++) {
			const updated = this.registry.getRun(records[index]!.id);
			if (updated) records[index] = updated;
		}
		return records;
	}

	private async startOrLaunch(
		record: RunRecord,
		step: PipelineStep,
		ctx: ExtensionContext,
		requestText: string,
		plan: PipelinePlan,
		signal?: AbortSignal,
	): Promise<void> {
		if (step.laneBackend === "pi-session") {
			await this.launchInspectableLane(record, step, ctx, requestText, signal);
			await this.drainQueue(signal);
			return;
		}
		this.launchHeadless(record, step, ctx, requestText, plan, signal);
	}

	private async launchInspectableLane(
		record: RunRecord,
		step: PipelineStep,
		ctx: ExtensionContext,
		requestText: string,
		signal?: AbortSignal,
	): Promise<void> {
		this.registry.startRun(record.id);
		this.persistRun(record.id);
		const result = await spawnLanePrimitive(
			this.pi,
			{
				runtime: "pi",
				payload: "direct",
				relation: "child",
				placement: "new-window",
				name: step.id,
				goal: step.title,
				prompt: buildStepPrompt(step, requestText),
			},
			ctx,
			signal,
		);
		this.registry.promoteRun(record.id, {
			backend: "pi-session",
			jumpable: true,
			promotable: false,
			sessionPath: result.child.sessionPath,
			paneId: result.implementation.mux.tmux?.paneId,
			windowId: result.implementation.mux.tmux?.windowId,
		});
		this.registry.completeRun(
			record.id,
			"Inspectable lane launched and completed. Continue or inspect it from the spawned Pi session.",
		);
		this.persistRun(record.id);
	}

	private launchHeadless(
		record: RunRecord,
		step: PipelineStep,
		ctx: ExtensionContext,
		requestText: string,
		plan: PipelinePlan,
		signal?: AbortSignal,
	): void {
		const cwd = ctx.cwd;
		this.running++;
		this.registry.startRun(record.id);
		this.persistRun(record.id);
		const profile = getProfile(step.profile);
		const promise = runHeadlessProfile({
			pi: this.pi,
			ctx,
			profile,
			prompt: buildStepPrompt(step, requestText, plan),
			maxTurns: budgetTurns(record.budgetPreset),
			signal,
		})
			.then((result) => {
				this.registry.promoteRun(record.id, {
					backend: "headless",
					sessionPath: result.sessionPath,
					worktreePath: result.worktree?.path,
				});
				if (result.worktree?.branch)
					this.registry.addArtifact(record.id, `worktree-branch:${result.worktree.branch}`);
				this.registry.completeRun(record.id, result.responseText, {
					toolUses: result.toolUses,
					turns: result.turns,
				});
			})
			.catch((error) => {
				this.registry.failRun(record.id, error instanceof Error ? error.message : String(error));
			})
			.finally(() => {
				this.running--;
				this.background.delete(record.id);
				this.persistRun(record.id);
				this.drainQueue().catch((error) => {
					this.pi.appendEntry(TRACE_ENTRY_TYPE, {
						type: "scheduler-error",
						data: error instanceof Error ? error.message : String(error),
						timestamp: Date.now(),
					});
				});
			});
		this.background.set(record.id, promise);
		this.watcher.watch(record, promise, () => this.persistWatchers(cwd));
	}

	private async drainQueue(signal?: AbortSignal): Promise<void> {
		let progressed = true;
		while (progressed && this.queue.length > 0) {
			progressed = false;
			this.blockQueueItemsWithFailedDependencies();
			const readyIndex = this.queue.findIndex(
				(item) => this.running < getBudgetPolicy(item.plan.budget).maxConcurrent && this.dependenciesMet(item),
			);
			if (readyIndex < 0) continue;
			const [next] = this.queue.splice(readyIndex, 1);
			if (!next) continue;
			await this.startOrLaunch(next.record, next.step, next.ctx, next.requestText, next.plan, signal);
			progressed = true;
		}
	}

	private dependenciesMet(item: QueueItem): boolean {
		return item.step.dependsOn.every((stepId) => this.dependencyStatus(item.plan.originId, stepId) === "completed");
	}

	private blockQueueItemsWithFailedDependencies(): void {
		for (let index = this.queue.length - 1; index >= 0; index--) {
			const item = this.queue[index]!;
			const failed = item.step.dependsOn.find((stepId) => {
				const status = this.dependencyStatus(item.plan.originId, stepId);
				return status === "blocked" || status === "failed" || status === "needs-follow-up" || status === "stopped";
			});
			if (!failed) continue;
			this.queue.splice(index, 1);
			this.registry.blockRun(item.record.id, `Dependency ${failed} did not satisfy acceptance`);
			this.persistRun(item.record.id);
		}
	}

	private dependencyStatus(originId: string, stepId: string): RunRecord["status"] | undefined {
		return this.registry.listRuns(originId).find((run) => run.stepId === stepId)?.status;
	}

	private resolveRun(idOrPrefix: string, cwd?: string): RunRecord | undefined {
		return (
			this.matchResolvedRun(this.registry.getRun(idOrPrefix), cwd) ??
			this.registry
				.listRuns()
				.find((run) => this.matchesCwd(run, cwd) && (run.id.startsWith(idOrPrefix) || run.originId === idOrPrefix))
		);
	}

	private matchResolvedRun(run: RunRecord | undefined, cwd?: string): RunRecord | undefined {
		return run && this.matchesCwd(run, cwd) ? run : undefined;
	}

	private matchesCwd(run: RunRecord, cwd?: string): boolean {
		return !cwd || this.runCwds.get(run.id) === cwd;
	}

	private useLedger(cwd?: string): SpawnTraceLedger {
		const ledgerCwd = cwd ?? this.ledger?.cwd;
		if (!ledgerCwd) throw new Error("Spawn durable ledger requires a project cwd");
		if (this.ledger?.cwd === ledgerCwd) return this.ledger;
		this.ledger = new SpawnTraceLedger(ledgerCwd);
		const state = this.ledger.load();
		this.registry.hydrate({ runs: state.runs, events: state.events });
		for (const run of state.runs) this.runCwds.set(run.id, ledgerCwd);
		this.reconcileRecoveredRuns(ledgerCwd);
		return this.ledger;
	}

	private persistSessionEntry(type: string, data: unknown): void {
		this.pi.appendEntry(TRACE_ENTRY_TYPE, { type, data, timestamp: Date.now() });
	}

	private persistRun(id: string): void {
		const run = this.registry.getRun(id);
		if (!run) return;
		const ledger = this.useLedger(this.runCwds.get(id));
		ledger.upsertRun(run);
		ledger.replaceEvents(this.registry.allTraceEvents());
		this.persistSessionEntry("run", metadataRun(run));
	}

	private persistPlan(plan: ReturnType<typeof planSummary>, cwd?: string): void {
		this.useLedger(cwd).upsertPlan(plan);
		this.persistSessionEntry("plan", plan);
	}

	private persistWatchers(cwd?: string): void {
		const snapshots = this.watcher.snapshot();
		this.useLedger(cwd).saveWatchers(snapshots);
		this.persistSessionEntry("watcher", snapshots);
	}

	private reconcileRecoveredRuns(cwd: string): void {
		for (const run of this.registry.listRuns()) {
			if (!this.matchesCwd(run, cwd)) continue;
			if (run.status !== "running" && run.status !== "queued") continue;
			if (this.background.has(run.id) || this.queue.some((item) => item.record.id === run.id)) continue;
			this.registry.stopRun(
				run.id,
				"Recovered durable run without a live watcher; inspect session path if present.",
			);
			const updated = this.registry.getRun(run.id);
			if (updated) this.ledger?.upsertRun(updated);
		}
		this.ledger?.replaceEvents(this.registry.allTraceEvents());
	}
}

export function registerSpawnOrchestrator(pi: ExtensionAPI): SpawnOrchestratorRuntime {
	const runtime = new SpawnOrchestratorRuntime(pi);

	pi.registerTool({
		...ORCHESTRATE_TOOL,
		promptSnippet: "Plan or run a Spawn pipeline",
		parameters: ORCHESTRATE_TOOL.parameters as any,
		execute: async (_toolCallId, params, signal, _onUpdate, ctx) =>
			runtime.orchestrate(params as OrchestrateParams, ctx, signal),
	});
	pi.registerTool({
		...LANE_STATUS_TOOL,
		promptSnippet: "Show Spawn lane status",
		parameters: LANE_STATUS_TOOL.parameters as any,
		execute: async (_toolCallId, params, _signal, _onUpdate, ctx) => runtime.status(params as LaneStatusParams, ctx),
	});
	pi.registerTool({
		...LANE_RESULT_TOOL,
		promptSnippet: "Read Spawn lane result",
		parameters: LANE_RESULT_TOOL.parameters as any,
		execute: async (_toolCallId, params, _signal, _onUpdate, ctx) => runtime.result(params as LaneResultParams, ctx),
	});

	pi.registerCommand("lanes", {
		description: "Show Spawn orchestrator runs. Usage: /lanes [origin|run-id]",
		handler: async (args, ctx) => {
			const trimmed = args.trim();
			const result = runtime.status(trimmed ? { runId: trimmed, origin: trimmed } : {}, ctx);
			pi.sendMessage({
				customType: "spawn-orchestrator-status",
				content: result.content[0]?.text ?? "",
				display: true,
			});
		},
	});
	return runtime;
}

function normalizeMode(value: string | undefined): SpawnMode {
	if (value === "side-spawn" || value === "handoff" || value === "orchestrate" || value === "auto") return value;
	return "auto";
}

function normalizeBudget(value: string | undefined): BudgetPreset {
	if (value === "cheap" || value === "balanced" || value === "fast" || value === "premium") return value;
	return "balanced";
}

function textResult(text: string, details?: unknown): TextResult {
	return { content: [{ type: "text", text }], details };
}

function laneForStep(step: PipelineStep): Partial<LaneRef> {
	return {
		backend: step.laneBackend,
		jumpable: step.laneBackend === "pi-session" || step.laneBackend === "pane",
		promotable: step.laneBackend === "headless",
	};
}

function budgetTurns(preset: BudgetPreset): number {
	if (preset === "cheap") return 4;
	if (preset === "premium") return 12;
	return 8;
}

function buildStepPrompt(step: PipelineStep, requestText: string, plan?: PipelinePlan): string {
	return [
		`Original request:\n${requestText}`,
		`Step: ${step.title}`,
		`Profile: ${step.profile}`,
		step.acceptance.length ? `Acceptance:\n${step.acceptance.map((item) => `- ${item}`).join("\n")}` : undefined,
		plan ? `Pipeline mode: ${plan.mode}\nOrigin: ${plan.originId}` : undefined,
		"Return a concise result with findings, files/artifacts touched or inspected, verification, and blockers.",
	]
		.filter(Boolean)
		.join("\n\n");
}

function formatPlan(plan: PipelinePlan, records: RunRecord[]): string {
	const admissions = plan.admissions.map(formatAdmission).join("\n");
	const runs = records
		.map((run) => `- ${run.id} ${run.status} ${run.profile}/${run.kind} lane=${run.lane.backend}`)
		.join("\n");
	return [
		`Origin: ${plan.originId}`,
		`Mode: ${plan.mode}`,
		`Budget: ${plan.budget}`,
		`Acceptance: ${plan.analysis.acceptanceCriteria.join("; ")}`,
		"",
		"Admissions:",
		admissions || "- none",
		"",
		"Runs:",
		runs || "- no runs admitted",
		"",
		`Use lane_status with origin="${plan.originId}" or /lanes ${plan.originId}.`,
	].join("\n");
}

function planSummary(plan: PipelinePlan, records: RunRecord[]) {
	return {
		originId: plan.originId,
		mode: plan.mode,
		budget: plan.budget,
		complexity: plan.analysis.complexity,
		needsEdits: plan.analysis.needsEdits,
		needsResearch: plan.analysis.needsResearch,
		steps: plan.steps.map((step) => ({
			id: step.id,
			profile: step.profile,
			laneBackend: step.laneBackend,
			editPolicy: step.editPolicy,
			dependsOn: step.dependsOn,
			acceptance: step.acceptance,
		})),
		runs: records.map((run) => ({
			id: run.id,
			status: run.status,
			profile: run.profile,
			laneBackend: run.lane.backend,
			acceptance: run.acceptance.status,
		})),
	};
}

function metadataRun(run: RunRecord) {
	return {
		id: run.id,
		originId: run.originId,
		stepId: run.stepId,
		kind: run.kind,
		profile: run.profile,
		status: run.status,
		lane: run.lane,
		acceptance: {
			criteria: run.acceptance.criteria,
			status: run.acceptance.status,
			evidenceCount: run.acceptance.evidence.length,
			followUpCount: run.acceptance.followUps.length,
		},
		metrics: run.metrics,
		artifactCount: run.artifacts.length,
		errorCount: run.errors.length,
		createdAt: run.createdAt,
		updatedAt: run.updatedAt,
		startedAt: run.startedAt,
		completedAt: run.completedAt,
	};
}

function formatAdmission(decision: AdmissionDecision): string {
	if (decision.action === "ask" || decision.action === "reject") return `- ${decision.action}: ${decision.reason}`;
	return `- ${decision.action}: ${decision.run.request.intent} (${decision.run.request.profile}, ${decision.run.request.laneBackend})`;
}

export function formatStatus(
	runs: RunRecord[],
	watcher: ReturnType<ResultWatcher["snapshot"]>,
	runId?: string,
	origin?: string,
): string {
	if (runs.length === 0)
		return `No Spawn runs found${runId ? ` for run ${runId}` : origin ? ` for origin ${origin}` : ""}.`;
	return runs
		.map((run) => {
			const watch = watcher.find((item) => item.runId === run.id);
			const lane = [
				run.lane.backend,
				run.lane.sessionPath ? `session=${run.lane.sessionPath}` : undefined,
				run.lane.paneId ? `pane=${run.lane.paneId}` : undefined,
			]
				.filter(Boolean)
				.join(" ");
			const watchText = watch ? ` watcher=${watch.status}` : "";
			const inspect = inspectHint(run);
			const criteria = run.acceptance.criteria.length ? ` criteria="${run.acceptance.criteria.join("; ")}"` : "";
			const followUp = run.acceptance.followUps.length
				? `\n  follow-up: ${run.acceptance.followUps.join("; ")}`
				: "";
			return `${run.id} ${run.status} acceptance=${run.acceptance.status} ${run.profile}/${run.kind} ${lane}${watchText} origin=${run.originId}${criteria}${followUp}${inspect ? `\n  inspect: ${inspect}` : ""}`;
		})
		.join("\n");
}

export function formatResult(run: RunRecord, verbosity: "metadata" | "summary" | "full"): string {
	const metadata = [
		`Run: ${run.id}`,
		`Origin: ${run.originId}`,
		`Status: ${run.status}`,
		`Acceptance: ${run.acceptance.status}`,
		run.acceptance.criteria.length ? `Criteria: ${run.acceptance.criteria.join("; ")}` : undefined,
		run.acceptance.followUps.length ? `Follow-up: ${run.acceptance.followUps.join("; ")}` : undefined,
		`Profile: ${run.profile}`,
		`Lane: ${run.lane.backend}${run.lane.sessionPath ? ` ${run.lane.sessionPath}` : ""}`,
		inspectHint(run) ? `Inspect: ${inspectHint(run)}` : undefined,
		run.errors.length ? `Errors: ${run.errors.join("; ")}` : undefined,
	]
		.filter(Boolean)
		.join("\n");
	if (verbosity === "metadata") return metadata;
	const summary = `\n\nSummary:\n${run.summary ?? "(not completed yet)"}`;
	if (verbosity === "summary") return metadata + summary;
	return `${metadata}${summary}\n\nTranscript: full transcript inspection is local-only; use the lane/session path when present.`;
}

function inspectHint(run: RunRecord): string | undefined {
	if (run.lane.paneId) return `tmux select-pane -t ${shellQuote(run.lane.paneId)}`;
	if (run.lane.windowId) return `tmux select-window -t ${shellQuote(run.lane.windowId)}`;
	if (run.lane.sessionPath) return `pi --session ${shellQuote(run.lane.sessionPath)}`;
	if (run.lane.promotable) return "headless run is promotable after it records a session path";
	return undefined;
}

function shellQuote(value: string): string {
	return `'${value.replace(/'/g, "'\\''")}'`;
}

export default function spawnOrchestratorExtension(pi: ExtensionAPI) {
	let registered = false;
	pi.on("session_start", () => {
		if (registered) return;
		registerSpawnOrchestrator(pi);
		registered = true;
	});
}
