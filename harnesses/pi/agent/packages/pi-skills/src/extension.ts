import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { ComponentStack, tuiTheme } from "pi-libtui";
import { ensureMouseRegistry } from "pi-libtui/mouse";
import { registerSkillCodeModeAdapter } from "./code-mode-adapter.ts";
import { getSkillsSettings, registerSkillsXSettings } from "./contributions/xsettings.ts";
import { registerSkillEditorHighlights } from "./contributions/editor-highlights.ts";
import { addSkillDisplayNames, discoverSkills, type SkillReference } from "./skills.ts";
import { registerSkillsPromptContribution } from "./prompt.ts";
import { createSkillTool } from "./tools/skill/definition.ts";
import { LOADED_SKILL_CONTEXT_MESSAGE_TYPE } from "./loaded-skill-context.ts";
import { skillAutocompleteItems, skillAutocompleteProvider } from "./ui/autocomplete.ts";
import {
	projectSkillTranscript,
	renderSkillTranscriptPills,
	stripSkillTranscriptMarkers,
} from "./ui/transcript-skills.ts";

const AUTOCOMPLETE_INSTALLED = Symbol.for("pi-skills/autocomplete-installed/v1");

export default function skillsExtension(pi: ExtensionAPI): void {
	const mouse = ensureMouseRegistry();
	let project: { cwd: string; trusted: boolean } | undefined;
	const discoveredSkills = (): Map<string, SkillReference> => discoverSkills(pi, project);
	const disposeXSettings = registerSkillsXSettings();
	const disposePrompt = registerSkillsPromptContribution(getSkillsSettings);
	const tool = createSkillTool(pi, discoveredSkills);
	pi.registerTool(tool);
	// Historical sessions may contain displayable copies; the tool row owns their presentation.
	pi.registerMessageRenderer(LOADED_SKILL_CONTEXT_MESSAGE_TYPE, () => new ComponentStack());
	const disposeCodeModeAdapter = registerSkillCodeModeAdapter(tool);
	let disposeEditorHighlights = (): void => {};
	let disposeTranscriptPills = (): void => {};
	let skills: ReadonlyMap<string, SkillReference> = new Map();
	pi.registerMarkdownTransformer((markdown, context) =>
		context.messageType === "user" ? projectSkillTranscript(markdown, skills) : markdown,
	);
	pi.on("session_start", async (event, ctx) => {
		project = { cwd: ctx.cwd, trusted: ctx.isProjectTrusted() };
		if (!ctx.hasUI) return;
		skills = await addSkillDisplayNames(discoveredSkills());
		disposeEditorHighlights();
		disposeEditorHighlights = registerSkillEditorHighlights(() => skills);
		disposeTranscriptPills();
		disposeTranscriptPills = mouse.registerScreenDecorator({
			id: "pi-skills.transcript-pills",
			priority: 5,
			decorate: (screen, context) =>
				context.hasOverlay || context.selectionActive
					? screen.map(stripSkillTranscriptMarkers)
					: renderSkillTranscriptPills(screen, ctx.ui.theme),
		});
		const ui = ctx.ui as typeof ctx.ui & { [AUTOCOMPLETE_INSTALLED]?: true };
		if (ui[AUTOCOMPLETE_INSTALLED] && event.reason !== "reload") return;
		ui[AUTOCOMPLETE_INSTALLED] = true;
		ctx.ui.addAutocompleteProvider((current) =>
			skillAutocompleteProvider(current, () =>
				skillAutocompleteItems(skills, (description) => tuiTheme(ctx.ui.theme).fg("text.muted", description)),
			),
		);
	});
	pi.on("session_shutdown", (event) => {
		disposeEditorHighlights();
		disposeTranscriptPills();
		if (event.reason === "reload" || event.reason === "quit") {
			disposePrompt();
			disposeCodeModeAdapter();
			disposeXSettings();
		}
	});
}
