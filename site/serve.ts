// Local preview: rebuilds site/dist when docs change and serves it with Cloudflare's path rules.
// Run with `bun run dev:site`. Changes to build.ts itself need a restart.
import { watch } from "node:fs";
import { extname, join, resolve } from "node:path";
import { build } from "./build.ts";

const repo = resolve(import.meta.dir, "..");
const dist = join(import.meta.dir, "dist");
const port = Number(process.env.PORT ?? 4321);
const isSource = (file: string) => !file.includes("node_modules") && /(\.md|\.css|\.js|package\.json)$/.test(file);

let pending: ReturnType<typeof setTimeout> | undefined;
for (const dir of ["site", "docs", "harnesses/pi/agent/packages"]) {
	watch(join(repo, dir), { recursive: true }, (_, file) => {
		if (!file || !isSource(file.toString())) return;
		clearTimeout(pending);
		pending = setTimeout(() => build().catch(console.error), 100);
	});
}

await build();
Bun.serve({
	port,
	async fetch(request) {
		const path = new URL(request.url).pathname;
		if (!path.endsWith("/") && extname(path) === "") return Response.redirect(`${path}/`, 308);
		const headers = { "cache-control": "no-store" };
		const file = Bun.file(join(dist, path.endsWith("/") ? `${path}index.html` : path));
		if (await file.exists()) return new Response(file, { headers });
		return new Response(Bun.file(join(dist, "404.html")), { status: 404, headers });
	},
});
console.log(`http://localhost:${port}`);
