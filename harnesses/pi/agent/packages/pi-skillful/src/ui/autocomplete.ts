import type { AutocompleteItem, AutocompleteProvider } from "@earendil-works/pi-tui";
import type { SkillReference } from "../skills.ts";

const SKILL_AT_CURSOR = /(?:^|\s)\$([a-zA-Z0-9_:-]*)$/u;

export function findSkillAtCursor(line: string, column: number): { token: string; query: string } | undefined {
	const match = SKILL_AT_CURSOR.exec(line.slice(0, column));
	return match ? { token: `$${match[1]}`, query: match[1] ?? "" } : undefined;
}

export function skillAutocompleteProvider(
	base: AutocompleteProvider,
	getItems: () => readonly AutocompleteItem[],
): AutocompleteProvider {
	return {
		triggerCharacters: ["$"],
		async getSuggestions(lines, cursorLine, cursorCol, options) {
			const skill = findSkillAtCursor(lines[cursorLine] ?? "", cursorCol);
			if (!skill) return base.getSuggestions(lines, cursorLine, cursorCol, options);
			const query = skill.query.toLowerCase();
			const items = getItems().filter((item) => !query || item.label.toLowerCase().includes(query));
			return items.length > 0 ? { items: [...items], prefix: skill.token } : null;
		},
		applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
			if (!prefix.startsWith("$")) return base.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
			const line = lines[cursorLine] ?? "";
			const start = cursorCol - prefix.length;
			const completed = [...lines];
			completed[cursorLine] = `${line.slice(0, start)}${item.value}${line.slice(cursorCol)}`;
			return { lines: completed, cursorLine, cursorCol: start + item.value.length };
		},
		...(base.shouldTriggerFileCompletion
			? { shouldTriggerFileCompletion: base.shouldTriggerFileCompletion.bind(base) }
			: {}),
	};
}

export function skillAutocompleteItems(
	skills: ReadonlyMap<string, SkillReference>,
	muted: (text: string) => string,
): AutocompleteItem[] {
	return [...skills.values()].map((skill) => ({
		value: `$${skill.name}`,
		label: `$${skill.name}`,
		...(skill.description ? { description: muted(skill.description) } : {}),
	}));
}
