import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { Model } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	type AgentSession,
	type AgentSessionEvent,
	createAgentSession,
	DefaultResourceLoader,
	getAgentDir,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import type { AgentProfile } from "./types.ts";
import type { ModelTier } from "./types.ts";

export interface HeadlessRunOptions {
	pi: ExtensionAPI;
	ctx: ExtensionContext;
	profile: AgentProfile;
	modelTier: ModelTier;
	prompt: string;
	maxTurns: number;
	signal?: AbortSignal;
}

export interface HeadlessRunResult {
	responseText: string;
	sessionPath?: string;
	toolUses: number;
	turns: number;
	worktree?: { path: string; branch?: string };
}

export async function runHeadlessProfile(options: HeadlessRunOptions): Promise<HeadlessRunResult> {
	const worktree = await prepareWorktree(options);
	const cwd = worktree.cwd;
	const loader = new DefaultResourceLoader(buildHeadlessResourceLoaderOptions(options.profile, cwd));
	await loader.reload();

	const sessionManager = SessionManager.create(cwd, options.ctx.sessionManager.getSessionDir?.());
	sessionManager.newSession({ parentSession: options.ctx.sessionManager.getSessionFile?.() });
	sessionManager.appendSessionInfo(`spawn:${options.profile.name}`);
	const { session } = await createAgentSession({
		cwd,
		modelRegistry: options.ctx.modelRegistry,
		model: selectModelForTier(options.ctx.model, options.ctx.modelRegistry, options.modelTier),
		thinkingLevel: options.pi.getThinkingLevel(),
		tools: options.profile.tools,
		resourceLoader: loader,
		sessionManager,
		settingsManager: SettingsManager.create(cwd, getAgentDir()),
	});

	const watcher = watchSession(session, options.maxTurns);
	const cleanupAbort = forwardAbortSignal(session, options.signal);
	let cleanedWorktree = false;
	try {
		await session.prompt(options.prompt);
		const branch = await worktree.cleanup();
		cleanedWorktree = true;
		return {
			responseText: watcher.lastText || lastAssistantText(session) || "Completed with no assistant output.",
			sessionPath: session.sessionFile,
			toolUses: watcher.toolUses,
			turns: watcher.turns,
			worktree: worktree.path ? { path: worktree.path, branch } : undefined,
		};
	} finally {
		if (!cleanedWorktree) await worktree.cleanup().catch(() => undefined);
		cleanupAbort();
		watcher.unsubscribe();
		session.dispose();
	}
}

export function buildHeadlessResourceLoaderOptions(profile: AgentProfile, cwd: string) {
	return {
		cwd,
		agentDir: getAgentDir(),
		settingsManager: SettingsManager.create(cwd, getAgentDir()),
		noExtensions: true,
		noSkills: true,
		noPromptTemplates: true,
		noThemes: true,
		noContextFiles: true,
		systemPromptOverride: () => buildSystemPrompt(profile, cwd),
		appendSystemPromptOverride: () => [],
	};
}

export function selectModelForTier(
	parentModel: Model<any> | undefined,
	modelRegistry: { getAvailable?: () => Model<any>[] },
	tier: ModelTier,
): Model<any> | undefined {
	if (tier === "premium") return parentModel;
	const available = (modelRegistry.getAvailable?.() ?? [])
		.filter((model) => model.input.includes("text"))
		.sort((a, b) => modelCost(a) - modelCost(b));
	if (available.length === 0) return parentModel;
	if (tier === "cheap") return available[0];
	const ceiling = available[Math.max(0, Math.floor((available.length - 1) * 0.66))]!;
	if (parentModel && modelCost(parentModel) <= modelCost(ceiling)) return parentModel;
	return ceiling;
}

function modelCost(model: Model<any>): number {
	return model.cost.input + model.cost.output + model.cost.cacheWrite;
}

function watchSession(session: AgentSession, maxTurns: number) {
	let lastText = "";
	let currentText = "";
	let toolUses = 0;
	let turns = 0;
	let steered = false;
	const unsubscribe = session.subscribe((event: AgentSessionEvent) => {
		if (event.type === "message_start") currentText = "";
		if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
			currentText += event.assistantMessageEvent.delta;
			lastText = currentText;
		}
		if (event.type === "tool_execution_end") toolUses++;
		if (event.type === "turn_end") {
			turns++;
			if (!steered && turns >= maxTurns) {
				steered = true;
				session.steer("Turn limit reached. Return the final concise result now.").catch(() => {});
			}
			if (turns >= maxTurns + 2) session.abort().catch(() => {});
		}
	});
	return {
		get lastText() {
			return lastText;
		},
		get toolUses() {
			return toolUses;
		},
		get turns() {
			return turns;
		},
		unsubscribe,
	};
}

function forwardAbortSignal(session: AgentSession, signal?: AbortSignal): () => void {
	if (!signal) return () => {};
	const abort = () => session.abort().catch(() => {});
	signal.addEventListener("abort", abort, { once: true });
	return () => signal.removeEventListener("abort", abort);
}

function buildSystemPrompt(profile: AgentProfile, cwd: string): string {
	const policy =
		profile.editPolicy === "none"
			? [
					"You are strictly read-only.",
					"Do not create, modify, move, delete, stage, or commit files.",
					"Do not run shell commands that mutate project or system state.",
				]
			: [
					"You may edit files only for this assigned implementation step.",
					"Keep changes scoped, verify them, and report changed paths.",
				];
	return [
		`You are the Spawn ${profile.name} profile.`,
		profile.description,
		`Working directory: ${cwd}`,
		...policy,
		"Use only explicitly provided task context. Do not inherit or assume the parent coding prompt.",
		"Return concise results with findings, verification, blockers, and artifact references.",
	].join("\n\n");
}

function lastAssistantText(session: AgentSession): string {
	for (let index = session.messages.length - 1; index >= 0; index--) {
		const message = session.messages[index];
		if (message.role !== "assistant") continue;
		const text = contentText(message).trim();
		if (text) return text;
	}
	return "";
}

function contentText(message: AgentMessage): string {
	const content = (message as { content?: unknown }).content;
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((part: unknown) => {
			if (typeof part === "string") return part;
			if (!part || typeof part !== "object") return "";
			const typed = part as { type?: unknown; text?: unknown };
			return typed.type === "text" && typeof typed.text === "string" ? typed.text : "";
		})
		.filter(Boolean)
		.join("\n");
}

async function prepareWorktree(options: HeadlessRunOptions): Promise<{
	cwd: string;
	path?: string;
	cleanup: () => Promise<string | undefined>;
}> {
	if (options.profile.editPolicy !== "worktree") return { cwd: options.ctx.cwd, cleanup: async () => undefined };

	await gitOk(options.pi, options.ctx.cwd, ["rev-parse", "--is-inside-work-tree"], 5_000);
	await gitOk(options.pi, options.ctx.cwd, ["rev-parse", "HEAD"], 5_000);
	const suffix = randomUUID().slice(0, 8);
	const path = join(tmpdir(), `spawn-${suffix}`);
	const branch = `spawn-${options.profile.name}-${suffix}`;
	await gitOk(options.pi, options.ctx.cwd, ["worktree", "add", "--detach", path, "HEAD"], 30_000);
	return {
		cwd: path,
		path,
		cleanup: async () => {
			const status = await gitOk(options.pi, path, ["status", "--porcelain"], 10_000);
			if (!status.trim()) {
				await removeWorktree(options.pi, options.ctx.cwd, path);
				return undefined;
			}
			await gitOk(options.pi, path, ["add", "-A"], 10_000);
			await gitOk(options.pi, path, ["commit", "-m", `spawn: ${options.profile.name} run`], 30_000);
			await gitOk(options.pi, path, ["branch", branch], 10_000);
			await removeWorktree(options.pi, options.ctx.cwd, path);
			return branch;
		},
	};
}

async function removeWorktree(pi: ExtensionAPI, cwd: string, path: string): Promise<void> {
	const removed = await pi.exec("git", ["worktree", "remove", "--force", path], { cwd, timeout: 10_000 });
	if (removed.code === 0) return;
	await pi.exec("git", ["worktree", "prune"], { cwd, timeout: 5_000 });
}

async function gitOk(pi: ExtensionAPI, cwd: string, args: string[], timeout: number): Promise<string> {
	const result = await pi.exec("git", args, { cwd, timeout });
	if (result.code !== 0)
		throw new Error(result.stderr.trim() || result.stdout.trim() || `git ${args.join(" ")} failed`);
	return result.stdout;
}
