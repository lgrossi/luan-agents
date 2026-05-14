import { randomUUID } from "node:crypto";
import { getProfile } from "./profiles.ts";
import type {
	AcceptanceState,
	AdmittedRun,
	LaneRef,
	PromptVisibility,
	RunMetrics,
	RunRecord,
	RunStatus,
	TraceEvent,
} from "./types.ts";

export class RunRegistry {
	private runs = new Map<string, RunRecord>();
	private events: TraceEvent[] = [];

	constructor(
		private readonly now: () => number = () => Date.now(),
		initial?: { runs?: RunRecord[]; events?: TraceEvent[] },
	) {
		this.hydrate(initial);
	}

	hydrate(initial?: { runs?: RunRecord[]; events?: TraceEvent[] }): void {
		if (!initial) return;
		for (const run of initial.runs ?? []) {
			this.runs.set(run.id, normalizeRun(run));
		}
		const existingEventIds = new Set(this.events.map((event) => event.id));
		for (const event of initial.events ?? []) {
			if (existingEventIds.has(event.id)) continue;
			this.events.push(event);
			existingEventIds.add(event.id);
		}
		this.events.sort((a, b) => a.timestamp - b.timestamp);
	}

	createRun(admitted: AdmittedRun, lane?: Partial<LaneRef>, acceptanceCriteria: string[] = []): RunRecord {
		const request = admitted.request;
		const profile = getProfile(request.profile);
		const timestamp = this.now();
		const criteria = acceptanceCriteria.length ? acceptanceCriteria : ["Run completed without reported blockers"];
		const record: RunRecord = {
			id: randomUUID(),
			originId: request.originId,
			parentRunId: request.parentRunId,
			stepId: request.stepId,
			kind: request.kind,
			profile: request.profile,
			intent: request.intent,
			status: "queued",
			depth: request.depth,
			budgetPreset: admitted.budget.preset,
			modelTier: admitted.budget.modelTier,
			editPolicy: request.editPolicy ?? profile.editPolicy,
			contextPolicy: profile.contextPolicy,
			promptVisibility: request.promptVisibility ?? "metadata",
			lane: {
				backend: request.laneBackend,
				jumpable: request.laneBackend === "pi-session" || request.laneBackend === "pane",
				promotable: request.laneBackend === "headless",
				...lane,
			},
			metrics: { estimatedTokens: request.estimatedTokens ?? admitted.budget.maxTokens },
			acceptance: { criteria, status: "pending", evidence: [], followUps: [], results: [] },
			artifacts: [],
			errors: [],
			createdAt: timestamp,
			updatedAt: timestamp,
		};
		this.runs.set(record.id, record);
		this.recordEvent(record.id, "created", `Created ${record.profile} ${record.kind} run`);
		return record;
	}

	startRun(id: string): RunRecord {
		this.requireRun(id);
		const updated = this.patchRun(id, { status: "running", startedAt: this.now() });
		this.recordEvent(id, "started", "Started run");
		return updated;
	}

	completeRun(id: string, summary: string, metrics: RunMetrics = {}): RunRecord {
		const run = this.requireRun(id);
		const acceptance = assessAcceptance(run.acceptance.criteria, summary);
		const status = terminalRunStatusForAcceptance(acceptance.status);
		return this.finishRun(id, status, summary, metrics, acceptance);
	}

	blockRun(id: string, reason: string): RunRecord {
		const run = this.requireRun(id);
		const updated = this.patchRun(id, {
			status: "blocked",
			completedAt: this.now(),
			acceptance: {
				...run.acceptance,
				status: "blocked",
				followUps: unique([...run.acceptance.followUps, reason]),
			},
			errors: [...run.errors, reason],
		});
		this.recordEvent(id, "blocked", reason);
		return updated;
	}

	failRun(id: string, reason: string): RunRecord {
		const run = this.requireRun(id);
		const updated = this.patchRun(id, {
			status: "failed",
			completedAt: this.now(),
			acceptance: {
				...run.acceptance,
				status: "failed",
				followUps: unique([...run.acceptance.followUps, reason]),
			},
			errors: [...run.errors, reason],
		});
		this.recordEvent(id, "failed", reason);
		return updated;
	}

	stopRun(id: string, reason: string): RunRecord {
		const run = this.requireRun(id);
		const updated = this.patchRun(id, {
			status: "stopped",
			completedAt: this.now(),
			acceptance: {
				...run.acceptance,
				status: "needs-follow-up",
				followUps: unique([...run.acceptance.followUps, reason]),
			},
			errors: [...run.errors, reason],
		});
		this.recordEvent(id, "stopped", reason);
		return updated;
	}

	promoteRun(id: string, lane: Partial<LaneRef>): RunRecord {
		const run = this.requireRun(id);
		const updated = this.patchRun(id, {
			lane: { ...run.lane, ...lane, jumpable: true, promotable: false },
		});
		this.recordEvent(id, "promoted", "Promoted run to an inspectable lane");
		return updated;
	}

	addArtifact(id: string, artifact: string): RunRecord {
		const run = this.requireRun(id);
		const updated = this.patchRun(id, { artifacts: [...run.artifacts, artifact] });
		this.recordEvent(id, "artifact", artifact);
		return updated;
	}

	getRun(id: string): RunRecord | undefined {
		return this.runs.get(id);
	}

	listRuns(originId?: string): RunRecord[] {
		return [...this.runs.values()]
			.filter((run) => !originId || run.originId === originId)
			.sort((a, b) => a.createdAt - b.createdAt);
	}

	trace(originId: string, visibility: PromptVisibility = "metadata"): string {
		const runs = this.listRuns(originId);
		if (runs.length === 0) return `No runs found for origin ${originId}.`;
		return runs
			.map((run) => {
				const lane = [run.lane.backend, run.lane.sessionPath, run.lane.paneId].filter(Boolean).join(" ");
				const summary = visibility === "metadata" ? "" : `\n  summary: ${run.summary ?? "(none)"}`;
				const errors = run.errors.length > 0 ? `\n  errors: ${run.errors.join("; ")}` : "";
				return `- ${run.id} ${run.status} ${run.profile}/${run.kind} acceptance=${run.acceptance.status} lane=${lane || run.lane.backend} tokens=${run.metrics.estimatedTokens ?? 0}${summary}${errors}`;
			})
			.join("\n");
	}

	traceEvents(originId?: string): TraceEvent[] {
		return this.events.filter((event) => !originId || event.originId === originId);
	}

	allTraceEvents(): TraceEvent[] {
		return [...this.events];
	}

	private finishRun(
		id: string,
		status: Extract<RunStatus, "completed" | "blocked" | "failed" | "needs-follow-up">,
		summary: string,
		metrics: RunMetrics,
		acceptance: AcceptanceState,
	) {
		const run = this.requireRun(id);
		const completedAt = this.now();
		const durationMs = run.startedAt ? completedAt - run.startedAt : metrics.durationMs;
		const updated = this.patchRun(id, {
			status,
			completedAt,
			summary,
			acceptance,
			metrics: { ...run.metrics, ...metrics, durationMs },
		});
		this.recordEvent(id, status, summary);
		return updated;
	}

	private patchRun(id: string, patch: Partial<RunRecord>): RunRecord {
		const run = this.requireRun(id);
		const updated = { ...run, ...patch, updatedAt: this.now() };
		this.runs.set(id, updated);
		return updated;
	}

	private recordEvent(runId: string, type: TraceEvent["type"], message: string): void {
		const run = this.requireRun(runId);
		this.events.push({
			id: randomUUID(),
			runId,
			originId: run.originId,
			type,
			message,
			timestamp: this.now(),
		});
	}

	private requireRun(id: string): RunRecord {
		const run = this.runs.get(id);
		if (!run) throw new Error(`Unknown run: ${id}`);
		return run;
	}
}

function normalizeRun(run: RunRecord): RunRecord {
	return {
		...run,
		acceptance: run.acceptance ?? {
			criteria: ["Run completed without reported blockers"],
			status: run.status === "completed" ? "met" : run.status === "failed" ? "failed" : "pending",
			evidence: [],
			followUps: [],
			results: [],
		},
	};
}

function terminalRunStatusForAcceptance(
	status: AcceptanceState["status"],
): Extract<RunStatus, "completed" | "blocked" | "failed" | "needs-follow-up"> {
	if (status === "met") return "completed";
	if (status === "blocked" || status === "failed" || status === "needs-follow-up") return status;
	return "needs-follow-up";
}

function assessAcceptance(criteria: string[], summary: string): AcceptanceState {
	const structured = parseStructuredAcceptance(criteria, summary);
	if (structured) return structured;
	if (isNoAssistantOutput(summary)) {
		const followUps = ["Completion summary did not include explicit acceptance evidence"];
		return {
			criteria,
			status: "needs-follow-up",
			evidence: evidenceFromSummary(summary),
			followUps,
			results: criteria.map((criterion) => ({
				criterion,
				status: "needs-follow-up",
				evidence: evidenceFromSummary(summary),
				followUps,
			})),
		};
	}
	const followUps = extractFollowUps(summary);
	if (followUps.length > 0) {
		return {
			criteria,
			status: "needs-follow-up",
			evidence: evidenceFromSummary(summary),
			followUps,
			results: criteria.map((criterion) => ({
				criterion,
				status: "needs-follow-up",
				evidence: evidenceFromSummary(summary),
				followUps,
			})),
		};
	}
	if (!hasAcceptanceEvidence(summary)) {
		return {
			criteria,
			status: "needs-follow-up",
			evidence: evidenceFromSummary(summary),
			followUps: ["Completion summary did not include explicit acceptance evidence"],
			results: criteria.map((criterion) => ({
				criterion,
				status: "needs-follow-up",
				evidence: evidenceFromSummary(summary),
				followUps: ["Completion summary did not include explicit acceptance evidence"],
			})),
		};
	}
	return {
		criteria,
		status: "met",
		evidence: evidenceFromSummary(summary),
		followUps: [],
		results: criteria.map((criterion) => ({
			criterion,
			status: "met",
			evidence: evidenceFromSummary(summary),
			followUps: [],
		})),
	};
}

function parseStructuredAcceptance(criteria: string[], summary: string): AcceptanceState | undefined {
	const parsed = parseAcceptanceJson(summary);
	if (!parsed || !Array.isArray(parsed.acceptance)) return undefined;
	const results = parsed.acceptance
		.map((item: unknown) => {
			if (!item || typeof item !== "object") return undefined;
			const typed = item as { criterion?: unknown; status?: unknown; evidence?: unknown; followUps?: unknown };
			const status = normalizeAcceptanceStatus(typed.status);
			if (!status || typeof typed.criterion !== "string") return undefined;
			return {
				criterion: typed.criterion,
				status,
				evidence: stringArray(typed.evidence),
				followUps: stringArray(typed.followUps),
			};
		})
		.filter((item): item is NonNullable<typeof item> => Boolean(item));
	if (results.length === 0) return undefined;
	const status = results.some((item) => item.status === "failed")
		? "failed"
		: results.some((item) => item.status === "blocked")
			? "blocked"
			: results.some((item) => item.status === "needs-follow-up")
				? "needs-follow-up"
				: "met";
	return {
		criteria,
		status,
		evidence: results.flatMap((item) => item.evidence).slice(0, 8),
		followUps: results.flatMap((item) => item.followUps).slice(0, 8),
		results,
	};
}

function parseAcceptanceJson(summary: string): { acceptance?: unknown } | undefined {
	for (const candidate of acceptanceJsonCandidates(summary)) {
		try {
			const parsed = JSON.parse(candidate);
			if (parsed && typeof parsed === "object") return parsed as { acceptance?: unknown };
		} catch {}
	}
	return undefined;
}

function acceptanceJsonCandidates(summary: string): string[] {
	const fenced = [...summary.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)].map((match) => match[1]!.trim());
	const marker = summary.match(/SPAWN_ACCEPTANCE:\s*(\{[\s\S]*\})/);
	return [...fenced, marker?.[1], summary.trim()].filter((item): item is string => Boolean(item));
}

function normalizeAcceptanceStatus(value: unknown): "met" | "blocked" | "failed" | "needs-follow-up" | undefined {
	if (value === "met" || value === "blocked" || value === "failed" || value === "needs-follow-up") return value;
	return undefined;
}

function stringArray(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function hasAcceptanceEvidence(summary: string): boolean {
	return /\b(acceptance verified|verified|verification passed|completed|done|evidence returned|found|satisfies|passes?)\b/i.test(
		summary,
	);
}

function isNoAssistantOutput(summary: string): boolean {
	return summary.trim() === "Completed with no assistant output.";
}

function extractFollowUps(summary: string): string[] {
	const patterns =
		/\b(blocked|blocker|cannot complete|unable to verify|unable to complete|not verified|needs follow-up|follow-up required|remaining gap|failed acceptance)\b/i;
	if (!patterns.test(summary)) return [];
	const line = summary
		.trim()
		.split("\n")
		.find((item) => patterns.test(item) && !/\b(no|without)\s+(blockers?|follow-ups?|remaining gaps?)\b/i.test(item));
	return line ? [line.trim()] : [];
}

function evidenceFromSummary(summary: string): string[] {
	return summary
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean)
		.slice(0, 3);
}

function unique(values: string[]): string[] {
	return [...new Set(values)];
}
