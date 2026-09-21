import { describe, expect, test } from "bun:test";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { KeybindingsManager, TUI_KEYBINDINGS, stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { collectReport } from "../src/runtime/collect-report.ts";
import { ReportScreen } from "../src/ui/report-screen.ts";
import { reportRows } from "../src/ui/report-rows.ts";
import { fixture } from "./fixtures.ts";

const theme = {
	bold: (text: string) => text,
	fg: (_color: string, text: string) => text,
	bg: (_color: string, text: string) => text,
} as Theme;
function screen() {
	const { pi, ctx } = fixture();
	const report = collectReport(pi, ctx);
	let closed = false;
	let height = 20;
	const view = new ReportScreen(report, {
		theme,
		keybindings: new KeybindingsManager(TUI_KEYBINDINGS, { "tui.select.cancel": "ctrl+x", "tui.select.down": "j" }),
		requestRender() {},
		height: () => height,
		close: () => {
			closed = true;
		},
	});
	return {
		report,
		view,
		closed: () => closed,
		resize: (rows: number) => {
			height = rows;
		},
		text: () => stripTerminalSequences(view.render(120).join("\n")),
	};
}

describe("report UI", () => {
	test("renders measured context and useful tab content", () => {
		const { view, text } = screen();
		expect(text()).toContain("500 / 1000");
		expect(text()).toContain("50%");
		view.handleInput("\x1b[C");
		expect(text()).toContain("Context file: /AGENTS.md");
		view.handleInput("\x1b[C");
		expect(text()).toContain("1/2 active");
		expect(text()).toContain("Inactive");
		view.handleInput("\x1b[C");
		expect(text()).toContain("nested tool");
		view.handleInput("\x1b[C");
		expect(text()).toContain("explicit invocation only");
	});
	test("uses injected remapped navigation and cancellation, preserving selection on back", () => {
		const { view, text, closed } = screen();
		view.handleInput("j");
		view.handleInput("\r");
		expect(text()).toContain("Total 300 tokens");
		view.handleInput("\x1b");
		expect(closed()).toBe(false);
		view.handleInput("\x18");
		expect(text()).toContain("> Current branch usage");
		view.handleInput("\x18");
		expect(closed()).toBe(true);
	});
	test("bounds rendering at narrow widths and terminal heights", () => {
		const { view, resize } = screen();
		for (const width of [1, 8, 30, 120])
			for (const height of [1, 8, 24]) {
				resize(height);
				const lines = view.render(width);
				expect(lines.length).toBeLessThanOrEqual(height);
				expect(lines.every((line) => visibleWidth(line) <= width)).toBe(true);
			}
	});
	test("details scroll to the end of long prompt sections", () => {
		const { report, view, text } = screen();
		report.promptSections = [
			{ label: "Long", estimate: 100, content: Array.from({ length: 100 }, (_, index) => `line ${index}`).join("\n") },
		];
		view.handleInput("\x1b[C");
		view.handleInput("\r");
		expect(text()).toContain("line 0");
		view.handleInput("\x1b[F");
		expect(text()).toContain("line 99");
	});
	test("empty/unavailable states are visible and skill/tool details explain limits", () => {
		const { report } = screen();
		expect(reportRows(report, "Tools")[0]?.detail).toContain("not actual billing");
		expect(reportRows(report, "Skills")[0]?.detail).toContain("does not load or execute");
		report.context = null;
		report.skills = [];
		const view = new ReportScreen(report, {
			theme,
			keybindings: new KeybindingsManager(TUI_KEYBINDINGS),
			requestRender() {},
			height: () => 24,
			close() {},
		});
		expect(stripTerminalSequences(view.render(120).join("\n"))).toContain("context unavailable");
		view.handleInput("\x1b[D");
		expect(stripTerminalSequences(view.render(120).join("\n"))).toContain("No skills reported");
	});
});
