import type { Theme } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import {
	backgroundAnsiAtColumn,
	contrastingPillBackground,
	markdownCodeRanges,
	renderPill,
	renderPillText,
	tuiTheme,
} from "pi-libtui";
import type { SkillReference } from "../skills.ts";

const SKILL_REFERENCE = /(?:^|\s)(\$[a-zA-Z][\w-]*(?::[\w-]+)*)/gu;
const MARKER_PREFIX = "pi-skills:transcript:";
const MARKER_CLOSE = `\x1b_${MARKER_PREFIX}\x07`;
const MARKER_OPEN = /\x1b_pi-skills:transcript:([^\x07\x1b]+)\x07/gu;
const MARKER_SEQUENCE = /\x1b_pi-skills:transcript:[^\x07\x1b]*\x07/gu;

function pillContent(label: string) {
	return { icon: "lightbulb" as const, iconTone: "accent" as const, label };
}

function overlaps(start: number, end: number, ranges: readonly { readonly start: number; readonly end: number }[]) {
	return ranges.some((range) => start < range.end && range.start < end);
}

/** Replace known skill references with inert pill markers before Pi parses Markdown. */
export function projectSkillTranscript(markdown: string, skills: ReadonlyMap<string, SkillReference>): string {
	const lines = markdown.split("\n");
	const excluded = markdownCodeRanges(lines);
	return lines
		.map((line, lineIndex) => {
			const replacements: { start: number; end: number; rendered: string }[] = [];
			for (const match of line.matchAll(SKILL_REFERENCE)) {
				const token = match[1];
				if (!token || match.index === undefined) continue;
				const start = match.index + match[0].length - token.length;
				const end = start + token.length;
				if (overlaps(start, end, excluded[lineIndex] ?? [])) continue;
				const skill = skills.get(token.slice(1));
				if (!skill) continue;
				const label = skill.displayName ?? skill.name;
				const open = `\x1b_${MARKER_PREFIX}${encodeURIComponent(label)}\x07`;
				replacements.push({ start, end, rendered: `${open}${renderPillText(pillContent(label))}${MARKER_CLOSE}` });
			}
			let projected = line;
			for (const replacement of replacements.reverse()) {
				projected = `${projected.slice(0, replacement.start)}${replacement.rendered}${projected.slice(replacement.end)}`;
			}
			return projected;
		})
		.join("\n");
}

/** Remove marker metadata while preserving the visible fallback pill text. */
export function stripSkillTranscriptMarkers(line: string): string {
	return line.replace(MARKER_SEQUENCE, "");
}

/** Paint complete transcript markers as semantic pills and safely strip incomplete markers. */
export function renderSkillTranscriptPills(lines: readonly string[], theme: Theme): string[] {
	return lines.map((line) => {
		let rendered = line;
		const markers = [...line.matchAll(MARKER_OPEN)];
		for (const marker of markers.reverse()) {
			const encodedLabel = marker[1];
			const start = marker.index;
			if (!encodedLabel || start === undefined) continue;
			const contentStart = start + marker[0].length;
			const contentEnd = line.indexOf(MARKER_CLOSE, contentStart);
			if (contentEnd < 0) continue;
			let label: string;
			try {
				label = decodeURIComponent(encodedLabel);
			} catch {
				continue;
			}
			const column = visibleWidth(stripTerminalSequences(line.slice(0, start)));
			const destination = backgroundAnsiAtColumn(line, column);
			const colors = tuiTheme(theme);
			const contrast = contrastingPillBackground(theme, destination);
			const background = colors.mixForeground(colors.contrastBackground(contrast), contrast, 0.2);
			const pill = renderPill(theme, pillContent(label), background, "text.primary", undefined, destination);
			rendered = `${rendered.slice(0, start)}${pill}${rendered.slice(contentEnd + MARKER_CLOSE.length)}`;
		}
		return stripSkillTranscriptMarkers(rendered);
	});
}
