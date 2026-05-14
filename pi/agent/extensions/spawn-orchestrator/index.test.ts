import { describe, expect, test } from "bun:test";
import { appendFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { admitRun, applyAdmission, emptySchedulerSnapshot, getBudgetPolicy } from "./budget.ts";
import {
	buildFollowUpStep,
	formatDashboard,
	formatResult,
	formatStatus,
	SpawnOrchestratorRuntime,
} from "./extension.ts";
import { buildHeadlessResourceLoaderOptions, selectModelForTier } from "./headless-runner.ts";
import { compilePipeline } from "./planner.ts";
import { getProfile } from "./profiles.ts";
import { RunRegistry } from "./registry.ts";
import { ResultWatcher } from "./result-watcher.ts";
import { SPAWN_ORCHESTRATOR_TOOLS } from "./tool-surface.ts";
import { SpawnTraceLedger } from "./trace-ledger.ts";
import type { RunRequest } from "./types.ts";

describe("Spawn orchestrator profiles", () => {
	test("product and research profiles replace prompts and do not inherit parent context", () => {
		expect(getProfile("product")).toMatchObject({
			promptMode: "replace",
			contextPolicy: "explicit",
			editPolicy: "none",
		});
		expect(getProfile("research")).toMatchObject({
			promptMode: "replace",
			contextPolicy: "explicit",
			editPolicy: "none",
		});
		expect(getProfile("research").tools).not.toContain("bash");
		expect(getProfile("review").tools).not.toContain("bash");
		expect(getProfile("coding")).toMatchObject({
			promptMode: "replace",
			editPolicy: "worktree",
			requiresWorktree: true,
		});
	});

	test("headless bootstrap suppresses inherited project context and extensions", () => {
		const options = buildHeadlessResourceLoaderOptions(getProfile("research"), "/repo");

		expect(options).toMatchObject({
			noExtensions: true,
			noSkills: true,
			noPromptTemplates: true,
			noThemes: true,
			noContextFiles: true,
		});
		expect(options.systemPromptOverride()).toContain("Do not inherit or assume the parent coding prompt");
		expect(options.systemPromptOverride()).toContain("strictly read-only");
	});

	test("model tier selection downgrades premium parents for cheap and balanced runs", () => {
		const cheap = fakeModel("cheap", 1);
		const balanced = fakeModel("balanced", 10);
		const premium = fakeModel("premium", 100);
		const registry = { getAvailable: () => [premium, cheap, balanced] };

		expect(selectModelForTier(premium, registry, "cheap")?.id).toBe("cheap");
		expect(selectModelForTier(premium, registry, "balanced")?.id).toBe("balanced");
		expect(selectModelForTier(premium, registry, "premium")?.id).toBe("premium");
	});
});

describe("budget admission", () => {
	test("balanced budget admits two parallel headless runs and queues the rest", () => {
		const policy = getBudgetPolicy("balanced");
		let snapshot = emptySchedulerSnapshot();
		const decisions = Array.from({ length: 5 }, (_, index) => {
			const decision = admitRun(researchRequest(`research-${index + 1}`), policy, snapshot);
			snapshot = applyAdmission(snapshot, decision);
			return decision.action;
		});

		expect(decisions).toEqual(["start", "start", "queue", "queue", "queue"]);
		expect(snapshot.reservedTokens).toBe(50_000);
	});

	test("downgrades premium requests under balanced budget", () => {
		const decision = admitRun({ ...researchRequest("expensive"), modelTier: "premium" }, getBudgetPolicy("balanced"));

		expect(decision.action).toBe("start");
		if (decision.action === "start") {
			expect(decision.run.budget.modelTier).toBe("balanced");
			expect(decision.run.warnings[0]).toContain("Downgraded");
		}
	});

	test("blocks recursive runaway attempts beyond depth policy", () => {
		const decision = admitRun({ ...researchRequest("recursive"), depth: 3 }, getBudgetPolicy("balanced"));

		expect(decision).toMatchObject({ action: "reject" });
	});

	test("rejects write-capable runs without worktree isolation", () => {
		const decision = admitRun(
			{
				...researchRequest("edit"),
				profile: "coding",
				editPolicy: "worktree",
			},
			getBudgetPolicy("balanced"),
		);

		expect(decision).toMatchObject({ action: "reject", reason: "Write-capable runs require worktree isolation" });
	});
});

describe("pipeline planning", () => {
	test("headless research fanout avoids pane explosion under balanced budget", () => {
		const plan = compilePipeline("Research five approaches and compare tradeoffs", {
			mode: "orchestrate",
			budget: "balanced",
			researchFanout: 5,
			originId: "origin-1",
		});

		const research = plan.steps.filter((step) => step.parallelGroup === "research");
		expect(research).toHaveLength(5);
		expect(research.every((step) => step.laneBackend === "headless")).toBe(true);
		expect(plan.admissions.map((decision) => decision.action).slice(0, 5)).toEqual([
			"start",
			"start",
			"queue",
			"queue",
			"queue",
		]);
	});

	test("implementation plans keep edits inside an explicit worktree step", () => {
		const plan = compilePipeline("Investigate the bug, implement the fix, and verify acceptance", {
			mode: "orchestrate",
			budget: "balanced",
			originId: "origin-2",
		});

		const implementation = plan.steps.find((step) => step.id === "implementation");
		expect(implementation).toMatchObject({ profile: "coding", editPolicy: "worktree", laneBackend: "headless" });
		expect(plan.steps.at(-1)).toMatchObject({ id: "verification", profile: "review" });
	});

	test("interactive side-spawn uses a jumpable session backend", () => {
		const plan = compilePipeline("Open a side-spawn research lane", {
			mode: "side-spawn",
			interactive: true,
			originId: "origin-3",
		});

		expect(plan.steps).toHaveLength(1);
		expect(plan.steps[0]).toMatchObject({ laneBackend: "pi-session", profile: "research" });
	});

	test("acceptance follow-ups are read-only headless review steps", () => {
		const plan = compilePipeline("Research and verify acceptance", { mode: "orchestrate", originId: "origin-4" });
		const followUp = buildFollowUpStep(plan.steps[0]!, 1);

		expect(followUp).toMatchObject({
			id: `${plan.steps[0]!.id}-follow-up-1`,
			profile: "review",
			laneBackend: "headless",
			editPolicy: "none",
			dependsOn: [],
		});
		expect(followUp.acceptance.at(-1)).toContain("explicit acceptance evidence");
	});
});

describe("run registry", () => {
	test("records origin trace, promotion, metrics, and metadata-default results", () => {
		let now = 1000;
		const registry = new RunRegistry(() => now);
		const decision = admitRun(researchRequest("trace"), getBudgetPolicy("balanced"));
		if (decision.action !== "start") throw new Error("expected start");

		const run = registry.createRun(decision.run);
		now += 10;
		registry.startRun(run.id);
		now += 15;
		registry.promoteRun(run.id, { backend: "pi-session", sessionPath: "/tmp/session.jsonl" });
		now += 25;
		const completed = registry.completeRun(run.id, "found the answer", { inputTokens: 10, outputTokens: 20 });

		expect(completed.lane).toMatchObject({ jumpable: true, promotable: false, sessionPath: "/tmp/session.jsonl" });
		expect(completed.metrics.durationMs).toBe(40);
		expect(registry.trace("origin-test")).toContain("research/agent");
		expect(registry.trace("origin-test")).not.toContain("found the answer");
		expect(registry.trace("origin-test", "summary")).toContain("found the answer");
		expect(registry.traceEvents("origin-test").map((event) => event.type)).toEqual([
			"created",
			"started",
			"promoted",
			"completed",
		]);
	});

	test("marks completed runs that miss acceptance as needing follow-up", () => {
		const registry = new RunRegistry(() => 1000);
		const decision = admitRun(researchRequest("acceptance"), getBudgetPolicy("balanced"));
		if (decision.action !== "start") throw new Error("expected start");

		const run = registry.createRun(decision.run, undefined, ["Verify the bug is fixed"]);
		registry.startRun(run.id);
		const completed = registry.completeRun(run.id, "Unable to verify acceptance; follow-up required.");

		expect(completed.status).toBe("needs-follow-up");
		expect(completed.acceptance).toMatchObject({ status: "needs-follow-up" });
		expect(completed.acceptance.followUps[0]).toContain("Unable to verify");
	});

	test("does not accept headless runs that produced no assistant output", () => {
		const registry = new RunRegistry(() => 1000);
		const decision = admitRun(researchRequest("empty-output"), getBudgetPolicy("balanced"));
		if (decision.action !== "start") throw new Error("expected start");

		const run = registry.createRun(decision.run, undefined, ["Return concrete evidence"]);
		registry.startRun(run.id);
		const completed = registry.completeRun(run.id, "Completed with no assistant output.");

		expect(completed.status).toBe("needs-follow-up");
		expect(completed.acceptance.status).toBe("needs-follow-up");
		expect(completed.acceptance.followUps[0]).toContain("did not include explicit acceptance evidence");
	});

	test("evaluates structured acceptance per criterion", () => {
		const registry = new RunRegistry(() => 1000);
		const decision = admitRun(researchRequest("structured"), getBudgetPolicy("balanced"));
		if (decision.action !== "start") throw new Error("expected start");
		const run = registry.createRun(decision.run, undefined, ["criterion one", "criterion two"]);

		const completed = registry.completeRun(
			run.id,
			`Done\nSPAWN_ACCEPTANCE: {"acceptance":[{"criterion":"criterion one","status":"met","evidence":["proof"]},{"criterion":"criterion two","status":"blocked","evidence":[],"followUps":["needs data"]}]}`,
		);

		expect(completed.status).toBe("blocked");
		expect(completed.acceptance.results).toHaveLength(2);
		expect(completed.acceptance.followUps).toEqual(["needs data"]);
	});

	test("does not treat explicit no-blocker summaries as follow-up", () => {
		const registry = new RunRegistry(() => 1000);
		const decision = admitRun(researchRequest("no-blockers"), getBudgetPolicy("balanced"));
		if (decision.action !== "start") throw new Error("expected start");

		const run = registry.createRun(decision.run, undefined, ["Verify the bug is fixed"]);
		registry.startRun(run.id);
		const completed = registry.completeRun(run.id, "Acceptance verified. No blockers.");

		expect(completed.status).toBe("completed");
		expect(completed.acceptance.status).toBe("met");
	});

	test("hydrates records and events from the durable project ledger", () => {
		const dir = mkdtempSync(join(tmpdir(), "spawn-ledger-"));
		try {
			const registry = new RunRegistry(() => 1000);
			const decision = admitRun(researchRequest("ledger"), getBudgetPolicy("balanced"));
			if (decision.action !== "start") throw new Error("expected start");
			const run = registry.createRun(decision.run, { backend: "headless", sessionPath: "/tmp/spawn.jsonl" }, [
				"Return evidence",
			]);
			const completed = registry.completeRun(run.id, "Evidence returned.");
			const ledger = new SpawnTraceLedger(dir);
			ledger.upsertRun(completed);
			ledger.replaceEvents(registry.allTraceEvents());

			const restored = new RunRegistry(() => 2000, ledger.load());

			expect(restored.getRun(run.id)).toMatchObject({
				id: run.id,
				acceptance: { status: "met", criteria: ["Return evidence"] },
			});
			expect(restored.traceEvents("origin-test").map((event) => event.type)).toContain("completed");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("backs up malformed ledger JSON instead of overwriting it silently", () => {
		const dir = mkdtempSync(join(tmpdir(), "spawn-ledger-corrupt-"));
		try {
			const ledger = new SpawnTraceLedger(dir);
			mkdirSync(join(dir, ".pi", "spawn"), { recursive: true });
			writeFileSync(ledger.path, "{not-json", "utf8");

			expect(ledger.load().runs).toEqual([]);
			expect(readdirSync(join(dir, ".pi", "spawn")).some((file) => file.includes(".corrupt-"))).toBe(true);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
	test("applies retention limits to durable ledger records", () => {
		const dir = mkdtempSync(join(tmpdir(), "spawn-ledger-retention-"));
		try {
			const ledger = new SpawnTraceLedger(dir);
			for (let index = 0; index < 505; index++) {
				ledger.upsertRun({ ...runRecordFixture(index), id: `run-${index}`, updatedAt: index });
			}

			expect(ledger.load().runs).toHaveLength(500);
			expect(ledger.load().runs.some((run) => run.id === "run-0")).toBe(false);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("tool surface", () => {
	test("keeps LLM-facing tool descriptions compact", () => {
		for (const tool of SPAWN_ORCHESTRATOR_TOOLS) {
			expect(tool.description.length).toBeLessThan(140);
		}
	});
});

describe("status rendering", () => {
	test("shows acceptance criteria and exact session jump instructions", () => {
		const registry = new RunRegistry(() => 1000);
		const decision = admitRun(researchRequest("status"), getBudgetPolicy("balanced"));
		if (decision.action !== "start") throw new Error("expected start");
		const run = registry.createRun(decision.run, { backend: "headless", sessionPath: "/tmp/spawn session.jsonl" }, [
			"Return evidence",
		]);
		const completed = registry.completeRun(run.id, "Evidence returned.");

		const status = formatStatus([completed], [], completed.id);
		const result = formatResult(completed, "metadata");

		expect(status).toContain("acceptance=met");
		expect(status).toContain("budget=balanced");
		expect(status).toContain("promotable=true");
		expect(status).toContain('criteria="Return evidence"');
		expect(status).toContain("pi --session '/tmp/spawn session.jsonl'");
		expect(result).toContain("Acceptance: met");
		expect(result).toContain("Inspect: pi --session '/tmp/spawn session.jsonl'");
	});

	test("quotes tmux inspect targets sourced from durable metadata", () => {
		const registry = new RunRegistry(() => 1000);
		const decision = admitRun(researchRequest("status-pane"), getBudgetPolicy("balanced"));
		if (decision.action !== "start") throw new Error("expected start");
		const run = registry.createRun(decision.run, { backend: "pane", paneId: "%1; touch /tmp/bad" }, [
			"Return evidence",
		]);
		const completed = registry.completeRun(run.id, "Evidence returned.");

		expect(formatStatus([completed], [])).toContain("tmux select-pane -t '%1; touch /tmp/bad'");
	});

	test("renders a compact dashboard summary without opening panes", () => {
		const registry = new RunRegistry(() => 1000);
		const decision = admitRun(researchRequest("dashboard"), getBudgetPolicy("balanced"));
		if (decision.action !== "start") throw new Error("expected start");
		const run = registry.createRun(decision.run, undefined, ["Return evidence"]);
		const completed = registry.completeRun(run.id, "Evidence returned.");

		expect(formatDashboard([completed])).toContain("origin-test total=1 active=0 done=1 attention=0");
	});
});

describe("runtime durable recovery", () => {
	test("status recovers durable runs and marks orphaned active records stopped", () => {
		const dir = mkdtempSync(join(tmpdir(), "spawn-runtime-"));
		try {
			const registry = new RunRegistry(() => 1000);
			const decision = admitRun(researchRequest("runtime"), getBudgetPolicy("balanced"));
			if (decision.action !== "start") throw new Error("expected start");
			const run = registry.createRun(decision.run, { backend: "headless", sessionPath: "/tmp/orphan.jsonl" }, [
				"Return evidence",
			]);
			const running = registry.startRun(run.id);
			const ledger = new SpawnTraceLedger(dir);
			ledger.upsertRun(running);
			ledger.replaceEvents(registry.allTraceEvents());
			const runtime = new SpawnOrchestratorRuntime(fakePi());

			const result = runtime.status({ origin: "origin-test" }, { cwd: dir } as any).content[0]?.text ?? "";

			expect(result).toContain("stopped");
			expect(result).toContain("Recovered durable run without a live watcher");
			expect(result).toContain("pi --session '/tmp/orphan.jsonl'");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("runs injected headless pipeline and spawns acceptance follow-up", async () => {
		const dir = mkdtempSync(join(tmpdir(), "spawn-runtime-e2e-"));
		try {
			let calls = 0;
			const runtime = new SpawnOrchestratorRuntime(fakePi(), {
				runHeadless: async () => {
					calls++;
					return {
						responseText:
							calls === 1
								? 'SPAWN_ACCEPTANCE: {"acceptance":[{"criterion":"Return concise findings, risks, and source/code references","status":"needs-follow-up","evidence":[],"followUps":["missing evidence"]}]}'
								: 'SPAWN_ACCEPTANCE: {"acceptance":[{"criterion":"Return concise findings, risks, and source/code references","status":"met","evidence":["verified"],"followUps":[]}]}',
						sessionPath: `/tmp/session-${calls}.jsonl`,
						toolUses: 0,
						turns: 1,
					};
				},
			});

			const result = await runtime.orchestrate(
				{ request: "Research compare acceptance", mode: "orchestrate", budget: "cheap" },
				{ cwd: dir } as any,
			);
			await runtime.waitForIdle();
			const origin = /Origin: (spawn-[^\n]+)/.exec(result.content[0]!.text)![1]!;
			const status = runtime.status({ origin }, { cwd: dir } as any).content[0]!.text;

			expect(calls).toBeGreaterThanOrEqual(2);
			expect(status).toContain("follow-up");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("side-spawn result surfaces the child session output", async () => {
		const dir = mkdtempSync(join(tmpdir(), "spawn-runtime-side-"));
		try {
			const sessionPath = join(dir, "child-session.jsonl");
			const childText =
				'Child lane summary.\nSPAWN_ACCEPTANCE: {"acceptance":[{"criterion":"Pipeline criteria are verified or blocked with reasons","status":"met","evidence":["child evidence"],"followUps":[]}]}';
			appendFileSync(
				sessionPath,
				`${JSON.stringify({
					type: "message",
					message: {
						role: "assistant",
						content: [{ type: "text", text: "I will inspect first." }],
						stopReason: "toolUse",
					},
				})}\n`,
			);
			appendFileSync(
				sessionPath,
				`${JSON.stringify({
					type: "message",
					message: { role: "assistant", content: [{ type: "text", text: childText }], stopReason: "stop" },
				})}\n`,
			);
			const runtime = new SpawnOrchestratorRuntime(fakePi(), {
				spawnLane: async () =>
					({
						child: { sessionPath, cwd: dir, name: "research-1" },
						implementation: { mux: { tmux: { paneId: "%9", windowId: "test:1" } } },
					}) as any,
			});

			const result = await runtime.orchestrate(
				{
					request:
						"Open an inspectable read-only lane. Acceptance: Pipeline criteria are verified or blocked with reasons.",
					mode: "side-spawn",
					budget: "cheap",
				},
				{ cwd: dir } as any,
			);
			await runtime.waitForIdle();
			const runId = /- ([0-9a-f-]+) /.exec(result.content[0]!.text)![1]!;
			const laneResult = runtime.result({ runId, verbosity: "summary" }, { cwd: dir } as any).content[0]!.text;

			expect(laneResult).toContain("Child lane summary.");
			expect(laneResult).toContain("Acceptance: met");
			expect(laneResult).not.toContain("Inspectable lane launched and completed");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("stops runs and reports jump targets", () => {
		const dir = mkdtempSync(join(tmpdir(), "spawn-runtime-actions-"));
		try {
			const registry = new RunRegistry(() => 1000);
			const decision = admitRun(researchRequest("action"), getBudgetPolicy("balanced"));
			if (decision.action !== "start") throw new Error("expected start");
			const run = registry.createRun(decision.run, { backend: "headless", sessionPath: "/tmp/action.jsonl" });
			const ledger = new SpawnTraceLedger(dir);
			ledger.upsertRun(run);
			const runtime = new SpawnOrchestratorRuntime(fakePi());

			expect(runtime.jump({ runId: run.id }, { cwd: dir } as any).content[0]!.text).toContain(
				"pi --session '/tmp/action.jsonl'",
			);
			expect(runtime.stop({ runId: run.id }, { cwd: dir } as any).content[0]!.text).toContain("Stopped");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("result watcher", () => {
	test("tracks headless settlement without changing run records directly", async () => {
		const registry = new RunRegistry(() => 1000);
		const decision = admitRun(researchRequest("watch"), getBudgetPolicy("balanced"));
		if (decision.action !== "start") throw new Error("expected start");
		const run = registry.createRun(decision.run);
		const watcher = new ResultWatcher();
		let settled = false;

		watcher.watch(
			run,
			Promise.resolve().then(() => undefined),
			() => {
				settled = true;
			},
		);
		expect(watcher.snapshot(run.id)[0]).toMatchObject({ runId: run.id, status: "running" });
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(settled).toBe(true);
		expect(watcher.snapshot(run.id)[0]).toMatchObject({ runId: run.id, status: "settled" });
	});
});

function researchRequest(intent: string): RunRequest {
	return {
		originId: "origin-test",
		kind: "agent",
		profile: "research",
		intent,
		depth: 0,
		laneBackend: "headless",
		estimatedTokens: 10_000,
	};
}

function fakePi() {
	return {
		appendEntry() {},
		exec: async () => ({ code: 0, stdout: "", stderr: "" }),
	} as any;
}

function fakeModel(id: string, cost: number) {
	return {
		id,
		name: id,
		provider: "test",
		api: "openai-responses",
		baseUrl: "",
		reasoning: false,
		input: ["text"],
		cost: { input: cost, output: cost, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 100_000,
		maxTokens: 10_000,
	} as any;
}

function runRecordFixture(index: number) {
	return {
		id: `run-${index}`,
		originId: "origin-test",
		kind: "agent",
		profile: "research",
		intent: "fixture",
		status: "completed",
		depth: 0,
		budgetPreset: "balanced",
		modelTier: "balanced",
		editPolicy: "none",
		contextPolicy: "explicit",
		promptVisibility: "metadata",
		lane: { backend: "headless", jumpable: false, promotable: true },
		metrics: {},
		acceptance: { criteria: ["done"], status: "met", evidence: [], followUps: [], results: [] },
		artifacts: [],
		errors: [],
		createdAt: index,
		updatedAt: index,
	} as any;
}
