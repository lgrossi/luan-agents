import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	BINDING_ENTRY_TYPE,
	type BindingState,
	fingerprintPrefix,
	newestAssistantTimestamp,
	parseAnthropicPayload,
	readBindingState,
	reportsPrefixMismatch,
	stripPayloadThinking,
	stripStaleThinking,
} from "./core/binding.ts";

export default function thinkingBindingExtension(pi: ExtensionAPI): void {
	// Pi's assistant message timestamp predates before_provider_request, so the cutoff comes from history instead.
	let newestAssistant: number | undefined;
	let fingerprint: string | undefined;
	const record = (state: BindingState): void => pi.appendEntry(BINDING_ENTRY_TYPE, state);
	pi.on("context", (event, ctx) => {
		if (ctx.model?.api !== "anthropic-messages") return;
		newestAssistant = newestAssistantTimestamp(event.messages);
		const state = readBindingState(ctx.sessionManager.getBranch());
		if (state?.staleThrough === undefined) return;
		const messages = stripStaleThinking(event.messages, state.staleThrough);
		return messages ? { messages } : undefined;
	});

	pi.on("before_provider_request", (event, ctx) => {
		if (ctx.model?.api !== "anthropic-messages") return;
		const payload = parseAnthropicPayload(event.payload);
		if (!payload) return;
		fingerprint = fingerprintPrefix(payload);
		const previous = readBindingState(ctx.sessionManager.getBranch());
		if (previous?.fingerprint === fingerprint) return;
		// A changed prefix invalidates every thinking block sent so far; a first sighting invalidates nothing.
		const staleThrough = previous ? (newestAssistant ?? previous.staleThrough) : undefined;
		record({ version: 1, fingerprint, staleThrough });
		return previous && newestAssistant !== undefined ? stripPayloadThinking(payload) : undefined;
	});

	// Sessions broken before the fingerprint was recorded: trust Anthropic's own drop report once.
	pi.on("message_end", (event, ctx) => {
		if (ctx.model?.api !== "anthropic-messages" || fingerprint === undefined || newestAssistant === undefined) return;
		if (!reportsPrefixMismatch(event.message)) return;
		const previous = readBindingState(ctx.sessionManager.getBranch());
		if (previous?.staleThrough !== undefined && previous.staleThrough >= newestAssistant) return;
		record({ version: 1, fingerprint, staleThrough: newestAssistant });
	});
}
