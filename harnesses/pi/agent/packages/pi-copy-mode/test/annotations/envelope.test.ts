import { describe, expect, test } from "bun:test";
import { AnnotationStore } from "../../src/annotations/core/store.ts";
import { parseEnvelope, projectEnvelope, serializeEnvelope } from "../../src/annotations/core/envelope.ts";
import type { AnnotationSelection } from "../../src/annotations/core/types.ts";

const selection: AnnotationSelection = {
	messageId: "m",
	messageIdStability: "stable",
	text: "Codex annotation",
	shape: "line",
	start: { row: 0, col: 0 },
	end: { row: 0, col: 16 },
	screenStart: { row: 0, col: 0 },
	screenEnd: { row: 0, col: 16 },
};

describe("response annotation envelope", () => {
	test("serializes the exact Codex-compatible scaffolding", () => {
		const store = new AnnotationStore();
		store.add(selection, "this is one");
		const text = serializeEnvelope(store.get(), "Please revise.");
		expect(text).toStartWith(
			"# Response annotations:\nEach item contains text selected from an earlier response and may include a user comment.\n<response-annotations>\n[",
		);
		expect(text).toEndWith("</response-annotations>\n\n## My request:\nPlease revise.");
		expect(parseEnvelope(text)).toEqual({
			annotations: [{ text: "Codex annotation", annotation: "this is one" }],
			request: "Please revise.",
		});
	});

	test("serializes reaction-created annotations as ordinary annotation text", () => {
		const store = new AnnotationStore();
		store.add(selection, "🔍 Verify");
		expect(parseEnvelope(serializeEnvelope(store.get(), ""))?.annotations[0]?.annotation).toBe("🔍 Verify");
	});

	test("projects stored scaffolding to expanded readable content", () => {
		const store = new AnnotationStore();
		store.add(selection, "line one\nline two");
		store.add({ ...selection, text: "editor" }, "👍 Looks good");
		expect(projectEnvelope(serializeEnvelope(store.get(), "Ordinary"))).toBe(
			"Ordinary\n\n[annotation #1]\nSelected text: “Codex annotation”\nComment: line one\nline two\n\n[annotation #2]\nSelected text: “editor”\nComment: 👍 Looks good",
		);
	});

	test("accepts pill renderers for expanded user-message headers", () => {
		const store = new AnnotationStore();
		store.add(selection, "note");
		expect(
			projectEnvelope(serializeEnvelope(store.get(), "request"), (_annotation, index) => `PILL-${index}`),
		).toContain("PILL-1\nSelected text:");
	});

	test("accepts a tree-edited empty request after trailing newline trimming", () => {
		const store = new AnnotationStore();
		store.add(selection, "note");
		const edited = serializeEnvelope(store.get(), "").trimEnd();
		expect(edited).toEndWith("## My request:");
		expect(parseEnvelope(edited)).toEqual({
			annotations: [{ text: "Codex annotation", annotation: "note" }],
			request: "",
		});
		expect(projectEnvelope(edited)).toContain("[annotation #1]\nSelected text:");
	});

	test("leaves malformed and ordinary messages untouched", () => {
		expect(parseEnvelope("# Response annotations:\nnope")).toBeUndefined();
		expect(projectEnvelope("ordinary")).toBe("ordinary");
	});
});
