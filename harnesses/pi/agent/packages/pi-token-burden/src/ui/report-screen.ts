import type { KeybindingsManager, Theme } from "@earendil-works/pi-coding-agent";
import { Text, matchesKey, truncateToWidth, type Component } from "@earendil-works/pi-tui";
import {
	ComponentStack,
	TabBar,
	SelectableList,
	ProgressBar,
	applyScrollbar,
	sanitizeTuiText,
	tuiTheme,
} from "@luan.sh/pi-libtui";
import type { TokenBurdenReport } from "../core/report.ts";
import { REPORT_TABS, type ReportTab } from "../core/report-navigation.ts";
import { reportRows, type ReportRow } from "./report-rows.ts";

export interface ScreenHost {
	theme: Theme;
	keybindings: Pick<KeybindingsManager, "matches" | "getKeys">;
	requestRender(): void;
	height(): number;
	close(): void;
}

/** Local snapshot only. ComponentStack owns pointer routing for the shared controls. */
export class ReportScreen extends ComponentStack {
	private tab: ReportTab = "Overview";
	private readonly tabs: TabBar;
	private readonly list: SelectableList<ReportRow>;
	private detail: ReportRow | null = null;
	private offset = 0;
	private detailLines = 0;
	private bodyHeight = 10;
	private readonly heading: Component;
	private readonly footer: Component;
	private readonly reader: Component;
	private readonly summary: Component;
	private readonly empty: Component;
	private readonly progress: ProgressBar | null;

	constructor(
		private readonly report: TokenBurdenReport,
		private readonly host: ScreenHost,
	) {
		super();
		const colors = () => tuiTheme(host.theme);
		const line = (text: () => string, heading = false): Component => ({
			render: (width) => [
				truncateToWidth(
					colors().fg(heading ? "heading" : "text.secondary", sanitizeTuiText(text()).replace(/[\r\n]+/g, " ")),
					width,
					"",
				),
			],
			invalidate() {},
		});
		this.heading = line(() => `Token burden · ${this.detail?.label ?? this.tab} · read-only`, true);
		this.summary = line(() => this.summaryText());
		this.empty = line(() => `No ${this.tab.toLowerCase()} reported.`);
		this.footer = line(() => {
			const key = (id: Parameters<KeybindingsManager["getKeys"]>[0]) => host.keybindings.getKeys(id).join("/");
			return `${this.detail ? "" : "←/→ tabs · "}${key("tui.select.up")}/${key("tui.select.down")} ${this.detail ? "scroll" : "select"} · ${key("tui.select.confirm")} details · ${key("tui.select.cancel")} ${this.detail ? "back" : "close"}`;
		});
		this.tabs = new TabBar(
			REPORT_TABS.map((label) => ({ id: label, label })),
			host.theme,
		);
		this.tabs.onChange = (_tab, index) => {
			this.tab = REPORT_TABS[index] ?? "Overview";
			this.detail = null;
			this.list.setItems(reportRows(report, this.tab), 0);
			host.requestRender();
		};
		this.list = new SelectableList({
			items: reportRows(report, this.tab),
			wrap: false,
			requestRender: host.requestRender,
			renderItem: (row, context) =>
				colors().fg(
					context.selected ? "accent" : "text.primary",
					`${context.selected ? "> " : "  "}${sanitizeTuiText(row.label).replace(/[\r\n]+/g, " ")}`,
				),
			onActivate: (row) => this.open(row),
		});
		this.reader = {
			render: (width) => {
				const lines = new Text(colors().fg("text.primary", sanitizeTuiText(this.detail?.detail ?? "")), 0, 0).render(
					Math.max(1, width - 2),
				);
				this.detailLines = lines.length;
				this.offset = Math.min(this.offset, Math.max(0, lines.length - this.bodyHeight));
				return applyScrollbar(lines.slice(this.offset, this.offset + this.bodyHeight), {
					theme: host.theme,
					width,
					height: this.bodyHeight,
					offset: this.offset,
					total: lines.length,
				});
			},
			invalidate() {},
		};
		this.progress =
			report.context?.percent !== null && report.context?.percent !== undefined
				? new ProgressBar({
						theme: host.theme,
						value: report.context.percent / 100,
						label: "Context",
						showPercentage: true,
					})
				: null;
	}

	private summaryText(): string {
		if (this.detail)
			return `${this.offset + 1}–${Math.min(this.offset + this.bodyHeight, this.detailLines)} / ${this.detailLines} lines`;
		if (this.tab === "Tools") {
			const active = this.report.tools.filter((tool) => tool.active);
			return `${active.length}/${this.report.tools.length} active · active definitions ~${active.reduce((sum, tool) => sum + tool.estimate, 0)} tokens · all ~${this.report.tools.reduce((sum, tool) => sum + tool.estimate, 0)}`;
		}
		if (this.tab === "Usage")
			return "Recorded work, not current context · nested and summarization usage included when stored";
		if (this.tab === "Skills") return "Loaded skill metadata only · read-only · no skill bodies loaded";
		if (this.tab === "Prompt")
			return `~${this.report.promptTokens} tokens total · section rounding may differ · context files overlap`;
		return `${this.report.model ?? "Model unavailable"} · context ${this.report.context?.tokens ?? "unavailable"} / ${this.report.context?.contextWindow ?? "unavailable"}`;
	}

	private open(row: ReportRow): void {
		this.detail = row;
		this.offset = 0;
		this.host.requestRender();
	}

	override handleInput(data: string): void {
		const kb = this.host.keybindings;
		if (kb.matches(data, "tui.select.cancel")) {
			if (this.detail) {
				this.detail = null;
				this.host.requestRender();
			} else this.host.close();
			return;
		}
		if (!this.detail && this.tabs.handleInput(data)) return;
		const delta = kb.matches(data, "tui.select.down")
			? 1
			: kb.matches(data, "tui.select.up")
				? -1
				: kb.matches(data, "tui.select.pageDown")
					? this.bodyHeight
					: kb.matches(data, "tui.select.pageUp")
						? -this.bodyHeight
						: 0;
		if (this.detail) {
			this.offset = Math.max(0, Math.min(this.offset + delta, this.detailLines - this.bodyHeight));
			if (matchesKey(data, "home")) this.offset = 0;
			if (matchesKey(data, "end")) this.offset = Math.max(0, this.detailLines - this.bodyHeight);
		} else if (delta) this.list.setSelectedIndex(this.list.getSelectedIndex() + delta);
		else if (kb.matches(data, "tui.select.confirm")) {
			const row = this.list.getSelectedItem();
			if (row) this.open(row);
		}
		this.host.requestRender();
	}

	override render(width: number): string[] {
		const height = Math.max(1, this.host.height());
		const meter = !this.detail && this.tab === "Overview" && this.progress ? [this.progress] : [];
		this.bodyHeight = Math.max(1, height - 4 - meter.length);
		this.list.setMaxVisible(this.bodyHeight);
		this.setChildren([
			this.heading,
			this.tabs,
			this.summary,
			...meter,
			this.detail ? this.reader : this.list.getSelectedItem() ? this.list : this.empty,
			this.footer,
		]);
		return super
			.render(width)
			.slice(0, height)
			.map((row) => truncateToWidth(row, width, ""));
	}
}
