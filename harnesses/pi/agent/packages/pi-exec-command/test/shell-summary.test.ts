import { describe, expect, test } from "bun:test";
import { type ShellAction, summarizeShellCommand } from "../src/core/shell-summary.ts";

const read = (path: string): ShellAction => ({ kind: "read", path });
const list = (path?: string): ShellAction => (path === undefined ? { kind: "list" } : { kind: "list", path });
const search = (query: string, path?: string): ShellAction =>
	path === undefined ? { kind: "search", query } : { kind: "search", query, path };

describe("shell command summary", () => {
	test.each<[string, ShellAction[]]>([
		["cat src/app.rs", [read("src/app.rs")]],
		["cat a.ts b.ts", [read("a.ts"), read("b.ts")]],
		['cat "my file.txt"', [read("my file.txt")]],
		["sed -n '1,40p' src/lib.rs", [read("src/lib.rs")]],
		["head -50 README.md | tail -20", [read("README.md")]],
		["nl -ba src/x.ts | sed -n '10,20p'", [read("src/x.ts")]],
		["awk '{print $1}' data.csv", [read("data.csv")]],
		["less +G log.txt", [read("log.txt")]],
		["ls -la", [list()]],
		["tree -L 2 src", [list("src")]],
		["rg --files crates | head -100", [list("crates")]],
		["fd -e rs", [list()]],
		["git ls-files src", [list("src")]],
		["rg -n 'foo' src --glob '*.ts'", [search("foo", "src")]],
		["rg -e 'pattern' -t rust", [search("pattern")]],
		["grep -rn TODO . 2>/dev/null", [search("TODO", ".")]],
		["fd main src", [search("main", "src")]],
		["find . -name '*.md' -maxdepth 2", [search("*.md", ".")]],
		["git grep -n foo", [search("foo")]],
		["rg -l foo | xargs grep bar", [search("foo"), search("bar")]],
		["ls src/ && cat src/main.rs", [list("src/"), read("src/main.rs")]],
		["cd crates/exec-command && cat Cargo.toml && ls src", [read("crates/exec-command/Cargo.toml"), list("src")]],
		["bash -lc 'cat foo && ls'", [read("foo"), list()]],
		["cat foo; cat foo", [read("foo")]],
	])("summarizes %s as exploration", (command, actions) => {
		expect(summarizeShellCommand(command)).toEqual({ explored: true, actions });
	});

	test.each([
		"cargo build --release",
		"git status",
		"sed -i 's/a/b/' file",
		"find . -name '*.tmp' -delete",
		"fd -e log -x rm",
		"rg -l foo | xargs sed -i 's/x/y/'",
		"cat foo > bar",
		"echo hi | wc -l",
		"for f in a b; do cat $f; done",
		"cat $(ls)",
		"cat",
		"true",
		"cd src",
		"ls && cargo test",
	])("keeps %s as an opaque run", (command) => {
		expect(summarizeShellCommand(command)).toEqual({ explored: false, actions: [{ kind: "run", command }] });
	});
});
