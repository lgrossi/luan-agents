import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { fileIcon } from "../core/file-icons.ts";
import { atReferences, slashCommandMatch } from "../core/highlights.ts";
import type { EditorHighlightContribution } from "../protocol/highlights.ts";

// Pi does not include its interactive built-ins in ExtensionAPI.getCommands().
const BUILTIN_COMMANDS = new Set([
	"settings",
	"model",
	"scoped-models",
	"export",
	"import",
	"share",
	"copy",
	"name",
	"session",
	"changelog",
	"hotkeys",
	"fork",
	"clone",
	"tree",
	"trust",
	"login",
	"logout",
	"new",
	"compact",
	"resume",
	"reload",
	"quit",
]);

export function defaultHighlightContributions(
	pi: Pick<ExtensionAPI, "getCommands">,
	getContext: () => ExtensionContext | undefined,
): readonly EditorHighlightContribution[] {
	return [
		{
			id: "pi-custom-editor.file-references",
			matches({ text }) {
				const cwd = getContext()?.cwd;
				return cwd
					? atReferences(text).map(({ start, end, path }) => {
							const expanded =
								path === "~" ? homedir() : path.startsWith("~/") ? `${homedir()}/${path.slice(2)}` : path;
							const resolved = resolve(cwd, expanded);
							const exists = existsSync(resolved);
							const icon = fileIcon(path, exists && statSync(resolved).isDirectory());
							return {
								start,
								end,
								presentation: {
									kind: "pill" as const,
									label: path,
									icon: { glyph: icon.glyph },
									iconTone: exists ? icon.tone : "negative",
									foreground: exists ? "positive" : "negative",
									minimumCursorGap: 1,
								},
							};
						})
					: [];
			},
		},
		{
			id: "pi-custom-editor.slash-commands",
			matches(context) {
				let extensionCommands: readonly { name: string }[] = [];
				try {
					extensionCommands = pi.getCommands();
				} catch {
					// A context can become stale between a session transition and repaint.
				}
				return slashCommandMatch(
					context,
					new Set([...BUILTIN_COMMANDS, ...extensionCommands.map((command) => command.name)]),
				);
			},
		},
	];
}
