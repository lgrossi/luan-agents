import { existsSync, readdirSync, realpathSync, statSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { basename, dirname, join, parse, relative, resolve } from "node:path";
import { loadSkillsFromDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

const SKILL_COMMAND_PREFIX = "skill:";
const ALLOWED_SKILL_FILES = new Set(["SKILL.md", "agents/openai.yaml"]);

export interface SkillReference {
	name: string;
	filePath: string;
	description?: string;
	displayName?: string;
}

export interface LoadedSkill {
	name: string;
	filePath: string;
	directory: string;
	content: string;
	hasSupportingFiles: boolean;
	supportingFiles: string[];
	supportingFilesTruncated: boolean;
	frontmatterRemoved: boolean;
	sourceChars: number;
}

export interface ProjectSkillDiscovery {
	readonly cwd: string;
	readonly trusted: boolean;
}

const MAX_SUPPORTING_FILE_COUNT = 256;

export function discoverSkills(
	pi: Pick<ExtensionAPI, "getCommands">,
	project?: ProjectSkillDiscovery,
): Map<string, SkillReference> {
	const skills = new Map<string, SkillReference>();
	for (const command of pi.getCommands()) {
		if (command.source !== "skill" || !command.name.startsWith(SKILL_COMMAND_PREFIX)) continue;
		const name = command.name.slice(SKILL_COMMAND_PREFIX.length).trim();
		const filePath = command.sourceInfo?.path;
		if (!name || !filePath || skills.has(name)) continue;
		skills.set(name, { name, filePath: resolve(filePath), description: command.description });
	}
	if (project) addProjectSkills(skills, project);
	return skills;
}

function addProjectSkills(skills: Map<string, SkillReference>, project: ProjectSkillDiscovery): void {
	if (project.trusted) addDirectorySkills(skills, resolve(project.cwd, ".pi", "skills"), true);
	for (const directory of ancestorDirectories(project.cwd)) {
		addAgentDirectorySkills(skills, join(directory, ".agents", "skills"));
	}
}

function addAgentDirectorySkills(skills: Map<string, SkillReference>, directory: string): void {
	for (const skillDirectory of agentSkillDirectories(directory)) {
		addDirectorySkills(skills, skillDirectory, false);
	}
}

function agentSkillDirectories(root: string, visited = new Set<string>()): string[] {
	if (!existsSync(root)) return [];
	let canonical: string;
	try {
		canonical = realpathSync(root);
	} catch {
		return [];
	}
	if (visited.has(canonical)) return [];
	visited.add(canonical);
	if (existsSync(join(root, "SKILL.md"))) return [root];
	const directories: string[] = [];
	for (const entry of readdirSync(root, { withFileTypes: true })) {
		if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
		const path = join(root, entry.name);
		let directory = entry.isDirectory();
		if (entry.isSymbolicLink()) {
			try {
				directory = statSync(path).isDirectory();
			} catch {
				continue;
			}
		}
		if (directory) directories.push(...agentSkillDirectories(path, visited));
	}
	return directories;
}

function addDirectorySkills(
	skills: Map<string, SkillReference>,
	directory: string,
	includeRootMarkdown: boolean,
): void {
	for (const skill of loadSkillsFromDir({ dir: directory, source: "project" }).skills) {
		if (!includeRootMarkdown && basename(skill.filePath) !== "SKILL.md") continue;
		if (!skills.has(skill.name)) {
			skills.set(skill.name, { name: skill.name, filePath: skill.filePath, description: skill.description });
		}
	}
}

function ancestorDirectories(cwd: string): string[] {
	const directories: string[] = [];
	let directory = resolve(cwd);
	const root = parse(directory).root;
	while (true) {
		directories.push(directory);
		if (existsSync(join(directory, ".git")) || directory === root) return directories;
		directory = dirname(directory);
	}
}

export async function addSkillDisplayNames(
	skills: ReadonlyMap<string, SkillReference>,
): Promise<Map<string, SkillReference>> {
	return new Map(
		await Promise.all(
			[...skills].map(async ([name, reference]) => {
				const displayName = await readSkillDisplayName(reference.filePath);
				return [name, displayName ? { ...reference, displayName } : reference] as const;
			}),
		),
	);
}

export function parseSkillDisplayName(source: string): string | undefined {
	const lines = source.split(/\r?\n/u);
	const interfaceLine = lines.findIndex((line) => /^\s*interface:\s*(?:#.*)?$/u.test(line));
	if (interfaceLine < 0) return undefined;
	const interfaceIndent = lines[interfaceLine]?.match(/^\s*/u)?.[0].length ?? 0;
	for (const line of lines.slice(interfaceLine + 1)) {
		if (!line.trim() || /^\s*#/u.test(line)) continue;
		const indent = line.match(/^\s*/u)?.[0].length ?? 0;
		if (indent <= interfaceIndent) return undefined;
		const value = /^\s*display_name:\s*(.*?)\s*$/u.exec(line)?.[1];
		if (value === undefined) continue;
		return parseYamlScalar(value);
	}
	return undefined;
}

async function readSkillDisplayName(skillPath: string): Promise<string | undefined> {
	try {
		return parseSkillDisplayName(await readFile(join(dirname(skillPath), "agents", "openai.yaml"), "utf8"));
	} catch {
		// Optional presentation metadata must never prevent the skill itself from loading.
		return undefined;
	}
}

function parseYamlScalar(value: string): string | undefined {
	if (value.startsWith('"') && value.endsWith('"')) {
		try {
			const parsed = JSON.parse(value);
			return typeof parsed === "string" && parsed.trim() ? parsed.trim() : undefined;
		} catch {
			return undefined;
		}
	}
	if (value.startsWith("'") && value.endsWith("'")) {
		const parsed = value.slice(1, -1).replaceAll("''", "'").trim();
		return parsed || undefined;
	}
	// Deliberate limit: add a YAML dependency if skill metadata starts using block or tagged scalars.
	const parsed = value.replace(/\s+#.*$/u, "").trim();
	return parsed || undefined;
}

export async function loadSkill(reference: SkillReference): Promise<LoadedSkill> {
	const filePath = resolve(reference.filePath);
	const directory = dirname(filePath);
	const source = await readFile(filePath, "utf8");
	const body = stripFrontmatter(source);
	const supportingFiles = await listSupportingFiles(directory);
	const hasSupportingFiles = supportingFiles.paths.length > 0;
	return {
		name: reference.name,
		filePath,
		directory,
		content: hasSupportingFiles ? appendSkillDirectory(body, directory) : body,
		hasSupportingFiles,
		supportingFiles: supportingFiles.paths,
		supportingFilesTruncated: supportingFiles.truncated,
		frontmatterRemoved: body !== source,
		sourceChars: source.length,
	};
}

export function stripFrontmatter(text: string): string {
	if (!text.startsWith("---")) return text;
	const end = text.indexOf("\n---", 3);
	if (end === -1) return text;
	const body = text.indexOf("\n", end + 4);
	return body === -1 ? "" : text.slice(body + 1);
}

async function listSupportingFiles(
	root: string,
	directory = root,
	paths: string[] = [],
): Promise<{ paths: string[]; truncated: boolean }> {
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		const path = resolve(directory, entry.name);
		const relativePath = relative(root, path).replaceAll("\\", "/");
		if (entry.isDirectory()) {
			const nested = await listSupportingFiles(root, path, paths);
			if (nested.truncated) return nested;
			continue;
		}
		if (ALLOWED_SKILL_FILES.has(relativePath)) continue;
		if (paths.length >= MAX_SUPPORTING_FILE_COUNT) return { paths, truncated: true };
		paths.push(relativePath);
	}
	return { paths, truncated: false };
}

function appendSkillDirectory(body: string, directory: string): string {
	const separator = body.endsWith("\n") ? "\n" : "\n\n";
	return `${body}${separator}Skill directory: ${directory}`;
}
