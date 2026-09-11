import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { mountTranscriptProjection } from "pi-libtui/tool";
import { ActivityTranscript } from "./activity-transcript.ts";

export default function transcriptExtension(pi: ExtensionAPI): void {
	let unmount: (() => void) | undefined;
	pi.on("session_start", (_event, ctx) => {
		unmount?.();
		unmount = undefined;
		if (!ctx.hasUI || ctx.mode !== "tui") return;
		ctx.ui.setWidget("pi-transcript.host", (tui, theme) => {
			unmount?.();
			const release = mountTranscriptProjection(
				tui,
				(entries) => new ActivityTranscript(entries, theme, () => tui.requestRender()),
			);
			unmount = release;
			return {
				render: () => [],
				invalidate() {},
				dispose: () => {
					release?.();
					if (unmount === release) unmount = undefined;
				},
			};
		});
	});
	pi.on("session_shutdown", (_event, ctx) => {
		unmount?.();
		unmount = undefined;
		if (ctx.hasUI && ctx.mode === "tui") ctx.ui.setWidget("pi-transcript.host", undefined);
	});
}
