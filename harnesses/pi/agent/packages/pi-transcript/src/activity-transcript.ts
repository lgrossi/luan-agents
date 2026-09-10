import type { Theme } from "@earendil-works/pi-coding-agent";
import { type Component, Spacer } from "@earendil-works/pi-tui";
import { ComponentStack, sanitizeTuiFieldPreview } from "@luan-pi/pi-libtui";
import { ToolActivity, type TranscriptEntry } from "@luan-pi/pi-libtui/tool";

type ActivityEntry = Exclude<TranscriptEntry, { kind: "content" }>;

/** Use a provider's latest heading or paragraph; do not invent a reasoning summary. */
export function activitySummary(entry: ActivityEntry): string {
	if (entry.kind === "tool") return sanitizeTuiFieldPreview(entry.summary.replace(/^[^\p{L}\p{N}$]+/u, ""), 240);
	const tail = entry.summary.slice(-8_000);
	const headings = [...tail.matchAll(/(?:^|\n)\s*(?:\*\*([^\n]+?)\*\*|#{1,6}\s+([^\n]+))/gu)];
	const heading = headings.at(-1);
	const paragraph = tail
		.trim()
		.split(/\n\s*\n/u)
		.at(-1)
		?.split("\n")[0];
	return sanitizeTuiFieldPreview(heading?.[1] ?? heading?.[2] ?? paragraph ?? "Thinking", 240);
}

class ActivitySection extends ComponentStack {
	private readonly body = new ComponentStack();
	private readonly activity: ToolActivity;
	private entries: readonly ActivityEntry[] = [];

	constructor(theme: Theme, requestRender: () => void) {
		super();
		this.activity = new ToolActivity({
			theme,
			requestRender,
			view: { action: { verb: "Working", status: "running" } },
		});
		this.setChildren([new Spacer(1), this.activity]);
	}

	update(entries: readonly ActivityEntry[]): void {
		if (entries.length === this.entries.length && entries.every((entry, index) => entry === this.entries[index]))
			return;
		this.entries = entries;
		this.body.setChildren(entries.map((entry) => entry.component));
		const latest = entries.at(-1)!;
		const running = entries.some((entry) => entry.running);
		const failures = entries.filter((entry) => entry.failed).length;
		this.activity.update({
			action: {
				verb: activitySummary(latest),
				status: failures ? "failed" : running ? "running" : "succeeded",
				marker: running ? false : undefined,
				meta: [
					`${entries.length} ${entries.length === 1 ? "step" : "steps"}`,
					...(failures ? [`${failures} failed`] : []),
				],
			},
			running,
			payload: { kind: "component", preview: EMPTY, full: this.body },
		});
	}

	dispose(): void {
		this.activity.dispose();
	}
}

const EMPTY: Component = { render: () => [], invalidate() {} };

/** Fold consecutive tools/thinking, leaving assistant text and every other message in place. */
export class ActivityTranscript extends ComponentStack {
	private readonly sections = new Map<object, ActivitySection>();

	constructor(
		private readonly entries: () => readonly TranscriptEntry[],
		private readonly theme: Theme,
		private readonly requestRender: () => void,
	) {
		super();
	}

	render(width: number): string[] {
		const children: Component[] = [];
		const retained = new Set<object>();
		let pending: ActivityEntry[] = [];
		const flush = () => {
			if (!pending.length) return;
			const key = pending[0]!.key;
			let section = this.sections.get(key);
			if (!section) {
				section = new ActivitySection(this.theme, this.requestRender);
				this.sections.set(key, section);
			}
			section.update(pending);
			children.push(section);
			retained.add(key);
			pending = [];
		};
		for (const entry of this.entries()) {
			if (entry.kind !== "content") pending.push(entry);
			else {
				flush();
				children.push(entry.component);
			}
		}
		flush();
		for (const [key, section] of this.sections) {
			if (retained.has(key)) continue;
			section.dispose();
			this.sections.delete(key);
		}
		this.setChildren(children);
		return super.render(width);
	}

	dispose(): void {
		for (const section of this.sections.values()) section.dispose();
		this.sections.clear();
	}
}
