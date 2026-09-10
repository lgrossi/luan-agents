import { createHash } from "node:crypto";
import type { AgentMessage } from "@earendil-works/pi-agent-core";

export const BINDING_ENTRY_TYPE = "pi-thinking-binding";

/** Persisted per branch: the last signed prefix and the cutoff through which thinking is dead. */
export interface BindingState {
	version: 1;
	fingerprint: string;
	/** Assistant messages with this timestamp or older carry thinking bound to an older prefix. */
	staleThrough?: number;
}

interface AnthropicBlock {
	type: string;
	[field: string]: unknown;
}

interface AnthropicMessage {
	role: string;
	content: string | AnthropicBlock[];
}

export interface AnthropicPayload {
	system?: unknown;
	tools?: unknown;
	messages: AnthropicMessage[];
}

// type-boundary: Pi's before_provider_request hands over the raw Anthropic Messages body; this narrows it.
type RawProviderPayload = unknown;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAnthropicMessage(value: unknown): value is AnthropicMessage {
	if (!isRecord(value) || typeof value.role !== "string") return false;
	if (typeof value.content === "string") return true;
	return (
		Array.isArray(value.content) && value.content.every((block) => isRecord(block) && typeof block.type === "string")
	);
}

export function parseAnthropicPayload(payload: RawProviderPayload): AnthropicPayload | undefined {
	if (!isRecord(payload) || !Array.isArray(payload.messages)) return undefined;
	if (!payload.messages.every(isAnthropicMessage)) return undefined;
	return payload as unknown as AnthropicPayload;
}

interface SessionEntryLike {
	type: string;
	customType?: string;
	data?: unknown;
}

function isBindingState(value: unknown): value is BindingState {
	return (
		isRecord(value) &&
		value.version === 1 &&
		typeof value.fingerprint === "string" &&
		(value.staleThrough === undefined || typeof value.staleThrough === "number")
	);
}

/** The newest binding state recorded on the active branch. */
export function readBindingState(branch: readonly SessionEntryLike[]): BindingState | undefined {
	for (let index = branch.length - 1; index >= 0; index--) {
		const entry = branch[index]!;
		if (entry.type !== "custom" || entry.customType !== BINDING_ENTRY_TYPE) continue;
		return isBindingState(entry.data) ? entry.data : undefined;
	}
	return undefined;
}

/** Anthropic binds each thinking signature to the system prompt and tool set that produced it. */
export function fingerprintPrefix(payload: AnthropicPayload): string {
	return createHash("sha256")
		.update(JSON.stringify(payload.system ?? null))
		.update(JSON.stringify(payload.tools ?? null))
		.digest("hex");
}

function isThinkingBlock(block: AnthropicBlock): boolean {
	return block.type === "thinking" || block.type === "redacted_thinking";
}

/** Remove every thinking block from the outgoing body. Used on the request where the prefix changed. */
export function stripPayloadThinking(payload: AnthropicPayload): AnthropicPayload {
	const messages = payload.messages.map((message) => {
		if (message.role !== "assistant" || typeof message.content === "string") return message;
		const content = message.content.filter((block) => !isThinkingBlock(block));
		return content.length === 0 || content.length === message.content.length ? message : { ...message, content };
	});
	return { ...payload, messages };
}

/** Timestamp of the newest assistant message already in history; the in-flight reply is never among them. */
export function newestAssistantTimestamp(messages: readonly AgentMessage[]): number | undefined {
	let newest: number | undefined;
	for (const message of messages) {
		if (message.role === "assistant" && (newest === undefined || message.timestamp > newest))
			newest = message.timestamp;
	}
	return newest;
}

/** True when Anthropic reported that it dropped replayed thinking because the prefix changed. */
export function reportsPrefixMismatch(message: AgentMessage): boolean {
	if (message.role !== "assistant") return false;
	return (message.diagnostics ?? []).some((diagnostic) => {
		if (diagnostic.type !== "anthropic_input_transformations") return false;
		const transformations = diagnostic.details?.transformations;
		return (
			Array.isArray(transformations) &&
			transformations.some(
				(item) => isRecord(item) && item.type === "thinking_dropped" && item.reason === "prefix_binding_mismatch",
			)
		);
	});
}

/** Remove thinking from assistant messages at or before the cutoff. Returns undefined when nothing changed. */
export function stripStaleThinking(
	messages: readonly AgentMessage[],
	staleThrough: number,
): AgentMessage[] | undefined {
	let changed = false;
	const next = messages.map((message) => {
		if (message.role !== "assistant" || message.timestamp > staleThrough) return message;
		const content = message.content.filter((block) => block.type !== "thinking");
		if (content.length === 0 || content.length === message.content.length) return message;
		changed = true;
		return { ...message, content };
	});
	return changed ? next : undefined;
}
