import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { CURSOR_MARKER, stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { tuiTheme } from "@luan-pi/pi-libtui";
import { defaultHighlightContributions } from "../src/contributions/default-highlights.ts";
import { fileIcon } from "../src/core/file-icons.ts";
import { atReferenceMatches, collectHighlightMatches, slashCommandMatch } from "../src/core/highlights.ts";
import { editorHighlightContributions, ensureEditorHighlightRegistry } from "../src/protocol/highlights.ts";
import { renderEditorHighlights } from "../src/ui/highlights.ts";

const theme = {
	name: "highlight-test",
	getColorMode: () => "truecolor",
	getFgAnsi: (token: string) =>
		token === "success" ? "\x1b[38;2;20;180;90m" : token === "error" ? "\x1b[38;2;220;60;60m" : "\x1b[38;2;90;140;220m",
	getBgAnsi: () => "\x1b[48;2;24;28;36m",
} as never as Theme;

function registry() {
	return ensureEditorHighlightRegistry(Object.create(null) as typeof globalThis);
}

describe("default editor highlight matching", () => {
	test("resolves paths from the active cwd and combines Pi and built-in commands", () => {
		const cwd = mkdtempSync(join(tmpdir(), "pi-custom-editor-highlights-"));
		mkdirSync(join(cwd, "folder"));
		writeFileSync(join(cwd, "file.ts"), "ok");
		const contributions = defaultHighlightContributions(
			{
				getCommands: () => [{ name: "extension-command", source: "extension", sourceInfo: { path: "test" } }],
			} as never,
			() => ({ cwd }) as never,
		);
		const files = contributions[0];
		const commands = contributions[1];

		const fileMatches = files?.matches({ text: "@file.ts @folder @missing", line: 0, promptLine: 0 });
		expect(fileMatches?.map((match) => [match.start, match.end, match.presentation.kind])).toEqual([
			[0, 8, "pill"],
			[9, 16, "pill"],
			[17, 25, "pill"],
		]);
		expect(fileMatches?.[0]?.presentation).toMatchObject({
			label: "file.ts",
			icon: { glyph: "" },
			minimumCursorGap: 1,
		});
		expect(fileMatches?.[1]?.presentation).toMatchObject({ label: "folder", icon: { glyph: "" } });
		expect(fileMatches?.[2]?.presentation).toMatchObject({ foreground: "negative", iconTone: "negative" });
		expect(commands?.matches({ text: "/model", line: 0, promptLine: 0 })[0]?.presentation).toEqual({
			kind: "foreground",
			color: "positive",
		});
		expect(commands?.matches({ text: "/extension-command", line: 0, promptLine: 0 })[0]?.presentation).toEqual({
			kind: "foreground",
			color: "positive",
		});
		expect(commands?.matches({ text: "/unknown", line: 0, promptLine: 0 })[0]?.presentation).toEqual({
			kind: "foreground",
			color: "negative",
		});
	});

	test("classifies file and directory references anywhere without treating email as a reference", () => {
		const existing = new Set(["src/file.ts", "src"]);
		const matches = atReferenceMatches("read @src/file.ts and @src but mail a@b.test then @missing", (path) =>
			existing.has(path),
		);

		expect(matches.map((match) => [match.start, match.end, match.presentation])).toEqual([
			[5, 17, { kind: "foreground", color: "positive" }],
			[22, 26, { kind: "foreground", color: "positive" }],
			[50, 58, { kind: "foreground", color: "negative" }],
		]);
	});

	test("supports quoted paths", () => {
		const matches = atReferenceMatches(
			'open @"folder with spaces/file.md"',
			(path) => path === "folder with spaces/file.md",
		);
		expect(matches).toEqual([
			{
				start: 5,
				end: 34,
				presentation: { kind: "foreground", color: "positive" },
			},
		]);
	});

	test("uses devicons for common file types and a generic fallback", () => {
		expect(fileIcon("src/main.ts", false).glyph).toBe("");
		expect(fileIcon("src/main.rs", false).glyph).toBe("");
		expect(fileIcon("assets", true).glyph).toBe("");
		expect(fileIcon("NOTICE", false).glyph).toBe("");
	});

	test("classifies only a command at the beginning of the first prompt line", () => {
		const known = new Set(["model", "skill:write"]);
		expect(slashCommandMatch({ text: "  /model openai", line: 1, promptLine: 1 }, known)[0]?.presentation).toEqual({
			kind: "foreground",
			color: "positive",
		});
		expect(slashCommandMatch({ text: "/missing", line: 1, promptLine: 1 }, known)[0]?.presentation).toEqual({
			kind: "foreground",
			color: "negative",
		});
		expect(slashCommandMatch({ text: "say /model", line: 1, promptLine: 1 }, known)).toEqual([]);
		expect(slashCommandMatch({ text: "/model", line: 2, promptLine: 1 }, known)).toEqual([]);
		expect(slashCommandMatch({ text: "/tmp/file", line: 1, promptLine: 1 }, known)).toEqual([]);
	});
});

describe("editor highlight capability", () => {
	test("is versioned, ordered, reload-safe, and rejects overlapping lower-priority matches", () => {
		const highlights = registry();
		const removeLow = highlights.register({
			id: "low",
			priority: 1,
			matches: () => [{ start: 0, end: 2, presentation: { kind: "foreground", color: "negative" } }],
		});
		const staleRemove = highlights.register({ id: "same", matches: () => [] });
		const removeCurrent = highlights.register({ id: "same", priority: 2, matches: () => [] });
		const removeHigh = highlights.register({
			id: "high",
			priority: 10,
			matches: () => [{ start: 1, end: 3, presentation: { kind: "foreground", color: "positive" } }],
		});

		expect(highlights.protocol).toBe("pi-custom-editor/highlights/v1");
		expect(highlights.version).toBe(1);
		expect(editorHighlightContributions(highlights).map((entry) => entry.id)).toEqual(["high", "same", "low"]);
		expect(
			collectHighlightMatches(editorHighlightContributions(highlights), { text: "abcd", line: 0, promptLine: 0 }),
		).toEqual([{ start: 1, end: 3, presentation: { kind: "foreground", color: "positive" } }]);
		staleRemove();
		expect(editorHighlightContributions(highlights).map((entry) => entry.id)).toContain("same");
		removeCurrent();
		removeHigh();
		removeLow();
		expect(editorHighlightContributions(highlights)).toEqual([]);
	});
});

describe("editor highlight rendering", () => {
	test("preserves native cursor control sequences and wrapping width while applying semantic foreground", () => {
		const highlights = registry();
		highlights.register({
			id: "reference",
			matches: ({ text }) => atReferenceMatches(text, () => true),
		});
		const source = `before @fi${CURSOR_MARKER}\x1b[7ml\x1b[0me.ts after`;
		const [rendered = ""] = renderEditorHighlights([source], 40, theme, highlights);

		expect(stripTerminalSequences(rendered)).toBe("before @file.ts after");
		expect(rendered).toContain(CURSOR_MARKER);
		expect(rendered).toContain("\x1b[7m");
		expect(rendered).toContain(tuiTheme(theme).fgAnsi("positive"));
		expect(visibleWidth(rendered)).toBeLessThanOrEqual(40);
	});

	test("renders a subdued contribution pill only after whitespace separates it from the cursor", () => {
		const highlights = registry();
		highlights.register({
			id: "skill",
			matches: ({ text }) => {
				const start = text.indexOf("@write");
				return start < 0
					? []
					: [
							{
								start,
								end: start + 6,
								presentation: {
									kind: "pill",
									label: "write",
									icon: "lightbulb",
									iconTone: "accent",
									foreground: "positive",
									minimumCursorGap: 1,
								},
							},
						];
			},
		});
		const [pill = ""] = renderEditorHighlights([`use @write ${CURSOR_MARKER}\x1b[7mn\x1b[0mow`], 40, theme, highlights);
		const [pillBefore = ""] = renderEditorHighlights(
			[`${CURSOR_MARKER}\x1b[7m \x1b[0m@write now`],
			40,
			theme,
			highlights,
		);
		const [adjacent = ""] = renderEditorHighlights(
			[`use @write${CURSOR_MARKER}\x1b[7m \x1b[0m`],
			40,
			theme,
			highlights,
		);
		const [editing = ""] = renderEditorHighlights(
			[`use @wr${CURSOR_MARKER}\x1b[7mi\x1b[0mte now`],
			40,
			theme,
			highlights,
		);

		expect(stripTerminalSequences(pill)).toContain("💡 write");
		expect(stripTerminalSequences(pillBefore)).toContain("💡 write");
		expect(stripTerminalSequences(pill)).not.toContain("@write");
		expect(stripTerminalSequences(adjacent)).toContain("@write");
		expect(stripTerminalSequences(adjacent)).not.toContain("💡 write");
		expect(stripTerminalSequences(editing)).toContain("@write");
		expect(editing).toContain(CURSOR_MARKER);
		expect(editing).toContain(tuiTheme(theme).fgAnsi("positive"));
		expect(pill).toContain(tuiTheme(theme).fgAnsi("accent"));
		const pillBackgrounds = [...pill.matchAll(/\x1b\[48;2;\d+;\d+;\d+m/gu)].map((match) => match[0]);
		expect(pillBackgrounds).toContain("\x1b[48;2;37;50;73m");
		expect(pillBackgrounds).not.toContain("\x1b[48;2;68;71;78m");
	});

	test("uses the first native editor row, not the border, as the slash-command prompt beginning", () => {
		const highlights = registry();
		highlights.register({
			id: "commands",
			matches: (context) => slashCommandMatch(context, new Set(["model"])),
		});
		const lines = renderEditorHighlights(["────────", "/model ", "────────", "/missing"], 20, theme, highlights);

		expect(lines[1]).toContain(tuiTheme(theme).fgAnsi("positive"));
		expect(lines[3]).not.toContain(tuiTheme(theme).fgAnsi("negative"));
	});

	test("does not apply contributions inside inline or fenced Markdown code", () => {
		const highlights = registry();
		highlights.register({
			id: "skill",
			matches: ({ text }) =>
				[...text.matchAll(/\$known/gu)].map((match) => ({
					start: match.index,
					end: match.index + match[0].length,
					presentation: { kind: "foreground" as const, color: "positive" as const },
				})),
		});
		const lines = renderEditorHighlights(
			["`$known` then $known", "```", "$known", "```", "$known"],
			40,
			theme,
			highlights,
		);
		const positive = tuiTheme(theme).fgAnsi("positive");

		expect(lines[0]?.split(" then ")[0]).not.toContain(positive);
		expect(lines[0]?.split(" then ")[1]).toContain(positive);
		expect(lines[2]).not.toContain(positive);
		expect(lines[4]).toContain(positive);
	});
});
