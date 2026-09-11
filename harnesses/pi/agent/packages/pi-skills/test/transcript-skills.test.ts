import { describe, expect, test } from "bun:test";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences } from "@earendil-works/pi-tui";
import type { SkillReference } from "../src/skills.ts";
import {
	projectSkillTranscript,
	renderSkillTranscriptPills,
	stripSkillTranscriptMarkers,
} from "../src/ui/transcript-skills.ts";

const skills = new Map<string, SkillReference>([
	["finish", { name: "finish", filePath: "/skills/finish/SKILL.md", displayName: "Finish" }],
]);
const theme = {
	name: "transcript-skill-test",
	getColorMode: () => "truecolor",
	getFgAnsi: () => "\x1b[38;2;180;190;220m",
	getBgAnsi: () => "\x1b[48;2;24;28;36m",
} as never as Theme;

describe("skill transcript pills", () => {
	test("projects known references without retaining the dollar sign", () => {
		const projected = projectSkillTranscript("use $finish now", skills);
		expect(projected).toContain("pi-skills:transcript:Finish");
		expect(projected).not.toContain("$finish");
		expect(stripSkillTranscriptMarkers(projected)).toContain("💡 Finish");
	});

	test("leaves inline and fenced code literal", () => {
		const source = ["use `$finish`", "```", "$finish", "```", "then $finish"].join("\n");
		const projected = projectSkillTranscript(source, skills);
		expect(projected.split("\n").slice(0, 4).join("\n")).toBe(["use `$finish`", "```", "$finish", "```"].join("\n"));
		expect(projected.match(/pi-skills:transcript:/gu)).toHaveLength(2);
	});

	test("paints complete markers and strips marker metadata", () => {
		const [rendered] = renderSkillTranscriptPills([projectSkillTranscript("$finish", skills)], theme);
		expect(stripTerminalSequences(rendered ?? "")).toContain("💡 Finish");
		expect(rendered).toContain("\x1b[");
		expect(rendered).not.toContain("pi-skills:transcript:");
	});
});
