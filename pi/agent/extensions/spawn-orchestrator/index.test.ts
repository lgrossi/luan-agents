import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { admitRun, applyAdmission, emptySchedulerSnapshot, getBudgetPolicy } from "./budget.ts";
import { formatResult, formatStatus, SpawnOrchestratorRuntime } from "./extension.ts";
import { buildHeadlessResourceLoaderOptions } from "./headless-runner.ts";
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
	} as any;
}
