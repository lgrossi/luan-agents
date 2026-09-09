/** One recognizable step of a shell command. */
export type ShellAction =
	| { kind: "read"; path: string }
	| { kind: "list"; path?: string }
	| { kind: "search"; query?: string; path?: string }
	| { kind: "run"; command: string };

export interface ShellCommandSummary {
	/** Every step reads, lists, or searches; nothing is shown as a raw command. */
	explored: boolean;
	actions: readonly ShellAction[];
}

const CONNECTORS = new Set(["&&", "||", "|", ";"]);
const CONTROL_WORDS = new Set([
	"for",
	"while",
	"until",
	"if",
	"then",
	"else",
	"elif",
	"fi",
	"do",
	"done",
	"case",
	"esac",
]);
const FORMATTING = new Set([
	"wc",
	"tr",
	"cut",
	"sort",
	"uniq",
	"tee",
	"column",
	"yes",
	"printf",
	"echo",
	"true",
	"cat",
]);
/** Flags whose value is a separate token, so the value is not an operand. */
const VALUE_FLAGS: Record<string, readonly string[]> = {
	rg: [
		"-g",
		"--glob",
		"--iglob",
		"-t",
		"--type",
		"--type-add",
		"--type-not",
		"-m",
		"--max-count",
		"-A",
		"-B",
		"-C",
		"--context",
		"--max-depth",
		"-r",
		"--replace",
		"-f",
		"--file",
	],
	grep: ["-m", "--max-count", "-A", "-B", "-C", "--context", "--include", "--exclude", "--exclude-dir", "-f", "--file"],
	ag: ["-G", "-g", "--ignore-dir", "--ignore"],
	fd: ["-e", "--extension", "-t", "--type", "-d", "--max-depth", "-E", "--exclude", "-j", "--threads"],
	ls: [
		"-I",
		"--ignore",
		"--ignore-glob",
		"-w",
		"--width",
		"--block-size",
		"--color",
		"--sort",
		"--time-style",
		"--time",
	],
	tree: ["-L", "-P", "-I", "--charset", "--filelimit", "--sort"],
	du: ["-d", "--max-depth", "-B", "--block-size", "--exclude", "--time-style"],
	head: ["-n", "-c"],
	sed: ["-e", "--expression", "-f", "--file"],
	awk: ["-F", "-v", "-f"],
	bat: ["--theme", "--language", "-l", "--style", "--line-range", "-r", "--map-syntax", "--tabs", "--terminal-width"],
	less: ["-p", "-P", "-x", "-y", "-z", "-j", "--pattern", "--prompt", "--tabs", "--shift", "--jump-target"],
};

/** Classify a shell command into exploration steps, or a single opaque run. */
export function summarizeShellCommand(command: string): ShellCommandSummary {
	const run: ShellCommandSummary = { explored: false, actions: [{ kind: "run", command }] };
	if (/`|\$\(/u.test(command)) return run;
	const withoutRedirections = stripRedirections(command);
	if (withoutRedirections === undefined) return run;
	const tokens = unwrapShell(shellSplit(withoutRedirections));
	if (tokens.some((token) => CONTROL_WORDS.has(token) || /^[(){}&]$/u.test(token))) return run;
	const parts = splitOnConnectors(tokens);
	const kept = parts.length > 1 ? parts.filter((part) => !isFormattingCommand(part)) : parts;
	const actions: ShellAction[] = [];
	let cwd: string | undefined;
	for (const part of kept) {
		if (part[0] === "cd") {
			cwd = part[1] === undefined ? undefined : joinPaths(cwd, part[1]);
			continue;
		}
		const classified = classify(part);
		if (!classified) return run;
		for (const action of classified)
			actions.push(action.kind === "read" && cwd ? { kind: "read", path: joinPaths(cwd, action.path) } : action);
	}
	if (actions.length === 0) return run;
	return { explored: true, actions: actions.filter((action, index) => !sameAction(action, actions[index - 1])) };
}

function classify(tokens: readonly string[]): ShellAction[] | undefined {
	const [head = "", ...tail] = tokens;
	const name = head.replace(/\\/gu, "/").split("/").at(-1) ?? head;
	switch (name) {
		case "xargs":
			return classify(skipFlags(tail, ["-I", "-L", "-n", "-P", "-s", "-E", "-e", "-d"]));
		case "cat":
		case "more":
			return reads(operands(tail, []));
		case "bat":
		case "batcat":
			return reads(operands(tail, VALUE_FLAGS.bat!));
		case "less":
			return reads(operands(tail, VALUE_FLAGS.less!).filter((token) => !token.startsWith("+")));
		case "head":
		case "tail":
			return reads(operands(tail, VALUE_FLAGS.head!));
		case "nl":
			return reads(operands(tail, ["-s", "-w", "-v", "-i", "-b"]));
		case "sed": {
			if (tail.some((token) => token === "-i" || token.startsWith("-i") || token === "--in-place")) return undefined;
			const inline = tail.some((token) => token === "-e" || token === "--expression");
			const [script, ...files] = operands(tail, VALUE_FLAGS.sed!);
			return reads(inline ? [script ?? "", ...files].filter(Boolean) : files);
		}
		case "awk": {
			const [, ...files] = operands(tail, VALUE_FLAGS.awk!);
			return reads(files);
		}
		case "ls":
		case "eza":
		case "exa":
			return [list(operands(tail, VALUE_FLAGS.ls!)[0])];
		case "tree":
			return [list(operands(tail, VALUE_FLAGS.tree!)[0])];
		case "du":
			return [list(operands(tail, VALUE_FLAGS.du!)[0])];
		case "rg":
		case "rga": {
			const query = flagValue(tail, ["-e", "--regexp"]);
			const [first, second] = operands(tail, [...VALUE_FLAGS.rg!, "-e", "--regexp"]);
			if (tail.includes("--files")) return [list(first)];
			return query !== undefined ? [search(query, first)] : first === undefined ? undefined : [search(first, second)];
		}
		case "grep":
		case "egrep":
		case "fgrep":
		case "ag":
		case "ack": {
			const flags = name === "ag" || name === "ack" ? VALUE_FLAGS.ag! : VALUE_FLAGS.grep!;
			const query = flagValue(tail, ["-e", "--regexp"]);
			const [first, second] = operands(tail, [...flags, "-e", "--regexp"]);
			return query !== undefined ? [search(query, first)] : first === undefined ? undefined : [search(first, second)];
		}
		case "git": {
			const [sub = "", ...rest] = tail;
			if (sub === "grep") {
				const [query, path] = operands(rest, ["-e", "-m", "--max-count", "-A", "-B", "-C"]);
				return query === undefined ? undefined : [search(query, path)];
			}
			if (sub === "ls-files") return [list(operands(rest, ["--exclude", "--exclude-from"])[0])];
			return undefined;
		}
		case "fd": {
			if (tail.some((token) => /^(-x|--exec|-X|--exec-batch)$/u.test(token))) return undefined;
			const [pattern, path] = operands(tail, VALUE_FLAGS.fd!);
			return [pattern === undefined ? list(path) : search(pattern, path)];
		}
		case "find": {
			if (tail.some((token) => /^-(exec|execdir|ok|okdir|delete)$/u.test(token))) return undefined;
			const path = tail[0]?.startsWith("-") === false ? tail[0] : undefined;
			const query = flagValue(tail, ["-name", "-iname", "-path", "-ipath", "-regex", "-iregex"]);
			return [query === undefined ? list(path) : search(query, path)];
		}
		default:
			return undefined;
	}
}

function reads(paths: readonly string[]): ShellAction[] | undefined {
	return paths.length === 0 ? undefined : paths.map((path) => ({ kind: "read", path }));
}

function list(path: string | undefined): ShellAction {
	return path === undefined ? { kind: "list" } : { kind: "list", path };
}

function search(query: string, path: string | undefined): ShellAction {
	return path === undefined ? { kind: "search", query } : { kind: "search", query, path };
}

/** Non-flag operands, honoring `--` and flags that consume the following token. */
function operands(tokens: readonly string[], valueFlags: readonly string[]): string[] {
	const result: string[] = [];
	let literal = false;
	for (let index = 0; index < tokens.length; index += 1) {
		const token = tokens[index]!;
		if (literal || token === "-") result.push(token);
		else if (token === "--") literal = true;
		else if (valueFlags.includes(token)) index += 1;
		else if (!token.startsWith("-")) result.push(token);
	}
	return result;
}

function skipFlags(tokens: readonly string[], valueFlags: readonly string[]): string[] {
	let index = 0;
	while (index < tokens.length && tokens[index]!.startsWith("-")) {
		if (tokens[index] === "--") return tokens.slice(index + 1);
		index += valueFlags.includes(tokens[index]!) ? 2 : 1;
	}
	return tokens.slice(index);
}

function flagValue(tokens: readonly string[], flags: readonly string[]): string | undefined {
	const index = tokens.findIndex((token) => flags.includes(token));
	return index >= 0 ? tokens[index + 1] : undefined;
}

/** A pipeline stage that only reshapes upstream output, so it is not a separate step. */
function isFormattingCommand(tokens: readonly string[]): boolean {
	const [head = "", ...tail] = tokens;
	if (FORMATTING.has(head)) return operands(tail, []).length === 0 || head !== "cat";
	if (head === "head" || head === "tail") return operands(tail, VALUE_FLAGS.head!).length === 0;
	if (head === "nl") return operands(tail, ["-s", "-w", "-v", "-i", "-b"]).length === 0;
	if (head === "sed") return classify(tokens) === undefined && !tail.some((token) => token.startsWith("-i"));
	if (head === "awk") return operands(tail, VALUE_FLAGS.awk!).length <= 1;
	return false;
}

/** Unwrap `bash -c script` so the script's own steps are classified. */
function unwrapShell(tokens: readonly string[]): string[] {
	const shell = tokens[0]?.replace(/\\/gu, "/").split("/").at(-1);
	if (tokens.length === 3 && (shell === "bash" || shell === "sh" || shell === "zsh") && /^-l?c$/u.test(tokens[1]!))
		return unwrapShell(shellSplit(tokens[2]!));
	return [...tokens];
}

/** Drop redirections; `undefined` when output is redirected into a file, which mutates. */
function stripRedirections(command: string): string | undefined {
	let mutates = false;
	const stripped = command.replace(
		/(^|\s)\d*(<|>{1,2})(&?)\s*(\S+)/gu,
		(_, lead: string, op: string, amp: string, target: string) => {
			if (op !== "<" && amp === "" && target !== "/dev/null") mutates = true;
			return lead;
		},
	);
	return mutates ? undefined : stripped;
}

function splitOnConnectors(tokens: readonly string[]): string[][] {
	const parts: string[][] = [[]];
	for (const token of tokens) {
		if (CONNECTORS.has(token)) parts.push([]);
		else parts.at(-1)!.push(token);
	}
	return parts.filter((part) => part.length > 0);
}

function joinPaths(base: string | undefined, extra: string): string {
	if (base === undefined || extra.startsWith("/") || extra.startsWith("~")) return extra;
	return `${base.replace(/\/$/u, "")}/${extra.replace(/^\.\//u, "")}`;
}

function sameAction(left: ShellAction, right: ShellAction | undefined): boolean {
	return right !== undefined && JSON.stringify(left) === JSON.stringify(right);
}

/** Quote-aware word split; connectors and newlines become their own tokens. */
export function shellSplit(input: string): string[] {
	const tokens: string[] = [];
	let current = "";
	let quoted = false;
	let quote: "'" | '"' | undefined;
	const flush = () => {
		if (current.length > 0 || quoted) tokens.push(current);
		current = "";
		quoted = false;
	};
	for (let index = 0; index < input.length; index += 1) {
		const char = input[index]!;
		const next = input[index + 1];
		if (quote) {
			if (char === quote) quote = undefined;
			else if (char === "\\" && quote === '"' && next !== undefined) {
				current += next;
				index += 1;
			} else current += char;
			continue;
		}
		if (char === "'" || char === '"') {
			quote = char;
			quoted = true;
		} else if (char === "\\" && next !== undefined) {
			current += next;
			index += 1;
		} else if ((char === "&" || char === "|") && next === char) {
			flush();
			tokens.push(char + char);
			index += 1;
		} else if (char === "|" || char === ";" || char === "\n") {
			flush();
			tokens.push(char === "\n" ? ";" : char);
		} else if (/\s/u.test(char)) flush();
		else current += char;
	}
	flush();
	return tokens;
}
