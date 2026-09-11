import { afterEach, describe, expect, test } from "bun:test";
import { registerSkillEditorHighlights } from "../src/contributions/editor-highlights.ts";

const key = Symbol.for("pi-custom-editor/highlights/v1");

// type-boundary: this test installs a structural process-global capability stub.
type GlobalCapabilityBoundary = unknown;

afterEach(() => {
	Reflect.deleteProperty(globalThis, key);
});

describe("skill editor highlights", () => {
	test("contributes lightbulb pills for exact known dollar references", () => {
		let contribution:
			| {
					matches(context: { text: string }): readonly {
						start: number;
						end: number;
						presentation: object;
					}[];
			  }
			| undefined;
		(globalThis as GlobalCapabilityBoundary as Record<PropertyKey, object>)[key] = {
			protocol: "pi-custom-editor/highlights/v1",
			version: 1,
			register(value: typeof contribution) {
				contribution = value;
				return () => {};
			},
		};
		registerSkillEditorHighlights(
			() =>
				new Map([
					[
						"writing-for-agents",
						{
							name: "writing-for-agents",
							filePath: "/skills/writing-for-agents/SKILL.md",
							displayName: "Writing for agents",
						},
					],
				]),
		);

		expect(contribution?.matches({ text: "use $writing-for-agents, not $missing" })).toEqual([
			{
				start: 4,
				end: 23,
				presentation: {
					kind: "pill",
					label: "Writing for agents",
					icon: "lightbulb",
					iconTone: "accent",
					minimumCursorGap: 1,
				},
			},
		]);
	});

	test("does nothing when the custom editor capability is absent", () => {
		expect(() => registerSkillEditorHighlights(() => new Map())()).not.toThrow();
	});
});
