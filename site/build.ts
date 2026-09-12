// Renders the package READMEs and repository docs into a static site under site/dist.
// Run with `bun run build:site`. No dependencies beyond Bun.
import { cp, mkdir, readdir, rm } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { bundledLanguages, codeToHtml } from "shiki";

const repo = resolve(import.meta.dir, "..");
const packagesDir = join(repo, "harnesses/pi/agent/packages");
const docsDir = join(repo, "docs");
const out = join(import.meta.dir, "dist");
const sourceUrl = "https://github.com/luan/agents";
const host = "pi.luan.sh";
const siteTitle = "Luan's Pi extensions";

type Heading = { id: string; text: string };
type Group = "overview" | "extensions" | "libraries" | "repository";
type Page = {
	source: string;
	url: string;
	title: string;
	group: Group;
	// Package directory name for package pages; subpages share it with their README.
	pkg?: string;
	html: string;
	headings: Heading[];
};
type Manifest = { name: string; description: string };

const escapeHtml = (text: string) =>
	text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const stripTags = (html: string) => html.replace(/<[^>]+>/g, "");
const slug = (text: string) =>
	stripTags(text)
		.toLowerCase()
		.replace(/&[a-z]+;/g, "")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "");
const isReadme = (page: Page) => basename(page.source) === "README.md";
const isLibrary = (pkg: string) => pkg.startsWith("pi-lib");

// Inline so they follow the theme via currentColor. The npm mark is the simple-icons path.
const PI_ICON =
	'<svg viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="12" fill="currentColor"/><text x="32" y="47" text-anchor="middle" font-family="Maple Mono NF, monospace" font-size="44" font-weight="700" fill="var(--base)">π</text></svg>';
const NPM_ICON =
	'<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M1.763 0C.786 0 0 .786 0 1.763v20.474C0 23.214.786 24 1.763 24h20.474c.977 0 1.763-.786 1.763-1.763V1.763C24 .786 23.214 0 22.237 0zM5.13 5.323l13.837.019-.009 13.836h-3.464l.01-10.382h-3.456L12.04 19.17H5.113z"/></svg>';

function packageLinks(name: string): string {
	return `<span class="package-links"><a href="https://pi.dev/packages/${name}" title="Pi gallery" aria-label="${escapeHtml(name)} on the Pi gallery">${PI_ICON}</a><a href="https://www.npmjs.com/package/${name}" title="npm" aria-label="${escapeHtml(name)} on npm">${NPM_ICON}</a></span>`;
}

// Package READMEs open with "# name" followed by gallery/npm icon images; the site swaps in its own inline icons.
function inlinePackageLinks(html: string, name: string): string {
	return html.replace(/<h1>([^<]*?)\s*<a href="https:\/\/pi\.dev\/packages\/.*?<\/h1>/, (_, title: string) => {
		return `<h1>${title}${packageLinks(name)}</h1>`;
	});
}
const unescapeHtml = (text: string) =>
	text
		.replaceAll("&lt;", "<")
		.replaceAll("&gt;", ">")
		.replaceAll("&quot;", '"')
		.replaceAll("&#39;", "'")
		.replaceAll("&#x27;", "'")
		.replaceAll("&amp;", "&");

// Fenced code becomes Shiki markup carrying both Catppuccin palettes; style.css picks one per theme.
async function highlightCode(html: string): Promise<string> {
	const fence = /<pre><code(?: class="language-([^"]+)")?>([\s\S]*?)<\/code><\/pre>/g;
	const rendered = await Promise.all(
		[...html.matchAll(fence)].map(([, lang = "text", escaped = ""]) =>
			codeToHtml(unescapeHtml(escaped).replace(/\n$/, ""), {
				lang: lang in bundledLanguages ? lang : "text",
				themes: { light: "catppuccin-latte", dark: "catppuccin-mocha" },
				defaultColor: false,
			}),
		),
	);
	let index = 0;
	return html.replace(fence, () => rendered[index++] ?? "");
}

async function render(
	markdown: string,
	packageName?: string,
): Promise<{ html: string; title: string; headings: Heading[] }> {
	const html = inlineVideos(await highlightCode(Bun.markdown.html(markdown)));
	// Wide tables scroll inside a wrapper instead of stretching the page.
	const rendered = addHeadingIds(
		html.replaceAll("<table>", '<div class="table"><table>').replaceAll("</table>", "</table></div>"),
	);
	// After the title is taken from the plain heading, so icon markup never leaks into it.
	return packageName ? { ...rendered, html: inlinePackageLinks(rendered.html, packageName) } : rendered;
}

// A preview image followed by a "Watch the demo" MP4 link becomes one inline player with the image as poster.
function inlineVideos(html: string): string {
	return html.replace(
		/<p><img src="([^"]+)" alt="([^"]*)" ?\/?><\/p>\n<p><a href="([^"]+\.mp4)">[^<]*<\/a>\.?<\/p>/g,
		(_, poster: string, alt: string, video: string) =>
			`<video controls preload="metadata" playsinline poster="${poster}" src="${video}" aria-label="${alt}"></video>`,
	);
}

// Bun.markdown has no heading-id support, so headings get ids after rendering. The h1 becomes the page title.
function addHeadingIds(html: string): { html: string; title: string; headings: Heading[] } {
	const headings: Heading[] = [];
	const seen = new Set<string>();
	let title = "";
	const withIds = html.replace(/<h([1-6])>(.*?)<\/h\1>/g, (_, level: string, inner: string) => {
		const text = stripTags(inner);
		if (level === "1" && !title) {
			title = text.trim();
			return `<h1>${inner}</h1>`;
		}
		let id = slug(inner);
		while (seen.has(id)) id = `${id}-`;
		seen.add(id);
		if (level === "2") headings.push({ id, text });
		return `<h${level} id="${id}"><a href="#${id}">${inner}</a></h${level}>`;
	});
	return { html: withIds, title, headings };
}

async function listMarkdown(dir: string): Promise<string[]> {
	const entries = await readdir(dir, { withFileTypes: true, recursive: true });
	return entries
		.filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
		.map((entry) => join(entry.parentPath, entry.name))
		.sort();
}

// `README.md` becomes the directory index; other files become sibling directories.
function urlFor(prefix: string, relativePath: string): string {
	const parts = relativePath.split("/");
	const file = parts.pop() ?? "";
	if (file !== "README.md") parts.push(file.slice(0, -".md".length));
	return `/${[prefix, ...parts].join("/")}/`;
}

async function loadPage(source: string, url: string, group: Group, pkg?: string, name?: string): Promise<Page> {
	const rendered = await render(await Bun.file(source).text(), name);
	return { source, url, group, pkg, ...rendered, title: rendered.title || basename(source, ".md") };
}

async function readManifests(): Promise<Map<string, Manifest>> {
	const manifests = new Map<string, Manifest>();
	for (const entry of await readdir(packagesDir, { withFileTypes: true })) {
		const file = Bun.file(join(packagesDir, entry.name, "package.json"));
		if (entry.isDirectory() && (await file.exists())) manifests.set(entry.name, (await file.json()) as Manifest);
	}
	return new Map([...manifests].sort(([a], [b]) => a.localeCompare(b)));
}

function packageTable(manifests: Map<string, Manifest>, libraries: boolean): string {
	const rows = [...manifests]
		.filter(([pkg]) => isLibrary(pkg) === libraries)
		.map(
			([pkg, manifest]) =>
				`| [\`${manifest.name}\`](/packages/${pkg}/)${packageLinks(manifest.name)} | ${manifest.description}. |`,
		);
	return ["| Package | Description |", "| --- | --- |", ...rows].join("\n");
}

async function collectPages(manifests: Map<string, Manifest>): Promise<Page[]> {
	const pages: Page[] = [];
	const indexSource = join(import.meta.dir, "index.md");
	const indexMarkdown = (await Bun.file(indexSource).text())
		.replace("<!-- extensions -->", packageTable(manifests, false))
		.replace("<!-- libraries -->", packageTable(manifests, true));
	pages.push({ source: indexSource, url: "/", group: "overview", ...(await render(indexMarkdown)) });

	for (const source of await listMarkdown(packagesDir)) {
		const relativePath = relative(packagesDir, source);
		const [pkg, file, ...rest] = relativePath.split("/");
		// Only a package's top-level Markdown is documentation; deeper files belong to node_modules or tests.
		if (!pkg || !file || rest.length > 0 || !manifests.has(pkg)) continue;
		const group = isLibrary(pkg) ? "libraries" : "extensions";
		pages.push(await loadPage(source, urlFor("packages", relativePath), group, pkg, manifests.get(pkg)?.name));
	}
	for (const source of await listMarkdown(docsDir)) {
		pages.push(await loadPage(source, urlFor("docs", relative(docsDir, source)), "repository"));
	}
	return pages;
}

// Relative Markdown links between source files become site links; everything else is left alone.
function rewriteLinks(page: Page, pages: Page[]): string {
	const bySource = new Map(pages.map((other) => [other.source, other]));
	return (
		page.html
			.replace(/href="([^"#:/][^"#:]*)(#[^"]*)?"/g, (match, href: string, hash = "") => {
				const target = bySource.get(resolve(dirname(page.source), href));
				return target ? `href="${target.url}${hash}"` : match;
			})
			// READMEs address site-hosted media absolutely so they work on GitHub and npm; serve it from this origin.
			.replaceAll(`="https://${host}/`, '="/')
	);
}

function navGroup(label: string, pages: Page[], current: Page): string {
	const items = pages.map((page) => {
		const active = page.pkg ? page.pkg === current.pkg : page === current;
		const headings =
			active && current.headings.length > 0
				? `<ul>${current.headings.map((h) => `<li><a href="#${h.id}">${escapeHtml(h.text)}</a></li>`).join("")}</ul>`
				: "";
		const ariaCurrent = page === current ? ' aria-current="page"' : "";
		return `<li${active ? ' class="active"' : ""}><a href="${page.url}"${ariaCurrent}>${escapeHtml(page.pkg ?? page.title)}</a>${headings}</li>`;
	});
	return `<section><h2>${label}</h2><ul>${items.join("")}</ul></section>`;
}

function layout(current: Page, pages: Page[]): string {
	const entries = (group: Group) => pages.filter((page) => page.group === group && (!page.pkg || isReadme(page)));
	const nav = [
		navGroup("Overview", entries("overview"), current),
		navGroup("Extensions", entries("extensions"), current),
		navGroup("Libraries", entries("libraries"), current),
		navGroup("Repository", entries("repository"), current),
	].join("");
	// Extra Markdown files in a package (such as protocol notes) are reachable from every page of that package.
	const siblings = current.pkg ? pages.filter((page) => page.pkg === current.pkg) : [];
	const subnav =
		siblings.length > 1
			? `<nav class="siblings" aria-label="Package pages">${siblings.map((page) => `<a href="${page.url}"${page === current ? ' aria-current="page"' : ""}>${escapeHtml(basename(page.source, ".md"))}</a>`).join("")}</nav>`
			: "";
	const edit = `${sourceUrl}/blob/main/${relative(repo, current.source)}`;
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${current.url === "/" ? siteTitle : `${escapeHtml(current.title)} · ${siteTitle}`}</title>
<link rel="stylesheet" href="/style.css">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<script>document.documentElement.dataset.theme=localStorage.theme??(matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light")</script>
<script src="/app.js" defer></script>
</head>
<body>
<header class="sidebar">
<div class="brand"><a href="/">${host}</a><button type="button" id="theme" aria-label="Toggle color scheme">◐</button></div>
<details class="menu" open><summary>Contents</summary><nav aria-label="Site">${nav}</nav></details>
</header>
<main tabindex="-1">
${subnav}
<article>${rewriteLinks(current, pages)}</article>
<footer><a href="${edit}">Edit this page</a> · <a href="${sourceUrl}">Source</a></footer>
</main>
</body>
</html>
`;
}

export async function build(): Promise<void> {
	const pages = await collectPages(await readManifests());
	await rm(out, { recursive: true, force: true });
	for (const page of pages) {
		await mkdir(join(out, page.url), { recursive: true });
		await Bun.write(join(out, page.url, "index.html"), layout(page, pages));
	}
	const notFound: Page = {
		source: join(import.meta.dir, "index.md"),
		url: "/404",
		title: "Not found",
		group: "overview",
		html: '<h1>Not found</h1><p>No page exists at this address. <a href="/">Return to the overview.</a></p>',
		headings: [],
	};
	await Bun.write(join(out, "404.html"), layout(notFound, pages));
	await cp(join(import.meta.dir, "style.css"), join(out, "style.css"));
	await cp(join(import.meta.dir, "app.js"), join(out, "app.js"));
	await cp(join(import.meta.dir, "favicon.svg"), join(out, "favicon.svg"));
	await cp(join(import.meta.dir, "icons"), join(out, "icons"), { recursive: true });
	await cp(join(import.meta.dir, "fonts"), join(out, "fonts"), { recursive: true });
	await cp(join(import.meta.dir, "media"), join(out, "media"), { recursive: true });
	console.log(`Wrote ${pages.length} pages to ${relative(repo, out)}`);
}

if (import.meta.main) await build();
