import { describe, expect, test } from "bun:test";

const PUBLIC_ENTRYPOINTS = [
	"@luan-pi/pi-libtui",
	"@luan-pi/pi-libtui/diff",
	"@luan-pi/pi-libtui/editor",
	"@luan-pi/pi-libtui/folding",
	"@luan-pi/pi-libtui/mouse",
	"@luan-pi/pi-libtui/selection",
	"@luan-pi/pi-libtui/stream",
	"@luan-pi/pi-libtui/terminal",
	"@luan-pi/pi-libtui/tool",
] as const;

const CAPABILITY_KEYS = [
	Symbol.for("pi-libtui/editor/registry/v1"),
	Symbol.for("pi-libtui/folding/registry/v2"),
	Symbol.for("pi-libtui/mouse/registry/v1"),
	Symbol.for("pi-libtui/selection/v1"),
	Symbol.for("pi-libtui/split-panes/v2"),
	Symbol.for("pi-libtui.motionScheduler.v1"),
] as const;

describe("public module boundaries", () => {
	test("loads every documented public entrypoint without loading the host extension", async () => {
		const before = CAPABILITY_KEYS.map((key) => Object.hasOwn(globalThis, key));
		for (const entrypoint of PUBLIC_ENTRYPOINTS) {
			const module = await import(entrypoint);
			expect(typeof module).toBe("object");
		}
		const after = CAPABILITY_KEYS.map((key) => Object.hasOwn(globalThis, key));
		expect(after).toEqual(before);
		const mouse = await import("@luan-pi/pi-libtui/mouse");
		expect(Object.keys(mouse).sort()).toEqual([
			"FULLSCREEN_LAYOUT_CAPABILITY_KEY",
			"FULLSCREEN_LAYOUT_PROTOCOL",
			"MOUSE_PROTOCOL",
			"MOUSE_REGISTRY_KEY",
			"TEXT_INTERACTION_TARGET",
			"ensureMouseRegistry",
			"getFullscreenLayoutCapability",
			"preserveViewportOnResize",
			"publishFullscreenLayoutCapability",
			"registerModalPointerShield",
			"resolveFullscreenLayout",
		]);
		const editor = await import("@luan-pi/pi-libtui/editor");
		expect(Object.keys(editor).sort()).toEqual([
			"EDITOR_PROTOCOL",
			"EDITOR_REGISTRY_KEY",
			"SemanticEditor",
			"composeEditorStatus",
			"dispatchEditorPaste",
			"dispatchEditorRender",
			"editorCompositionCadenceMs",
			"editorCompositionContentWidth",
			"editorStatusSeparator",
			"ensureEditorRegistry",
			"installEditorLayer",
			"installEditorMinimumRows",
			"renderEditorComposition",
			"renderEditorCompositionPreview",
			"renderEditorCompositionStatus",
			"semanticEditorTheme",
		]);
	});

	test("keeps extension activation explicit", async () => {
		const before = CAPABILITY_KEYS.map((key) => Object.hasOwn(globalThis, key));
		const extension = await import("../src/extension.ts");
		expect(typeof extension.default).toBe("function");
		const after = CAPABILITY_KEYS.map((key) => Object.hasOwn(globalThis, key));
		expect(after).toEqual(before);
	});
});
