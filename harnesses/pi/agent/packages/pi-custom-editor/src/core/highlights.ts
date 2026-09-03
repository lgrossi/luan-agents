import type {
	EditorHighlightContext,
	EditorHighlightContribution,
	EditorHighlightMatch,
} from "../protocol/highlights.ts";

const AT_REFERENCE = /(^|\s)(@(?:"[^"\r\n]+"|[^\s"\r\n]+))/gu;
const SLASH_COMMAND = /^(\s*)\/([^\s/]+)(?=\s|$)/u;

function validPresentation(match: EditorHighlightMatch): boolean {
	const presentation = match.presentation;
	if (!presentation || typeof presentation !== "object") return false;
	if (presentation.kind === "foreground") {
		return (
			typeof presentation.color === "string" || (presentation.color !== null && typeof presentation.color === "object")
		);
	}
	return (
		presentation.kind === "pill" &&
		typeof presentation.label === "string" &&
		(presentation.icon === false ||
			typeof presentation.icon === "string" ||
			(presentation.icon !== null && typeof presentation.icon === "object"))
	);
}

export function atReferenceMatches(text: string, exists: (path: string) => boolean): EditorHighlightMatch[] {
	return atReferences(text).map(({ start, end, path }) => ({
		start,
		end,
		presentation: { kind: "foreground", color: exists(path) ? "positive" : "negative" },
	}));
}

export interface AtReference {
	readonly start: number;
	readonly end: number;
	readonly token: string;
	readonly path: string;
}

export function atReferences(text: string): AtReference[] {
	const references: AtReference[] = [];
	for (const match of text.matchAll(AT_REFERENCE)) {
		const token = match[2];
		if (!token || match.index === undefined) continue;
		const start = match.index + (match[1]?.length ?? 0);
		const rawPath = token.slice(1);
		references.push({
			start,
			end: start + token.length,
			token,
			path: rawPath.startsWith('"') && rawPath.endsWith('"') ? rawPath.slice(1, -1) : rawPath,
		});
	}
	return references;
}

export function slashCommandMatch(
	context: EditorHighlightContext,
	knownCommands: ReadonlySet<string>,
): EditorHighlightMatch[] {
	if (context.line !== context.promptLine) return [];
	const match = context.text.match(SLASH_COMMAND);
	const name = match?.[2];
	if (!match || !name) return [];
	const start = match[1]?.length ?? 0;
	return [
		{
			start,
			end: start + name.length + 1,
			presentation: { kind: "foreground", color: knownCommands.has(name) ? "positive" : "negative" },
		},
	];
}

export function collectHighlightMatches(
	contributions: readonly EditorHighlightContribution[],
	context: EditorHighlightContext,
): EditorHighlightMatch[] {
	const accepted: EditorHighlightMatch[] = [];
	for (const contribution of contributions) {
		let proposed: readonly EditorHighlightMatch[];
		try {
			proposed = contribution.matches(context);
		} catch {
			continue;
		}
		for (const match of proposed) {
			if (
				!Number.isInteger(match.start) ||
				!Number.isInteger(match.end) ||
				match.start < 0 ||
				match.end <= match.start ||
				match.end > context.text.length ||
				(context.excludedRanges ?? []).some((range) => match.start < range.end && range.start < match.end) ||
				!validPresentation(match) ||
				accepted.some((existing) => match.start < existing.end && existing.start < match.end)
			) {
				continue;
			}
			accepted.push(match);
		}
	}
	return accepted.sort((left, right) => left.start - right.start);
}
