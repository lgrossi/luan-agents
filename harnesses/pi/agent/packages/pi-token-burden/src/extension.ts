import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { collectReport } from "./runtime/collect-report.ts";
import { ReportScreen } from "./ui/report-screen.ts";
export default function tokenBurden(pi: ExtensionAPI): void {
	pi.registerCommand("token-burden", {
		description: "Open read-only token burden report",
		handler: async (_args, ctx) => {
			if (ctx.mode !== "tui" || !ctx.hasUI) return;
			const report = collectReport(pi, ctx);
			await ctx.ui.custom(
				(tui, theme, keybindings, done) =>
					new ReportScreen(report, {
						theme,
						keybindings,
						requestRender: () => tui.requestRender(),
						height: () => Math.max(1, tui.terminal.rows - 2),
						close: () => done(undefined),
					}),
			);
		},
	});
}
