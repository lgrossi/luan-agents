import type { TokenEstimate, UsageRecord, UsageSummary } from "./report.ts";
import { emptyUsage } from "./report.ts";

export function summarizeUsage(records: UsageRecord[]): UsageSummary {
	const recorded = records.filter((record) => record.usage !== null);
	const totals: TokenEstimate | null = recorded.length ? emptyUsage() : null;
	if (totals)
		for (const { usage } of recorded) {
			if (!usage) continue;
			totals.input += usage.input;
			totals.output += usage.output;
			totals.cacheRead += usage.cacheRead;
			totals.cacheWrite += usage.cacheWrite;
			totals.total += usage.total;
			totals.cost += usage.cost;
		}
	return { records, totals, missing: records.length - recorded.length };
}
