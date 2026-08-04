import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { colorize } from "../tui/config";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MollieQuotaData {
	isPeak: boolean;
	utilizationPct: number;
	userSpent: number;
	perUserBudget: number;
	activeUsers: number;
	secondsRemaining: number;
}

// null  = offline / unreachable
// undefined = not yet initialized (hide line)
export type MollieQuotaState = MollieQuotaData | null | undefined;

export const MOLLIE_POLL_INTERVAL = 10_000;
const LITELLM_BASE = "http://127.0.0.1:1337";
const TIMEOUT_MS = 10_000;

// ─── Bar constants (match ctx gauge style) ────────────────────────────────────

const BAR_FILLED = "━";
const BAR_EMPTY = "─";
const BAR_WIDTH = 10;

// ─── Fetch ────────────────────────────────────────────────────────────────────

async function fetchWithTimeout(url: string, timeoutMs = TIMEOUT_MS): Promise<Response> {
	const controller = new AbortController();
	const t = setTimeout(() => controller.abort(), timeoutMs);
	try {
		return await fetch(url, { signal: controller.signal });
	} finally {
		clearTimeout(t);
	}
}

export async function fetchMollieStatus(): Promise<MollieQuotaState> {
	try {
		// Health check first — fast, cheap
		const health = await fetchWithTimeout(`${LITELLM_BASE}/health`);
		if (!health.ok) return null;

		const budget = await fetchWithTimeout(`${LITELLM_BASE}/budget/me`);
		if (!budget.ok) return null;

		const data = (await budget.json()) as any;
		const w = data?.window;
		if (!w) return null;

		const userSpent = Number(w.user_spent) || 0;
		const perUserBudget = Number(w.per_user_budget) || 0;
		return {
			isPeak: w.is_peak === true,
			utilizationPct: perUserBudget > 0 ? Math.min(100, (userSpent / perUserBudget) * 100) : 0,
			userSpent,
			perUserBudget,
			activeUsers: Number(w.active_users) || 0,
			secondsRemaining: Number(w.seconds_remaining) || 0,
		};
	} catch {
		return null;
	}
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatSeconds(secs: number): string {
	if (secs <= 0) return "0s";
	const m = Math.floor(secs / 60);
	const s = secs % 60;
	if (m === 0) return `${s}s`;
	if (s === 0) return `${m}m`;
	return `${m}m ${s}s`;
}

function formatDollar(value: number): string {
	return `$${value.toFixed(2)}`;
}

// Peach/orange — catppuccin mocha, not in ThemeColor tokens so use hex
const HEX_PEACH = "#fab387";

function boltColor(data: MollieQuotaData): string {
	// green = online + off-peak, orange = online + peak
	return data.isPeak ? HEX_PEACH : "success";
}

function barColor(pct: number): string {
	if (pct >= 90) return "error";
	if (pct >= 70) return "warning";
	return "success";
}

function dollarColor(pct: number): string {
	if (pct >= 90) return "error";
	if (pct >= 70) return "warning";
	return "success";
}

function userColor(count: number): string {
	if (count < 20) return "success";   // green
	if (count < 50) return "warning";   // yellow
	if (count < 75) return HEX_PEACH;  // orange
	return "error";                     // red
}

// ─── Render ───────────────────────────────────────────────────────────────────

export function renderMollieQuotaLine(
	state: MollieQuotaState,
	theme: Theme,
	width: number,
): string {
	const dim = (s: string) => theme.fg("dim", s);
	const sep = ` ${dim("›")} `;

	// Offline state
	if (state === null) {
		return truncateToWidth(
			colorize(theme, "error", "ϟ mollie — offline"),
			width,
		);
	}

	// Not yet initialized — return empty (caller should not push this line)
	// This branch should not be reached (callers check for undefined)
	if (state === undefined) {
		return "";
	}

	const pct = state.utilizationPct;

	// ϟ bolt (connectivity + peak signal) — text char, takes ANSI color
	const bolt = colorize(theme, boltColor(state), "ϟ");

	// Bar
	const filled = Math.max(0, Math.min(BAR_WIDTH, Math.round((pct / 100) * BAR_WIDTH)));
	const empty = BAR_WIDTH - filled;
	const bar =
		colorize(theme, barColor(pct), BAR_FILLED.repeat(filled)) +
		theme.fg("dim", BAR_EMPTY.repeat(empty));

	// % utilization
	const pctLabel = dim(` ${pct.toFixed(1)}%`);

	// $spent/$max
	const spentLabel =
		colorize(theme, dollarColor(pct), formatDollar(state.userSpent)) +
		dim(`/${state.perUserBudget.toFixed(2)}`);

	// ↺ reset
	const resetLabel = dim(`↺ ${formatSeconds(state.secondsRemaining)}`);

	// users: N 👤
	const uc = userColor(state.activeUsers);
	const usersLabel = colorize(theme, uc, `${state.activeUsers} 👤`);

	// Build left side: ⚡ mollie bar pct › $spent/max › ↺ reset
	const left = [
		`${bolt}${dim(" mollie ")}${bar}${pctLabel}`,
		`${spentLabel}`,
		`${resetLabel}`,
	].join(sep);

	const leftWidth = visibleWidth(left);
	const rightWidth = visibleWidth(usersLabel);
	const totalNeeded = leftWidth + 1 + rightWidth;

	if (totalNeeded <= width) {
		const padding = " ".repeat(Math.max(0, width - leftWidth - rightWidth));
		return truncateToWidth(left + padding + usersLabel, width);
	}

	// Narrow terminal: drop reset, then users
	const compact = [
		`${bolt}${dim(" mollie ")}${bar}${pctLabel}`,
		`${spentLabel}`,
	].join(sep);

	const compactWidth = visibleWidth(compact);
	if (compactWidth + 1 + rightWidth <= width) {
		const padding = " ".repeat(Math.max(0, width - compactWidth - rightWidth));
		return truncateToWidth(compact + padding + usersLabel, width);
	}

	return truncateToWidth(compact, width);
}
