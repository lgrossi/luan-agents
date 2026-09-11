import { afterEach, expect, test } from "bun:test";
import { AssistantMessageComponent, initTheme, ToolExecutionComponent } from "@earendil-works/pi-coding-agent";
import { Container, ProcessTerminal, Text, TuiAltScreen, visibleWidth } from "@earendil-works/pi-tui";
import { configureTuiAppearance, DEFAULT_TUI_APPEARANCE, sharedMotionScheduler } from "pi-libtui";
import { mountTranscriptProjection, type TranscriptEntry } from "pi-libtui/tool";
import type { TuiMouseEvent } from "pi-libtui/mouse";
import { theme } from "../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js";
import { ActivityTranscript, activitySummary } from "../src/activity-transcript.ts";

initTheme("dark", false);
afterEach(() => configureTuiAppearance(DEFAULT_TUI_APPEARANCE));

class TestTui extends TuiAltScreen {
	requestRender(): void {}
}

function message(content: Parameters<AssistantMessageComponent["updateContent"]>[0]["content"]) {
	return {
		role: "assistant" as const,
		content,
		api: "openai-responses" as const,
		provider: "openai",
		model: "test",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "toolUse" as const,
		timestamp: 0,
	};
}

function fixture() {
	configureTuiAppearance({ activityIndicator: "static", textEffect: "off" });
	const tui = new TestTui(new ProcessTerminal());
	const document = new Container();
	const chat = new Container();
	document.addChild(new Container());
	document.addChild(new Container());
	document.addChild(chat);
	tui.addChild(document);
	let projection: ActivityTranscript | undefined;
	const unmount = mountTranscriptProjection(tui, (entries) => {
		projection = new ActivityTranscript(entries, theme, () => {});
		return projection;
	});
	if (!unmount || !projection) throw new Error("Expected a mounted transcript");
	return { tui, document, chat, projection, unmount };
}

function lines(component: { render(width: number): string[] }, width = 80): string[] {
	return component.render(width).map((line) => Bun.stripANSI(line).trimEnd());
}
function click(projection: ActivityTranscript, row: number): void {
	const event: TuiMouseEvent = {
		type: "press",
		row,
		col: 2,
		screenRow: row,
		screenCol: 2,
		button: 0,
		wheel: undefined,
		shift: false,
		alt: false,
		ctrl: false,
	};
	expect(projection.onMouse(event)).toBe(true);
	expect(projection.onMouse({ ...event, type: "release" })).toBe(true);
}

test("native thinking and tool rows collapse together and expand with their original content", () => {
	const f = fixture();
	const thought = new AssistantMessageComponent(
		message([{ type: "thinking", thinking: "**Inspect source**\n\nDetailed reasoning." }]),
	);
	const tool = new ToolExecutionComponent(
		"exec_command",
		"one",
		{ cmd: "cat file" },
		undefined,
		undefined,
		f.tui,
		"/tmp",
	);
	tool.markExecutionStarted();
	tool.updateResult({ content: [{ type: "text", text: "original output" }], isError: false });
	f.chat.addChild(thought);
	f.chat.addChild(tool);
	const compact = lines(f.document);
	expect(compact.filter(Boolean)).toHaveLength(1);
	expect(compact.join("\n")).toContain("exec_command: cat file");
	expect(compact.join("\n")).toContain("2 steps");
	expect(compact.join("\n")).not.toContain("Detailed reasoning.");
	expect(compact.join("\n")).not.toContain("original output");
	click(f.projection, 1);
	const expanded = lines(f.document).join("\n");
	expect(expanded).toContain("Detailed reasoning.");
	expect(expanded).toContain("original output");
	click(f.projection, 1);
	expect(lines(f.document).filter(Boolean)).toHaveLength(1);
	f.unmount();
	expect(f.document.children[2]).toBe(f.chat);
	expect(lines(f.document).join("\n")).toContain("original output");
});

test("streamed updates retain expansion and update the latest thinking heading", () => {
	const f = fixture();
	const thought = new AssistantMessageComponent();
	const source = message([{ type: "thinking", thinking: "**First step**\n\nDetails." }]);
	thought.updateContent(source, true);
	f.chat.addChild(thought);
	expect(lines(f.document).join("\n")).toContain("First step");
	click(f.projection, 1);
	// Pi may reuse the same streamed message object.
	source.content = [{ type: "thinking", thinking: "**Second step**\n\nMore detail." }];
	thought.updateContent(source, true);
	const updated = lines(f.document).join("\n");
	expect(updated).toContain("Second step");
	expect(updated).toContain("More detail.");
	thought.updateContent(source, false);
	expect(lines(f.document).join("\n")).not.toContain("●");
	f.unmount();
});

test("prose stays visible and separates folds; failure counts survive collapse", () => {
	const f = fixture();
	f.chat.addChild(
		new AssistantMessageComponent(
			message([
				{ type: "thinking", thinking: "**Check files**\n\nLonger thought." },
				{ type: "text", text: "Here is my answer." },
			]),
		),
	);
	const tool = new ToolExecutionComponent("build", "one", {}, undefined, undefined, f.tui, "/tmp");
	tool.updateResult({ content: [{ type: "text", text: "build failure details" }], isError: true });
	f.chat.addChild(tool);
	const compact = lines(f.document).join("\n");
	expect(compact).toContain("Here is my answer.");
	expect(compact).toContain("Check files");
	expect(compact).toContain("1 failed");
	expect(compact).not.toContain("Longer thought.");
	expect(compact).not.toContain("build failure details");
	f.unmount();
});

test("retains unknown nodes and native error notices; detach stops animation without owning native tools", () => {
	const mounts = sharedMotionScheduler.activeMountCount;
	const f = fixture();
	f.chat.addChild(new Text("unknown notice", 0, 0));
	const failed = new AssistantMessageComponent({
		...message([{ type: "thinking", thinking: "Interrupted thought" }]),
		stopReason: "error",
		errorMessage: "network failed",
	});
	f.chat.addChild(failed);
	const tool = new ToolExecutionComponent("build", "one", {}, undefined, undefined, f.tui, "/tmp");
	tool.markExecutionStarted();
	f.chat.addChild(tool);
	const rendered = lines(f.document).join("\n");
	expect(rendered).toContain("unknown notice");
	expect(rendered).toContain("network failed");
	f.unmount();
	expect(sharedMotionScheduler.activeMountCount).toBe(mounts);
	expect(f.chat.children).toContain(tool);
});

test("unsupported roots and duplicate mounts leave the host unchanged", () => {
	const tui = new TestTui(new ProcessTerminal());
	expect(
		mountTranscriptProjection(tui, () => {
			throw new Error("must not run");
		}),
	).toBeUndefined();
	const f = fixture();
	expect(
		mountTranscriptProjection(f.tui, () => {
			throw new Error("must not run");
		}),
	).toBeUndefined();
	f.unmount();
	const release = mountTranscriptProjection(f.tui, (entries) => new ActivityTranscript(entries, theme, () => {}));
	expect(release).toBeDefined();
	release?.();
});

test("summary uses the latest supplied heading, bounds text and strips control sequences", () => {
	const part: TranscriptEntry = {
		kind: "thinking",
		key: {},
		component: new Container(),
		running: false,
		failed: false,
		summary: "**Old**\n\nPrior.\n\n**Latest**\n\nCurrent.",
	};
	expect(activitySummary(part)).toBe("Latest");
	const text = activitySummary({ ...part, summary: `\x1b]52;c;secret\x07${"word ".repeat(1000)}` });
	expect(text).not.toContain("\x1b");
	expect(text.length).toBeLessThanOrEqual(241);
	const transcript = new ActivityTranscript(
		() => [part],
		theme,
		() => {},
	);
	for (const width of [1, 2, 8, 40])
		expect(transcript.render(width).every((row) => visibleWidth(row) <= width)).toBe(true);
	transcript.dispose();
});
