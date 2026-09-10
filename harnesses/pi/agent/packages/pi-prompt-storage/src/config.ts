import type { PromptStorageConfig } from "./core/model.ts";

// Deliberate limit: fixed settings. Move to pi-xsettings when a knob needs to be user-tunable.
export const defaultConfig: PromptStorageConfig = {
	shortcuts: { stash: "ctrl+s" },
	history: { includeSlashCommands: true, maxResults: 120 },
	picker: { maxVisible: 10, enterAction: "pop" },
};
