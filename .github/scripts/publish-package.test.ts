import { afterEach, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const script = resolve(import.meta.dirname, "publish-package.sh");
const directories: string[] = [];

afterEach(() => {
	for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function release(tag: string) {
	const directory = mkdtempSync(join(tmpdir(), "pi-release-"));
	directories.push(directory);
	for (const name of ["pi-code-mode", "pi-libtui"]) {
		const packageDirectory = join(directory, "harnesses/pi/agent/packages", name);
		mkdirSync(packageDirectory, { recursive: true });
		writeFileSync(join(packageDirectory, "package.json"), JSON.stringify({ name, version: "0.3.8" }));
	}
	const bin = join(directory, "bin");
	mkdirSync(bin);
	const just = join(bin, "just");
	writeFileSync(just, '#!/bin/sh\nprintf "%s\\n" "$@" >> "$CALL_LOG"\n');
	chmodSync(just, 0o755);
	const log = join(directory, "calls");
	writeFileSync(log, "");
	const result = Bun.spawnSync(["bash", script], {
		cwd: directory,
		env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, RELEASE_TAG: tag, CALL_LOG: log },
	});
	return { status: result.exitCode, calls: readFileSync(log, "utf8"), error: result.stderr.toString() };
}

test("publishes only the named package even when another has the same version", () => {
	expect(release("pi-code-mode/v0.3.8")).toEqual({
		status: 0,
		calls: "pi-publish\nharnesses/pi/agent/packages/pi-code-mode\n",
		error: "",
	});
});

test.each(["v0.3.8", "main", "pi-code-mode/../v0.3.8", "pi-code-mode/v0.3.8/extra"])(
	"rejects a non-package release tag: %s",
	(tag) => {
		const result = release(tag);
		expect(result.status).not.toBe(0);
		expect(result.calls).toBe("");
	},
);

test("rejects a tag that does not match the selected manifest version", () => {
	const result = release("pi-code-mode/v0.3.9");
	expect(result.status).not.toBe(0);
	expect(result.calls).toBe("");
	expect(result.error).toContain("does not match");
});
