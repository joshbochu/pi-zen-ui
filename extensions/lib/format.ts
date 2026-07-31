/**
 * Pure formatting + colour helpers ported from grok's Rust renderer.
 * See docs/grok-fidelity-spec.md §4 (durations, turn tokens), §5 (context
 * chip, gradient, percent).
 *
 * Deliberately import-free: every input arrives as an argument, so these run
 * under `node --test` without booting Pi.
 */

/** Spec §4 "Duration format" (`util.rs:81`). Takes ms; negatives clamp to 0. */
export function formatDuration(ms: number): string {
	const secs = Number.isFinite(ms) && ms > 0 ? ms / 1000 : 0;
	if (secs < 10) return `${secs.toFixed(1)}s`;
	const whole = Math.floor(secs);
	if (whole < 60) return `${whole}s`;
	if (whole < 3600) return `${Math.floor(whole / 60)}m${whole % 60}s`;
	return `${Math.floor(whole / 3600)}h${Math.floor((whole % 3600) / 60)}m`;
}

function count(n: number): number {
	return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/** Spec §4 "Turn-status token format" (`turn_status.rs:837`) — lowercase k/m. */
export function formatTurnTokens(n: number): string {
	const v = count(n);
	if (v < 1_000) return `${v}`;
	if (v < 10_000) return `${(v / 1_000).toFixed(2)}k`;
	if (v < 100_000) return `${(v / 1_000).toFixed(1)}k`;
	if (v < 1_000_000) return `${Math.floor(v / 1_000)}k`;
	if (v < 10_000_000) return `${(v / 1_000_000).toFixed(2)}m`;
	return `${(v / 1_000_000).toFixed(1)}m`;
}

/** Spec §5 `fmt_tokens` (`context_bar.rs`) — uppercase K/M, coarser than the turn row. */
export function formatContextTokens(n: number): string {
	const v = count(n);
	if (v < 1_000) return `${v}`;
	if (v < 10_000) return `${(v / 1_000).toFixed(1)}K`;
	if (v < 1_000_000) return `${Math.floor(v / 1_000)}K`;
	if (v < 10_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
	return `${Math.floor(v / 1_000_000)}M`;
}

/** Spec §5 `fmt_pct5` — always exactly 5 columns, `"MAX %"` at 100%. */
export function formatPercent5(pct: number): string {
	const p = Number.isFinite(pct) && pct > 0 ? pct : 0;
	if (p >= 100) return "MAX %";
	let body = p < 10 ? p.toFixed(2) : p.toFixed(1);
	// ponytail: rounding can carry into the next tier (9.999 -> "10.00",
	// 99.99 -> "100.0"); step down a tier rather than break the 5-col contract.
	if (body.length > 4) body = p.toFixed(1);
	if (body.length > 4) return "MAX %";
	return `${body}%`;
}

/** `#rgb` or `#rrggbb` → `[r, g, b]`. Throws on anything else. */
export function hexToRgb(hex: string): [number, number, number] {
	const short = hex.trim().replace(/^#/, "");
	const full = short.length === 3 ? short.replace(/./g, (c) => c + c) : short;
	if (!/^[0-9a-fA-F]{6}$/.test(full))
		throw new Error(`invalid hex colour: ${hex}`);
	return [
		Number.parseInt(full.slice(0, 2), 16),
		Number.parseInt(full.slice(2, 4), 16),
		Number.parseInt(full.slice(4, 6), 16),
	];
}

/** Per-channel linear interpolation (`blend_color`). `t` clamps to [0,1]. */
export function blendHex(from: string, to: string, t: number): string {
	const a = hexToRgb(from);
	const b = hexToRgb(to);
	const k = Number.isFinite(t) ? Math.min(1, Math.max(0, t)) : 0;
	const channel = (i: 0 | 1 | 2) =>
		Math.round(a[i] + (b[i] - a[i]) * k)
			.toString(16)
			.padStart(2, "0");
	return `#${channel(0)}${channel(1)}${channel(2)}`;
}

/** Spec §5 `default_breakpoints`, with a configurable accent_user. */
function contextBreakpoints(
	accent: string,
): readonly (readonly [number, string])[] {
	return [
		[0, "#E4E4E4"], // text_primary
		[50, accent], // accent_user
		[65, accent],
		[75, "#EBD96E"], // warning
		[85, "#EBD96E"],
		[95, "#DC5A64"], // accent_error
	];
}

/** Context-usage colour for `percent` (0..100), clamped at both ends. */
export function contextGradientHex(
	percent: number,
	accent = "#C4A7E7",
): string {
	const breakpoints = contextBreakpoints(accent);
	const p = Number.isFinite(percent) ? percent : 0;
	const first = breakpoints[0]!;
	const last = breakpoints.at(-1)!;
	if (p <= first[0]) return blendHex(first[1], first[1], 0);
	if (p >= last[0]) return blendHex(last[1], last[1], 1);
	for (let i = 1; i < breakpoints.length; i++) {
		const [hi, hiHex] = breakpoints[i]!;
		if (p > hi) continue;
		const [lo, loHex] = breakpoints[i - 1]!;
		const span = hi - lo;
		return blendHex(loHex, hiHex, span === 0 ? 1 : (p - lo) / span);
	}
	return blendHex(last[1], last[1], 1);
}

/** Collapse `cwd` under `home` to `~/…`; anything outside `home` is returned as given. */
export function formatCwd(cwd: string, home: string): string {
	const trim = (p: string) => (p.length > 1 ? p.replace(/\/+$/, "") : p);
	const c = trim(cwd);
	const h = trim(home);
	if (!h || !c.startsWith("/")) return cwd;
	if (c === h) return "~";
	const prefix = h.endsWith("/") ? h : `${h}/`;
	if (c.startsWith(prefix)) return `~/${c.slice(prefix.length)}`;
	return cwd;
}
