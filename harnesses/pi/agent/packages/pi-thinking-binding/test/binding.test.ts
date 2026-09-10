import { describe, expect, test } from "bun:test";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import {
	BINDING_ENTRY_TYPE,
	fingerprintPrefix,
	newestAssistantTimestamp,
	parseAnthropicPayload,
	readBindingState,
	reportsPrefixMismatch,
	stripPayloadThinking,
	stripStaleThinking,
} from "../src/index.ts";

const system = [{ type: "text", text: "You are Pi." }];
const tools = [{ name: "exec", description: "Run code", input_schema: { type: "object" } }];
const thinkingTurn = {
	role: "assistant",
	content: [
		{ type: "thinking", thinking: "plan", signature: "sig" },
		{ type: "text", text: "ok" },
		{ type: "tool_use", id: "t1", name: "exec", input: {} },
	],
};

type Block = { type: "thinking"; thinking: string; thinkingSignature: string } | { type: "text"; text: string };

function assistant(timestamp: number, ...content: Block[]): AgentMessage {
	return {
		role: "assistant",
		content,
		api: "anthropic-messages",
		provider: "anthropic",
		model: "claude",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp,
	} as AgentMessage;
}
const thinking = (text: string) => ({ type: "thinking" as const, thinking: text, thinkingSignature: "sig" });
const text = (value: string) => ({ type: "text" as const, text: value });

describe("fingerprintPrefix", () => {
	test("depends on system and tools, not on messages", () => {
		const a = fingerprintPrefix({ system, tools, messages: [] });
		const b = fingerprintPrefix({ system, tools, messages: [{ role: "user", content: "hi" }] });
		expect(a).toBe(b);
	});

	test("changes when a tool description changes", () => {
		const a = fingerprintPrefix({ system, tools, messages: [] });
		const b = fingerprintPrefix({ system, tools: [{ ...tools[0], description: "Run JavaScript" }], messages: [] });
		expect(a).not.toBe(b);
	});
});

describe("parseAnthropicPayload", () => {
	test("accepts Anthropic message bodies and rejects other shapes", () => {
		expect(parseAnthropicPayload({ system, tools, messages: [thinkingTurn] })).toBeDefined();
		expect(parseAnthropicPayload({ input: [], instructions: "codex" })).toBeUndefined();
		expect(parseAnthropicPayload({ messages: [{ role: "user", content: [{ text: "no type" }] }] })).toBeUndefined();
	});
});

describe("stripPayloadThinking", () => {
	test("removes thinking and redacted thinking but keeps text and tool use", () => {
		const payload = {
			system,
			tools,
			messages: [
				{ role: "user", content: "hi" },
				thinkingTurn,
				{
					role: "assistant",
					content: [
						{ type: "redacted_thinking", data: "x" },
						{ type: "text", text: "later" },
					],
				},
			],
		};
		expect(stripPayloadThinking(payload).messages).toEqual([
			{ role: "user", content: "hi" },
			{
				role: "assistant",
				content: [
					{ type: "text", text: "ok" },
					{ type: "tool_use", id: "t1", name: "exec", input: {} },
				],
			},
			{ role: "assistant", content: [{ type: "text", text: "later" }] },
		]);
	});

	test("leaves a thinking-only message intact rather than emptying it", () => {
		const only = { role: "assistant", content: [{ type: "thinking", thinking: "x", signature: "s" }] };
		expect(stripPayloadThinking({ messages: [only] }).messages).toEqual([only]);
	});
});

describe("stripStaleThinking", () => {
	const history = [
		assistant(100, thinking("old"), text("a")),
		{ role: "user", content: "next", timestamp: 150 } as AgentMessage,
		assistant(200, thinking("boundary"), text("b")),
		assistant(300, thinking("fresh"), text("c")),
	];

	test("removes thinking at or before the cutoff and keeps newer reasoning", () => {
		const next = stripStaleThinking(history, 200);
		expect(next?.map((m) => (m.role === "assistant" ? m.content.map((block) => block.type) : m.role))).toEqual([
			["text"],
			"user",
			["text"],
			["thinking", "text"],
		]);
	});

	test("returns undefined when nothing is stale", () => {
		expect(stripStaleThinking(history, 50)).toBeUndefined();
	});

	test("newestAssistantTimestamp ignores non-assistant messages", () => {
		expect(newestAssistantTimestamp(history)).toBe(300);
		expect(newestAssistantTimestamp([history[1]!])).toBeUndefined();
	});
});

describe("reportsPrefixMismatch", () => {
	const dropped = (reason: string) => ({
		...assistant(1, text("x")),
		diagnostics: [
			{
				type: "anthropic_input_transformations",
				timestamp: 1,
				details: { transformations: [{ type: "thinking_dropped", path: "messages.3.content.0", reason }] },
			},
		],
	});

	test("only prefix drops count", () => {
		expect(reportsPrefixMismatch(dropped("prefix_binding_mismatch"))).toBe(true);
		expect(reportsPrefixMismatch(dropped("model_binding_mismatch"))).toBe(false);
		expect(reportsPrefixMismatch(assistant(1, text("x")))).toBe(false);
	});
});

describe("readBindingState", () => {
	test("returns the newest valid entry on the branch", () => {
		const branch = [
			{ type: "custom", customType: BINDING_ENTRY_TYPE, data: { version: 1, fingerprint: "a" } },
			{ type: "message" },
			{ type: "custom", customType: BINDING_ENTRY_TYPE, data: { version: 1, fingerprint: "b", staleThrough: 5 } },
		];
		expect(readBindingState(branch)).toEqual({ version: 1, fingerprint: "b", staleThrough: 5 });
		expect(readBindingState([{ type: "custom", customType: "other", data: {} }])).toBeUndefined();
	});
});
