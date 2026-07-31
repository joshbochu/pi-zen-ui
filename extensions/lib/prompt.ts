/**
 * Pure layout helpers for grok's prompt box (spec §3). No Pi imports, no node
 * builtins — everything environmental (theme colours, widths) is passed in, so
 * this module is testable without booting Pi.
 */

/** grok's empty-buffer placeholder (`prompt_widget/mod.rs:3183`). */
export const PLACEHOLDER = "Build anything";

/**
 * Width passed to Pi's symmetrically padded editor before the framed row clips
 * its right pad. Grok has a left inset but no spare cell between a full text
 * row and the right border; rendering `rightPad` columns wide preserves Pi's
 * left padding while reclaiming those columns from the right.
 */
export function editorRenderWidth(
	contentWidth: number,
	promptInset: number,
	rightPad: number,
): number {
	return Math.max(1, contentWidth - promptInset + rightPad);
}

/** Separator between info-line pieces: U+00B7 with single spaces. */
const SEPARATOR = " · ";

// CSI, OSC and APC, each BEL- or ST-terminated. APC must accept BEL because
// Pi's hardware-cursor marker is `\x1b_pi:c\x07` (`pi-tui` CURSOR_MARKER);
// counting it as text used to shrink the cursor row by its 7 code units.
const ANSI = new RegExp(
	[
		/\x1b\[[0-?]*[ -/]*[@-~]/.source,
		/\x1b\][^\x07]*(?:\x07|\x1b\\)/.source,
		/\x1b_[^\x07]*(?:\x07|\x1b\\)/.source,
	].join("|"),
	"g",
);

// ponytail: range table, not full East_Asian_Width — JS regex has no EAW
// property. Covers CJK/fullwidth/emoji, which is all this UI renders.
const WIDE =
	/^(?:[\u1100-\u115F\u2E80-\u303E\u3041-\u33FF\u3400-\u4DBF\u4E00-\u9FFF\uA000-\uA4CF\uA960-\uA97F\uAC00-\uD7A3\uF900-\uFAFF\uFE10-\uFE19\uFE30-\uFE6F\uFF00-\uFF60\uFFE0-\uFFE6]|[\u{1F300}-\u{1F9FF}]|[\u{20000}-\u{3FFFD}])$/u;
/** Combining marks, ZWJ/ZWNJ, variation selectors, other formats. */
const ZERO = /^(?:\p{Mn}|\p{Me}|\p{Cf})$/u;

interface Token {
	readonly text: string;
	readonly width: number;
	readonly escape: boolean;
}

function charWidth(char: string): number {
	if (ZERO.test(char)) return 0;
	return WIDE.test(char) ? 2 : 1;
}

function tokenize(value: string): Token[] {
	const tokens: Token[] = [];
	const push = (chunk: string) => {
		for (const char of chunk) {
			tokens.push({ text: char, width: charWidth(char), escape: false });
		}
	};
	ANSI.lastIndex = 0;
	let index = 0;
	for (let match = ANSI.exec(value); match; match = ANSI.exec(value)) {
		push(value.slice(index, match.index));
		tokens.push({ text: match[0], width: 0, escape: true });
		index = match.index + match[0].length;
	}
	push(value.slice(index));
	return tokens;
}

export function stripAnsi(value: string): string {
	return value.replace(ANSI, "");
}

export function visibleWidth(value: string): number {
	let width = 0;
	for (const token of tokenize(value)) width += token.width;
	return width;
}

export function truncateToWidth(
	value: string,
	width: number,
	ellipsis = "",
): string {
	if (width <= 0) return "";
	if (visibleWidth(value) <= width) return value;
	const ellipsisWidth = visibleWidth(ellipsis);
	if (ellipsisWidth >= width) return truncateToWidth(ellipsis, width);

	const budget = width - ellipsisWidth;
	let used = 0;
	let kept = "";
	let trailing = "";
	let cut = false;
	for (const token of tokenize(value)) {
		// Escapes are width-free: keep them all so colour state is never truncated.
		if (token.escape) {
			if (cut) trailing += token.text;
			else kept += token.text;
			continue;
		}
		if (cut) continue;
		if (used + token.width > budget) {
			cut = true;
			continue;
		}
		used += token.width;
		kept += token.text;
	}
	return kept + ellipsis + trailing;
}

/** Suffix of `value` starting at visible column `start`, escapes preserved. */
function sliceFrom(value: string, start: number): string {
	if (start <= 0) return value;
	let seen = 0;
	let out = "";
	for (const token of tokenize(value)) {
		if (token.escape) {
			out += token.text;
			continue;
		}
		if (seen >= start) {
			out += token.text;
			seen += token.width;
			continue;
		}
		seen += token.width;
		// A wide char straddling the boundary leaves bare columns behind.
		if (seen > start) out += " ".repeat(seen - start);
	}
	return out;
}

export interface InfoLineParts {
	model: string;
	effort: string;
	flags?: readonly string[];
}

export interface InfoLineStyle {
	model: (s: string) => string;
	separator: (s: string) => string;
	flag: (s: string) => string;
}

/** Spec §3: `" " + model (effort) + (" · " + flag)* + " "`. */
export function infoLine(
	parts: InfoLineParts,
	maxWidth: number,
	style: InfoLineStyle,
): string {
	if (maxWidth <= 0) return "";
	const model = parts.effort ? `${parts.model} (${parts.effort})` : parts.model;
	const flags = parts.flags ?? [];
	const sepWidth = visibleWidth(SEPARATOR);

	for (let count = flags.length; count >= 0; count--) {
		const shown = flags.slice(0, count);
		const width =
			2 +
			visibleWidth(model) +
			shown.reduce((sum, flag) => sum + sepWidth + visibleWidth(flag), 0);
		if (width > maxWidth) continue;
		const tail = shown
			.map((flag) => style.separator(SEPARATOR) + style.flag(flag))
			.join("");
		return ` ${style.model(model)}${tail} `;
	}

	const budget = maxWidth - 2;
	if (budget <= 0) return "";
	return ` ${style.model(truncateToWidth(model, budget, "…"))} `;
}

/** Rebuild a lower border with an optional caption while preserving width. */
export function captionOnBottomBorder(
	border: string,
	caption: string,
	width: number,
	connector: string,
): string {
	if (width <= 0) return "";
	const shownConnector = truncateToWidth(connector, width, "");
	const remaining = Math.max(0, width - visibleWidth(shownConnector));
	const shownCaption = truncateToWidth(caption, remaining, "");
	const borderWidth = Math.max(0, remaining - visibleWidth(shownCaption));
	return truncateToWidth(border, borderWidth, "") + shownCaption + shownConnector;
}

/**
 * Write `overlay` onto the right end of `base`, keeping the last `reserve`
 * visible columns of `base`. Result keeps `base`'s visible width; if the
 * overlay cannot fit, `base` is returned unchanged.
 */
export function overlayRight(
	base: string,
	overlay: string,
	reserve: number,
): string {
	const baseWidth = visibleWidth(base);
	const overlayWidth = visibleWidth(overlay);
	const keep = Math.max(0, reserve);
	if (overlayWidth + keep > baseWidth) return base;
	const leftWidth = baseWidth - keep - overlayWidth;
	return (
		(leftWidth > 0 ? truncateToWidth(base, leftWidth) : "") +
		overlay +
		(keep > 0 ? sliceFrom(base, baseWidth - keep) : "")
	);
}

/**
 * Session title on the top border (spec §3, `mod.rs:2977`): renders
 * `" {title} "`, leaving 2 border cells before `╮`. grok caps the padded
 * label at box width - 6 (box = border + 2 corners) and skips the title
 * entirely when that budget is under 6 columns.
 */
export function titleOnBorder(
	border: string,
	title: string,
	style: (s: string) => string,
): string {
	const text = title.trim();
	if (text === "") return border;
	const labelMax = visibleWidth(border) + 2 - 6;
	if (labelMax < 6) return border;
	return overlayRight(
		border,
		style(` ${truncateToWidth(text, labelMax - 2, "…")} `),
		2,
	);
}

/** Paint `text` into `row` at visible column `startCol`, keeping the rest. */
export function placeholderRow(
	row: string,
	text: string,
	startCol: number,
	style: (s: string) => string,
): string {
	const start = Math.max(0, startCol);
	const rowWidth = visibleWidth(row);
	const budget = rowWidth - start;
	const head =
		budget > 0
			? truncateToWidth(row, start)
			: row + " ".repeat(start - rowWidth);
	// budget <= 0: the row is being extended past its end, so nothing to clip to.
	const shown = budget > 0 ? truncateToWidth(text, budget) : text;
	const tail = budget > 0 ? sliceFrom(row, start + visibleWidth(shown)) : "";
	return head + style(shown) + tail;
}
