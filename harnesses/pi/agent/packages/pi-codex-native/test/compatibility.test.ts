import { expect, test } from "bun:test";
import {
	codexCompatibility,
	codexFeature,
	codexTextVerbosityFormat,
	registerCodexCompatibleProvider,
} from "../src/compatibility.ts";

test("native profile remains the default", () => {
	const model = { provider: "openai-codex", api: "openai-codex-responses", id: "gpt-5.6-sol" } as never;
	expect(codexFeature(model, "fastMode")).toBe(true);
	expect(codexCompatibility(model)?.routingHeaders).toBe(true);
});

test("registrations are model-scoped and disposable", () => {
	const unregister = registerCodexCompatibleProvider({
		provider: "litellm",
		model: "gpt-5.6-luna-compat",
		api: "openai-completions",
		features: { fastMode: true, textVerbosity: true, contextWindow: true },
		textVerbosityFormat: "chat-completions",
	});
	const luna = { provider: "litellm", api: "openai-completions", id: "gpt-5.6-luna-compat" } as never;
	const other = { provider: "litellm", api: "openai-completions", id: "claude-opus-5" } as never;
	expect(codexFeature(luna, "fastMode")).toBe(true);
	expect(codexTextVerbosityFormat(luna)).toBe("chat-completions");
	expect(codexFeature(other, "fastMode")).toBe(false);
	unregister();
	expect(codexFeature(luna, "fastMode")).toBe(false);
});

test("newer registrations take precedence and disposal is idempotent", () => {
	const first = registerCodexCompatibleProvider({ provider: "litellm", model: "gpt-*", features: { fastMode: false } });
	const second = registerCodexCompatibleProvider({
		provider: "litellm",
		model: "gpt-5.6-luna-precedence",
		features: { fastMode: true },
	});
	const luna = { provider: "litellm", api: "openai-completions", id: "gpt-5.6-luna-precedence" } as never;
	expect(codexFeature(luna, "fastMode")).toBe(true);
	second();
	second();
	expect(codexFeature(luna, "fastMode")).toBe(false);
	first();
});

test("matches provider and API, with exact models outranking predicates and broad routes", () => {
	const broad = registerCodexCompatibleProvider({
		provider: "test-provider",
		api: "test-api",
		features: { textVerbosity: true },
	});
	const predicate = registerCodexCompatibleProvider({
		provider: "test-provider",
		api: "test-api",
		model: (id) => id.startsWith("model-"),
		features: { fastMode: false, textVerbosity: true },
	});
	const exact = registerCodexCompatibleProvider({
		provider: "test-provider",
		api: "test-api",
		model: "model-one",
		features: { fastMode: true },
	});
	const model = { provider: "test-provider", api: "test-api", id: "model-one" } as never;
	const otherApi = { provider: "test-provider", api: "other-api", id: "model-one" } as never;
	const otherProvider = { provider: "other-provider", api: "test-api", id: "model-one" } as never;
	expect(codexFeature(model, "fastMode")).toBe(true);
	expect(codexFeature(model, "textVerbosity")).toBe(false);
	expect(codexFeature(otherApi, "textVerbosity")).toBe(false);
	expect(codexFeature(otherProvider, "textVerbosity")).toBe(false);
	expect(codexFeature({ provider: "test-provider", api: "test-api", id: "other" } as never, "textVerbosity")).toBe(
		true,
	);
	expect(codexCompatibility(undefined)).toBeUndefined();
	exact();
	predicate();
	broad();
});

test("omitted features remain disabled and duplicate IDs do not accumulate", () => {
	const first = registerCodexCompatibleProvider({
		id: "test-deduplicated",
		provider: "test-provider",
		features: { textVerbosity: true },
	});
	const duplicate = registerCodexCompatibleProvider({
		id: "test-deduplicated",
		provider: "test-provider",
		features: { fastMode: true },
	});
	const model = { provider: "test-provider", api: "any", id: "model" } as never;
	expect(codexFeature(model, "textVerbosity")).toBe(true);
	expect(codexFeature(model, "fastMode")).toBe(false);
	duplicate();
	expect(codexFeature(model, "textVerbosity")).toBe(true);
	first();
	expect(codexFeature(model, "textVerbosity")).toBe(false);
});
