import type { TokenBurdenReport, TokenEstimate, UsageSummary } from "../core/report.ts";
import type { ReportTab } from "../core/report-navigation.ts";

export interface ReportRow {
	label: string;
	detail: string;
}
export const money = (value: number | null): string => (value === null ? "unavailable" : `$${value.toFixed(6)}`);
export function usageText(usage: TokenEstimate | null): string {
	return usage
		? `Input ${usage.input} · output ${usage.output} · cache read ${usage.cacheRead} · cache write ${usage.cacheWrite}\nTotal ${usage.total} tokens · recorded cost ${money(usage.cost)}`
		: "Usage unavailable (no recorded usage)";
}
function summaryText(summary: UsageSummary): string {
	return `${usageText(summary.totals)}\n${summary.records.length} work records; ${summary.missing} unavailable. Totals cover recorded usage only.`;
}

export function reportRows(report: TokenBurdenReport, tab: ReportTab): ReportRow[] {
	switch (tab) {
		case "Overview":
			return [
				{
					label: `System prompt · ~${report.promptTokens} tokens`,
					detail:
						"Estimate: ceil(UTF-16 characters / 4). Not provider tokenization. Prompt sections and loaded context files are available in the Prompt tab. Tool definitions are separate; guidelines may already occur in the prompt.",
				},
				{
					label: `Current branch usage · ${report.usage.branch.totals?.total ?? "unavailable"}`,
					detail: summaryText(report.usage.branch),
				},
				{
					label: `Whole session usage · ${report.usage.session.totals?.total ?? "unavailable"}`,
					detail: summaryText(report.usage.session),
				},
				{
					label: `${report.commands.length} commands (excluding Pi built-ins)`,
					detail:
						report.commands.map((command) => `/${command.name} · ${command.source}\n${command.path}`).join("\n\n") ||
						"No commands reported.",
				},
				{
					label: "Attribution and measurement limits",
					detail:
						"Tool and command provenance comes from Pi sourceInfo. Context files are base prompt inputs, not additive attribution. Arbitrary prompt changes cannot be attributed to an extension via public APIs. Provider payload rewrites, hidden nested tool reach, image tokenization, and unreported LLM work are unavailable. Recorded usage is not a bill or a current context estimate. Reopen the report to refresh the snapshot.",
				},
			];
		case "Prompt":
			return [
				...report.promptSections.map((section) => ({
					label: `${section.label} · ~${section.estimate} tokens`,
					detail: section.content,
				})),
				...report.contextFiles.map((file) => ({
					label: `Context file: ${file.label} · ~${file.estimate} tokens`,
					detail: `Base input; overlaps the prompt above, do not add twice.\n\n${file.content}`,
				})),
			];
		case "Tools":
			return report.tools.map((tool) => ({
				label: `${tool.active ? "Active" : "Inactive"} · ${tool.name} · ~${tool.estimate} tokens · ${tool.branchCalls} calls`,
				detail: `${tool.name}\n${tool.description}\n\nReach: ${tool.active ? "active in Pi's current tool set" : "registered but inactive in Pi's current tool set"}. Nested/deferred/blocked reach is not exposed.\nSource: ${tool.source}\nDefinition ~${tool.estimate} tokens (parameters ~${tool.schemaEstimate}).\nHypothetical uncached input cost at current model rate: ${money(tool.inputCost)} per inclusion; not actual billing.\nBranch tool-call blocks: ${tool.branchCalls} (not proof of execution).\nGuidelines ~${tool.guidelineEstimate} tokens, separate from definition and potentially already in system prompt.\n${tool.guidelines.join("\n")}\n\nParameters:\n${tool.parameters}`,
			}));
		case "Usage":
			return [
				{ label: "Current branch totals", detail: summaryText(report.usage.branch) },
				{ label: "Whole session totals (all branches)", detail: summaryText(report.usage.session) },
				...report.usage.branch.records.map((record, index) => ({
					label: `${index + 1}. ${record.kind} · ${record.label} · ${record.usage?.total ?? "unavailable"}`,
					detail: `${record.id}\n${record.label}\n${usageText(record.usage)}`,
				})),
			];
		case "Skills":
			return report.skills.map((skill) => ({
				label: `${skill.name} · ${skill.modelInvocable ? "model-invocable" : "explicit invocation only"} · ~${skill.estimate} tokens`,
				detail: `${skill.name}\n${skill.description}\n\n${skill.filePath}\nSource: ${skill.source}\n${skill.modelInvocable ? "Included in base skill advertisement" : "Excluded from model skill advertisement; explicit invocation only"}.\nEstimate includes Pi's single-skill advertisement wrapper, not the skill file body. Per-skill estimates are not additive. This report does not load or execute skill files or change their configuration.`,
			}));
	}
}
