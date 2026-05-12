import type { RunRecord } from "./types.ts";

export interface WatchSnapshot {
	runId: string;
	status: "running" | "settled";
	startedAt: number;
	settledAt?: number;
	error?: string;
}

export class ResultWatcher {
	private readonly watched = new Map<string, WatchSnapshot>();

	watch(run: RunRecord, promise: Promise<void>, onSettle: () => void): void {
		const startedAt = Date.now();
		this.watched.set(run.id, { runId: run.id, status: "running", startedAt });
		promise
			.catch((error) => {
				const message = error instanceof Error ? error.message : String(error);
				this.watched.set(run.id, {
					runId: run.id,
					status: "settled",
					startedAt,
					settledAt: Date.now(),
					error: message,
				});
			})
			.finally(() => {
				const current = this.watched.get(run.id);
				if (current?.status === "running") {
					this.watched.set(run.id, { ...current, status: "settled", settledAt: Date.now() });
				}
				onSettle();
			});
	}

	snapshot(runId?: string): WatchSnapshot[] {
		const values = [...this.watched.values()];
		return runId ? values.filter((item) => item.runId === runId) : values;
	}

	forgetSettled(): void {
		for (const [id, snapshot] of this.watched) {
			if (snapshot.status === "settled") this.watched.delete(id);
		}
	}
}
