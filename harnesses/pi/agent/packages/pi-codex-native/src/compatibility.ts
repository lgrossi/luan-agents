import type { Api, Model } from "@earendil-works/pi-ai";

export type CodexCompatibleProviderOptions = {
	id?: string;
	provider: string;
	model?: string | ((id: string) => boolean);
	api?: string | string[];
	features?: { fastMode?: boolean; textVerbosity?: boolean; contextWindow?: boolean };
	/** How text verbosity is represented by this route. */
	textVerbosityFormat?: "responses" | "chat-completions";
	routingHeaders?: boolean;
};
export type CodexCompatibleProvider = CodexCompatibleProviderOptions;
const REGISTRY_KEY = Symbol.for("pi.codex-native.compatibility-registry");
type Registry = { registrations: CodexCompatibleProvider[] };
const globalObject = globalThis as typeof globalThis & { [REGISTRY_KEY]?: Registry };
const registry = globalObject[REGISTRY_KEY] ?? { registrations: [] };
globalObject[REGISTRY_KEY] = registry;
const native: CodexCompatibleProvider = {
	provider: "openai-codex",
	api: "openai-codex-responses",
	features: { fastMode: true, textVerbosity: true, contextWindow: true },
	textVerbosityFormat: "responses",
	routingHeaders: true,
};
function matches(r: CodexCompatibleProvider, m: Model<Api>): boolean {
	if (m.provider !== r.provider) return false;
	if (r.api && !(Array.isArray(r.api) ? r.api : [r.api]).includes(m.api)) return false;
	if (typeof r.model === "function" && !r.model(m.id)) return false;
	if (
		typeof r.model === "string" &&
		r.model !== m.id &&
		!(r.model.endsWith("*") && m.id.startsWith(r.model.slice(0, -1)))
	)
		return false;
	return true;
}

function specificity(r: CodexCompatibleProvider): number {
	if (typeof r.model === "string") return r.model.endsWith("*") ? 30 : 40;
	if (typeof r.model === "function") return 20;
	return 10;
}

export function registerCodexCompatibleProvider(options: CodexCompatibleProviderOptions): () => void {
	const registration = { ...options, features: options.features ? { ...options.features } : undefined };
	if (registration.id) {
		const existing = registry.registrations.find((item) => item.id === registration.id);
		if (existing) return () => {};
	}
	registry.registrations.unshift(registration);
	return () => {
		const i = registry.registrations.indexOf(registration);
		if (i >= 0) registry.registrations.splice(i, 1);
	};
}
export function codexCompatibility(model: Model<Api> | undefined): CodexCompatibleProvider | undefined {
	if (!model) return undefined;
	const match = registry.registrations
		.map((registration, index) => ({ registration, index }))
		.filter(({ registration }) => matches(registration, model))
		.sort((a, b) => specificity(b.registration) - specificity(a.registration) || a.index - b.index)[0];
	return match?.registration ?? (matches(native, model) ? native : undefined);
}
export function codexFeature(
	model: Model<Api> | undefined,
	feature: keyof NonNullable<CodexCompatibleProvider["features"]>,
): boolean {
	return codexCompatibility(model)?.features?.[feature] === true;
}
export function codexTextVerbosityFormat(
	model: Model<Api> | undefined,
): CodexCompatibleProvider["textVerbosityFormat"] | undefined {
	return codexCompatibility(model)?.textVerbosityFormat;
}
