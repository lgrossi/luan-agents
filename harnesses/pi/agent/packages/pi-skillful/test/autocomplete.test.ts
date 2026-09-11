import { describe, expect, test } from "bun:test";
import type { AutocompleteProvider } from "@earendil-works/pi-tui";
import { findSkillAtCursor, skillAutocompleteItems, skillAutocompleteProvider } from "../src/ui/autocomplete.ts";

const base: AutocompleteProvider = {
	async getSuggestions() {
		return { items: [{ value: "base", label: "base" }], prefix: "" };
	},
	applyCompletion(lines) {
		return { lines, cursorLine: 0, cursorCol: 0 };
	},
};

describe("skill autocomplete", () => {
	test("finds a skill reference at the cursor without requiring the end of the prompt", () => {
		expect(findSkillAtCursor("use $wri then continue", 8)).toEqual({ token: "$wri", query: "wri" });
		expect(findSkillAtCursor("email$x", 7)).toBeUndefined();
	});

	test("suggests matching skills and preserves text after a mid-prompt completion", async () => {
		const provider = skillAutocompleteProvider(base, () => [
			{ value: "$writing-for-agents", label: "$writing-for-agents", description: "Write agent instructions." },
		]);
		const suggestions = await provider.getSuggestions(["use $wri then continue"], 0, 8, {
			signal: new AbortController().signal,
		});

		expect(provider.triggerCharacters).toEqual(["$"]);
		expect(suggestions).toEqual({
			items: [{ value: "$writing-for-agents", label: "$writing-for-agents", description: "Write agent instructions." }],
			prefix: "$wri",
		});
		expect(provider.applyCompletion(["use $wri then continue"], 0, 8, suggestions!.items[0]!, "$wri")).toEqual({
			lines: ["use $writing-for-agents then continue"],
			cursorLine: 0,
			cursorCol: 23,
		});
	});

	test("delegates outside skill syntax", async () => {
		const provider = skillAutocompleteProvider(base, () => []);
		expect(await provider.getSuggestions(["ordinary"], 0, 8, { signal: new AbortController().signal })).toEqual({
			items: [{ value: "base", label: "base" }],
			prefix: "",
		});
	});

	test("pre-colors descriptions with the editor's muted semantic color", () => {
		expect(
			skillAutocompleteItems(
				new Map([["write", { name: "write", filePath: "/skills/write/SKILL.md", description: "Write things." }]]),
				(text) => `<muted>${text}</muted>`,
			),
		).toEqual([{ value: "$write", label: "$write", description: "<muted>Write things.</muted>" }]);
	});
});
