import {
	closeSync,
	copyFileSync,
	existsSync,
	mkdirSync,
	openSync,
	readFileSync,
	renameSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { RunRecord, TraceEvent } from "./types.ts";

const MAX_RUNS = 500;
const MAX_EVENTS = 1_000;
const MAX_PLANS = 100;
const MAX_WATCHERS = 200;

export interface DurableWatchSnapshot {
	runId: string;
	status: "running" | "settled";
	startedAt: number;
	settledAt?: number;
	error?: string;
}

export interface DurablePlanRecord {
	originId: string;
	mode: string;
	budget: string;
	complexity: string;
	needsEdits: boolean;
	needsResearch: boolean;
	steps: unknown[];
	runs: unknown[];
	timestamp: number;
}

export interface SpawnLedgerState {
	version: 1;
	updatedAt: number;
	runs: RunRecord[];
	events: TraceEvent[];
	plans: DurablePlanRecord[];
	watchers: DurableWatchSnapshot[];
}

export class SpawnTraceLedger {
	readonly path: string;
	private state?: SpawnLedgerState;

	constructor(readonly cwd: string) {
		this.path = join(resolve(cwd), ".pi", "spawn", "ledger.json");
	}

	load(): SpawnLedgerState {
		if (this.state) return this.state;
		this.state = this.read();
		return this.state;
	}

	upsertRun(run: RunRecord): void {
		this.update((state) => {
			upsertRunRecord(state, run);
			applyRetention(state);
		});
	}

	upsertRunAndEvents(run: RunRecord, events: TraceEvent[]): void {
		this.update((state) => {
			upsertRunRecord(state, run);
			state.events = dedupeEvents(events).sort((a, b) => a.timestamp - b.timestamp);
			applyRetention(state);
		});
	}

	replaceEvents(events: TraceEvent[]): void {
		this.update((state) => {
			state.events = dedupeEvents(events).sort((a, b) => a.timestamp - b.timestamp);
			applyRetention(state);
		});
	}

	upsertPlan(plan: Omit<DurablePlanRecord, "timestamp">): void {
		this.update((state) => {
			const record = { ...plan, timestamp: Date.now() };
			const index = state.plans.findIndex((item) => item.originId === plan.originId);
			if (index >= 0) state.plans[index] = record;
			else state.plans.push(record);
			applyRetention(state);
		});
	}

	saveWatchers(watchers: DurableWatchSnapshot[]): void {
		this.update((state) => {
			state.watchers = watchers;
			applyRetention(state);
		});
	}

	private update(mutator: (state: SpawnLedgerState) => void): void {
		this.withWriteLock(() => {
			const state = this.read();
			mutator(state);
			this.state = state;
			this.saveUnlocked(state);
		});
	}

	private read(): SpawnLedgerState {
		if (!existsSync(this.path)) return emptyLedgerState();
		try {
			const parsed = JSON.parse(readFileSync(this.path, "utf8")) as Partial<SpawnLedgerState>;
			return {
				version: 1,
				updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : Date.now(),
				runs: Array.isArray(parsed.runs) ? parsed.runs.filter(isRunRecord) : [],
				events: Array.isArray(parsed.events) ? parsed.events.filter(isTraceEvent) : [],
				plans: Array.isArray(parsed.plans) ? (parsed.plans as DurablePlanRecord[]) : [],
				watchers: Array.isArray(parsed.watchers) ? (parsed.watchers as DurableWatchSnapshot[]) : [],
			};
		} catch {
			this.backupCorruptLedger();
			return emptyLedgerState();
		}
	}

	private saveUnlocked(state: SpawnLedgerState): void {
		state.updatedAt = Date.now();
		mkdirSync(dirname(this.path), { recursive: true });
		const tmp = `${this.path}.${process.pid}.tmp`;
		writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, "utf8");
		renameSync(tmp, this.path);
	}

	private withWriteLock(operation: () => void): void {
		mkdirSync(dirname(this.path), { recursive: true });
		const lockPath = `${this.path}.lock`;
		for (let attempt = 0; attempt < 40; attempt++) {
			let fd: number | undefined;
			try {
				fd = openSync(lockPath, "wx");
				operation();
				return;
			} catch (error) {
				if (!isFileExistsError(error)) throw error;
				sleepSync(25);
			} finally {
				if (fd !== undefined) {
					closeSync(fd);
					unlinkSync(lockPath);
				}
			}
		}
		throw new Error(`Timed out waiting for Spawn ledger lock: ${lockPath}`);
	}

	private backupCorruptLedger(): void {
		try {
			const backup = `${this.path}.corrupt-${Date.now()}`;
			copyFileSync(this.path, backup);
		} catch {
			// Best-effort backup: loading must not make status unusable.
		}
	}
}

function emptyLedgerState(): SpawnLedgerState {
	return { version: 1, updatedAt: Date.now(), runs: [], events: [], plans: [], watchers: [] };
}

function dedupeEvents(events: TraceEvent[]): TraceEvent[] {
	const seen = new Set<string>();
	const deduped: TraceEvent[] = [];
	for (const event of events) {
		if (seen.has(event.id)) continue;
		seen.add(event.id);
		deduped.push(event);
	}
	return deduped;
}

function upsertRunRecord(state: SpawnLedgerState, run: RunRecord): void {
	const index = state.runs.findIndex((item) => item.id === run.id);
	if (index >= 0) state.runs[index] = run;
	else state.runs.push(run);
}

function applyRetention(state: SpawnLedgerState): void {
	state.runs = trimBy(state.runs, MAX_RUNS, (run) => run.updatedAt);
	state.events = trimBy(state.events, MAX_EVENTS, (event) => event.timestamp);
	state.plans = trimBy(state.plans, MAX_PLANS, (plan) => plan.timestamp);
	state.watchers = trimBy(state.watchers, MAX_WATCHERS, (watcher) => watcher.settledAt ?? watcher.startedAt);
}

function trimBy<T>(items: T[], max: number, key: (item: T) => number): T[] {
	if (items.length <= max) return items;
	return [...items].sort((a, b) => key(b) - key(a)).slice(0, max);
}

function isFileExistsError(error: unknown): boolean {
	return Boolean(error && typeof error === "object" && (error as { code?: unknown }).code === "EEXIST");
}

function sleepSync(ms: number): void {
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function isRunRecord(value: unknown): value is RunRecord {
	return Boolean(value && typeof value === "object" && typeof (value as RunRecord).id === "string");
}

function isTraceEvent(value: unknown): value is TraceEvent {
	return Boolean(value && typeof value === "object" && typeof (value as TraceEvent).id === "string");
}
