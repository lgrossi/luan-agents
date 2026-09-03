import type { SkillReference } from "../skills.ts";

const REGISTRY_KEY = Symbol.for("pi-custom-editor/highlights/v1");
const SKILL_REFERENCE = /(?:^|\s)(\$[a-zA-Z][\w-]*(?::[\w-]+)*)/gu;

interface HighlightRegistry {
	readonly protocol: "pi-custom-editor/highlights/v1";
	readonly version: 1;
	register(contribution: SkillHighlightContribution): () => void;
}

interface SkillHighlightContribution {
	readonly id: string;
	matches(context: { readonly text: string }): readonly {
		readonly start: number;
		readonly end: number;
		readonly presentation: {
			readonly kind: "pill";
			readonly label: string;
			readonly icon: "lightbulb";
			readonly iconTone: "accent";
			readonly minimumCursorGap: 1;
		};
	}[];
}

// type-boundary: the optional pi-custom-editor capability is process-global and validated here before use.
type HighlightRegistryBoundary = unknown;

function highlightRegistry(): HighlightRegistry | undefined {
	const candidate = (globalThis as Record<PropertyKey, HighlightRegistryBoundary>)[REGISTRY_KEY];
	if (!candidate || typeof candidate !== "object") return undefined;
	const record = candidate as Partial<HighlightRegistry>;
	return record.protocol === "pi-custom-editor/highlights/v1" &&
		record.version === 1 &&
		typeof record.register === "function"
		? (record as HighlightRegistry)
		: undefined;
}

export function registerSkillEditorHighlights(getSkills: () => ReadonlyMap<string, SkillReference>): () => void {
	const registry = highlightRegistry();
	if (!registry) return () => {};
	return registry.register({
		id: "pi-skills.skill-references",
		matches({ text }) {
			const skills = getSkills();
			const matches = [];
			for (const match of text.matchAll(SKILL_REFERENCE)) {
				const token = match[1];
				if (!token || match.index === undefined) continue;
				const start = match.index + match[0].length - token.length;
				const skill = skills.get(token.slice(1));
				if (!skill) continue;
				matches.push({
					start,
					end: start + token.length,
					presentation: {
						kind: "pill" as const,
						label: skill.displayName ?? skill.name,
						icon: "lightbulb" as const,
						iconTone: "accent" as const,
						minimumCursorGap: 1 as const,
					},
				});
			}
			return matches;
		},
	});
}
