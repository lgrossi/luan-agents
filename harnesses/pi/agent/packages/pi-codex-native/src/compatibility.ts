import type { Api, Model } from "@earendil-works/pi-ai";

export type CodexCompatibleProviderOptions = {
	id?: string;
	provider: string;
	model?: string | ((id: string) => boolean);
	api?: string | string[];
	/** Explicit premium policy; omitted means ordinary OpenAI-compatible behavior. */
	fastMode?: boolean;
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
	fastMode: true,
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
	if (typeof r.model === "string") return r.model.endsWith("*") ? 40 : 50;
	if (typeof r.model === "function") return 30;
	return 20;
}
function apiSpecificity(r: CodexCompatibleProvider): number {
	return r.api ? 1 : 0;
}

export function registerCodexCompatibleProvider(options: CodexCompatibleProviderOptions): () => void {
	const registration = { ...options };
	if (registration.id) {
		const existingIndex = registry.registrations.findIndex((item) => item.id === registration.id);
		if (existingIndex >= 0) registry.registrations.splice(existingIndex, 1);
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
		.sort(
			(a, b) =>
				specificity(b.registration) - specificity(a.registration) ||
				apiSpecificity(b.registration) - apiSpecificity(a.registration) ||
				a.index - b.index,
		)[0];
	return match?.registration ?? (matches(native, model) ? native : undefined);
}
