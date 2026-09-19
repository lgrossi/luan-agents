import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { type CodexNativeSettings, getCodexNativeSettings } from "../contributions/xsettings.ts";
import { codexFeature, codexTextVerbosityFormat } from "../compatibility.ts";

// type-boundary: Pi exposes provider payloads without a type; isRecord narrows the payload before mutation.
type UntrustedProviderValue = unknown;
type Payload = Record<string, UntrustedProviderValue>;

function isRecord(value: UntrustedProviderValue): value is Payload {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function eligible(ctx: ExtensionContext): boolean {
	return codexFeature(ctx.model, "textVerbosity");
}

export function registerTextVerbosity(
	pi: Pick<ExtensionAPI, "on">,
	getSettings: () => CodexNativeSettings = getCodexNativeSettings,
): void {
	pi.on("before_provider_request", (event, ctx) => {
		if (!eligible(ctx) || !isRecord(event.payload)) return undefined;
		if (codexTextVerbosityFormat(ctx.model) === "chat-completions") {
			return { ...event.payload, verbosity: getSettings().textVerbosity };
		}
		const text = isRecord(event.payload.text) ? event.payload.text : {};
		return { ...event.payload, text: { ...text, verbosity: getSettings().textVerbosity } };
	});
}
