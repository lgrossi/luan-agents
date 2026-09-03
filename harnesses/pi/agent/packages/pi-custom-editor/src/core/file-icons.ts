import type { TuiForegroundColor } from "pi-libtui";

export interface FileIcon {
	readonly glyph: string;
	readonly tone: TuiForegroundColor;
}

const EXTENSION_ICONS: Readonly<Record<string, FileIcon>> = {
	ts: { glyph: "", tone: { hue: "blue", shade: 2 } },
	tsx: { glyph: "", tone: { hue: "cyan", shade: 2 } },
	js: { glyph: "", tone: { hue: "yellow", shade: 2 } },
	jsx: { glyph: "", tone: { hue: "cyan", shade: 2 } },
	rs: { glyph: "", tone: { hue: "yellow", shade: 2 } },
	py: { glyph: "", tone: { hue: "yellow", shade: 2 } },
	go: { glyph: "", tone: { hue: "cyan", shade: 2 } },
	html: { glyph: "", tone: { hue: "red", shade: 2 } },
	css: { glyph: "", tone: { hue: "blue", shade: 2 } },
	scss: { glyph: "", tone: { hue: "magenta", shade: 2 } },
	svelte: { glyph: "", tone: { hue: "red", shade: 2 } },
	vue: { glyph: "", tone: { hue: "green", shade: 2 } },
	json: { glyph: "", tone: { hue: "yellow", shade: 2 } },
	md: { glyph: "", tone: "info" },
	yaml: { glyph: "", tone: { hue: "magenta", shade: 2 } },
	yml: { glyph: "", tone: { hue: "magenta", shade: 2 } },
	toml: { glyph: "", tone: { hue: "yellow", shade: 2 } },
	sh: { glyph: "", tone: { hue: "green", shade: 2 } },
	fish: { glyph: "", tone: { hue: "green", shade: 2 } },
};

const NAMED_ICONS: Readonly<Record<string, FileIcon>> = {
	Dockerfile: { glyph: "", tone: { hue: "blue", shade: 2 } },
	Makefile: { glyph: "", tone: { hue: "yellow", shade: 2 } },
};

export function fileIcon(path: string, directory: boolean): FileIcon {
	if (directory) return { glyph: "", tone: "info" };
	const name = path.split("/").at(-1) ?? path;
	const named = NAMED_ICONS[name];
	if (named) return named;
	const extension = name.includes(".") ? (name.split(".").at(-1)?.toLowerCase() ?? "") : "";
	return EXTENSION_ICONS[extension] ?? { glyph: "", tone: "text.muted" };
}
