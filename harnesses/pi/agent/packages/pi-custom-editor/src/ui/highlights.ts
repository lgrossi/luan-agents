import type { Theme } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, truncateToWidth } from "@earendil-works/pi-tui";
import { backgroundAnsiAtColumn, contrastingPillBackground, markdownCodeRanges, renderPill, tuiTheme } from "pi-libtui";
import { collectHighlightMatches } from "../core/highlights.ts";
import {
	type EditorHighlightMatch,
	type EditorHighlightRegistry,
	editorHighlightContributions,
} from "../protocol/highlights.ts";

const ANSI = /\x1b(?:\[[0-?]*[ -/]*[@-~]|[\]_][^\x07]*(?:\x07|\x1b\\))/gu;
const CURSOR_MARKER = "\x1b_pi:c\x07";

interface IndexedLine {
	plain: string;
	rawOffsets: number[];
	cursor?: number;
}

function indexLine(line: string): IndexedLine {
	const cursorRaw = line.indexOf(CURSOR_MARKER);
	const cursor = cursorRaw < 0 ? undefined : stripTerminalSequences(line.slice(0, cursorRaw)).length;
	let plain = "";
	const rawOffsets = [0];
	let raw = 0;
	for (const match of line.matchAll(ANSI)) {
		const index = match.index ?? raw;
		for (let offset = raw; offset < index; offset += 1) {
			plain += line[offset];
			rawOffsets.push(offset + 1);
		}
		raw = index + match[0].length;
		rawOffsets[rawOffsets.length - 1] = raw;
	}
	for (let offset = raw; offset < line.length; offset += 1) {
		plain += line[offset];
		rawOffsets.push(offset + 1);
	}
	return { plain, rawOffsets, ...(cursor === undefined ? {} : { cursor }) };
}

function cursorHasGap(indexed: IndexedLine, match: EditorHighlightMatch, minimumGap: number): boolean {
	const cursor = indexed.cursor;
	if (cursor === undefined || minimumGap <= 0) return true;
	if (cursor >= match.start && cursor <= match.end) return false;
	const between =
		cursor < match.start ? indexed.plain.slice(cursor, match.start) : indexed.plain.slice(match.end, cursor);
	return [...between].filter((character) => /\s/u.test(character)).length >= minimumGap;
}

function foreground(line: string, indexed: IndexedLine, match: EditorHighlightMatch, theme: Theme): string {
	if (match.presentation.kind !== "foreground") return line;
	const start = indexed.rawOffsets[match.start];
	const end = indexed.rawOffsets[match.end];
	if (start === undefined || end === undefined) return line;
	const color = tuiTheme(theme).fgAnsi(match.presentation.color);
	const body = line.slice(start, end).replace(/\x1b\[[0-9;]*m/gu, (sequence) => `${sequence}${color}`);
	return `${line.slice(0, start)}${color}${body}\x1b[39m${line.slice(end)}`;
}

function pill(line: string, indexed: IndexedLine, match: EditorHighlightMatch, theme: Theme): string {
	if (match.presentation.kind !== "pill") return line;
	const start = indexed.rawOffsets[match.start];
	const end = indexed.rawOffsets[match.end];
	if (start === undefined || end === undefined) return line;
	const source = line.slice(start, end);
	// An editable multi-cell token cannot become one pill while its native cursor
	// remains addressable. Keep the text and use the requested semantic tone.
	if (
		source.includes(CURSOR_MARKER) ||
		source.includes("\x1b[7m") ||
		!cursorHasGap(indexed, match, match.presentation.minimumCursorGap ?? 0)
	) {
		return foreground(
			line,
			indexed,
			{
				...match,
				presentation: { kind: "foreground", color: match.presentation.foreground ?? "accent" },
			},
			theme,
		);
	}
	const destination = backgroundAnsiAtColumn(line, match.start);
	const colors = tuiTheme(theme);
	const contrast = contrastingPillBackground(theme, destination);
	const background = colors.mixForeground(colors.contrastBackground(contrast), contrast, 0.2);
	const rendered = renderPill(
		theme,
		{ icon: match.presentation.icon, iconTone: match.presentation.iconTone, label: match.presentation.label },
		background,
		match.presentation.foreground ?? "text.primary",
		undefined,
		destination,
	);
	return `${line.slice(0, start)}${rendered}${line.slice(end)}`;
}

function promptLine(lines: readonly string[]): number {
	const border = /^(?:─+|─── [↑↓] \d+ more (?:─+|\.{1,3}))$/u;
	const first = lines.findIndex((line) => !border.test(stripTerminalSequences(line).trim()));
	return first < 0 ? 0 : first;
}

export function renderEditorHighlights(
	lines: readonly string[],
	width: number,
	theme: Theme,
	registry: EditorHighlightRegistry,
): string[] {
	const contributions = editorHighlightContributions(registry);
	if (contributions.length === 0) return [...lines];
	const firstPromptLine = promptLine(lines);
	const sourceLines = lines.map(indexLine);
	const excludedRanges = markdownCodeRanges(sourceLines.map(({ plain }) => plain));
	return lines.map((line, lineIndex) => {
		let rendered = line;
		let indexed = indexLine(rendered);
		const matches = collectHighlightMatches(contributions, {
			text: indexed.plain,
			line: lineIndex,
			promptLine: firstPromptLine,
			excludedRanges: excludedRanges[lineIndex] ?? [],
		});
		for (const match of [...matches].reverse()) {
			rendered =
				match.presentation.kind === "pill"
					? pill(rendered, indexed, match, theme)
					: foreground(rendered, indexed, match, theme);
			indexed = indexLine(rendered);
		}
		return truncateToWidth(rendered, Math.max(1, width), "");
	});
}
