import assert from "node:assert/strict";
import test from "node:test";

import {
	PLACEHOLDER,
	captionOnBottomBorder,
	editorRenderWidth,
	infoLine,
	overlayRight,
	placeholderRow,
	promptRightInset,
	promptWrapWidth,
	stripAnsi,
	titleOnBorder,
	truncateToWidth,
	visibleWidth,
} from "./prompt.ts";

const id = (s: string) => s;
const plainStyle = { model: id, separator: id, flag: id };
const purple = (s: string) => `\x1b[35m${s}\x1b[0m`;
const grey = (s: string) => `\x1b[90m${s}\x1b[0m`;

test("PLACEHOLDER is grok's literal", () => {
	assert.equal(PLACEHOLDER, "Build anything");
});

test("editorRenderWidth keeps matching 1-cell gaps inside both borders", () => {
	const contentWidth = 74;
	const promptInset = 1;
	const editorPadding = 2;
	const markerWidth = 2;
	const sourceWidth = editorRenderWidth(
		contentWidth,
		promptInset,
		editorPadding,
	);

	assert.equal(sourceWidth, contentWidth);
	assert.equal(
		promptWrapWidth(contentWidth, promptInset, editorPadding),
		contentWidth - editorPadding * 2,
	);
	assert.equal(
		promptRightInset(contentWidth, promptInset, editorPadding),
		promptInset,
	);
	assert.equal(
		promptInset +
			markerWidth +
			promptWrapWidth(contentWidth, promptInset, editorPadding) +
			promptInset,
		contentWidth,
	);
});

test("prompt box inner layout stays symmetric across terminal widths", () => {
	const editorPadding = 2;
	const markerWidth = 2;
	const chromeMargin = 2;
	const borders = 2;

	for (let width = 12; width <= 160; width++) {
		const contentWidth = Math.max(1, width - chromeMargin * 2 - borders);
		const promptInset = contentWidth > 1 + 4 ? 1 : 0;
		const wrap = promptWrapWidth(contentWidth, promptInset, editorPadding);
		const right = promptRightInset(contentWidth, promptInset, editorPadding);
		const assembled = promptInset + markerWidth + wrap + right;

		assert.equal(right, promptInset, `asymmetric at width ${width}`);
		assert.equal(assembled, contentWidth, `overflow at width ${width}`);
		assert.equal(wrap, width - 10, `wrap did not track resize at width ${width}`);
		assert.ok(wrap >= 1, `wrap collapsed at width ${width}`);
	}
});

test("stripAnsi removes CSI, OSC (BEL and ST) and APC (BEL and ST)", () => {
	assert.equal(stripAnsi("\x1b[35mhi\x1b[0m"), "hi");
	assert.equal(stripAnsi("a\x1b]11;#030304\x07b"), "ab");
	assert.equal(stripAnsi("a\x1b]0;title\x1b\\b"), "ab");
	assert.equal(stripAnsi("a\x1b_payload\x1b\\b"), "ab");
	// Pi's hardware-cursor marker (`pi-tui` CURSOR_MARKER) is a BEL-terminated
	// APC; it must be width-free or the cursor row loses columns.
	assert.equal(stripAnsi("a\x1b_pi:c\x07b"), "ab");
	assert.equal(visibleWidth("hi\x1b_pi:c\x07"), 2);
	assert.equal(stripAnsi("plain"), "plain");
});

test("visibleWidth counts columns, not bytes", () => {
	assert.equal(visibleWidth("hello"), 5);
	assert.equal(visibleWidth(purple("hello")), 5);
	assert.equal(visibleWidth("日本語"), 6);
	assert.equal(visibleWidth("ｆｕｌｌ"), 8);
	assert.equal(visibleWidth("e\u0301"), 1);
	assert.equal(visibleWidth("a\u200db"), 2);
	assert.equal(visibleWidth(""), 0);
});

test("truncateToWidth clips to the budget", () => {
	assert.equal(truncateToWidth("hello", 9), "hello");
	assert.equal(truncateToWidth("hello", 5), "hello");
	assert.equal(truncateToWidth("hello", 3), "hel");
	assert.equal(truncateToWidth("hello", 0), "");
	assert.equal(truncateToWidth("hello", -2), "");
});

test("truncateToWidth keeps the ellipsis inside the budget", () => {
	assert.equal(truncateToWidth("hello world", 8, "…"), "hello w…");
	assert.equal(visibleWidth(truncateToWidth("hello world", 8, "…")), 8);
	assert.equal(truncateToWidth("hello", 1, "…"), "…");
	assert.equal(truncateToWidth("hello", 2, "..."), "..");
});

test("truncateToWidth never splits a wide character", () => {
	assert.equal(truncateToWidth("日本語", 5), "日本");
	assert.equal(visibleWidth(truncateToWidth("日本語", 5)), 4);
	assert.equal(truncateToWidth("日本語", 4), "日本");
});

test("truncateToWidth does not cut escapes in half", () => {
	const styled = `\x1b[35mhello\x1b[0m`;
	const clipped = truncateToWidth(styled, 3);
	assert.equal(stripAnsi(clipped), "hel");
	assert.equal(clipped, "\x1b[35mhel\x1b[0m");
});

test("infoLine renders model, effort and flags", () => {
	const line = infoLine(
		{ model: "grok-4", effort: "high", flags: ["plan", "auto"] },
		40,
		plainStyle,
	);
	assert.equal(line, " grok-4 • high · plan · auto ");
	assert.equal(visibleWidth(line), 29);
	assert.equal(
		infoLine({ model: "grok-4", effort: "high" }, 40, plainStyle),
		" grok-4 • high ",
	);
	assert.equal(
		infoLine({ model: "grok-4", effort: "" }, 40, plainStyle),
		" grok-4 ",
	);
});

test("infoLine drops flags from the right, then truncates the model", () => {
	const parts = {
		model: "grok-4",
		effort: "high",
		flags: ["plan", "auto"],
	} as const;
	assert.equal(
		infoLine(parts, 29, plainStyle),
		" grok-4 • high · plan · auto ",
	);
	assert.equal(infoLine(parts, 28, plainStyle), " grok-4 • high · plan ");
	assert.equal(infoLine(parts, 21, plainStyle), " grok-4 • high ");
	assert.equal(infoLine(parts, 15, plainStyle), " grok-4 • high ");
	assert.equal(infoLine(parts, 14, plainStyle), " grok-4 • hi… ");
	assert.equal(visibleWidth(infoLine(parts, 14, plainStyle)), 14);
	assert.equal(infoLine(parts, 3, plainStyle), " … ");
	assert.equal(infoLine(parts, 2, plainStyle), "");
	assert.equal(infoLine(parts, 0, plainStyle), "");
	assert.equal(infoLine(parts, -5, plainStyle), "");
});

test("infoLine styles each piece", () => {
	const line = infoLine(
		{ model: "grok-4", effort: "low", flags: ["plan"] },
		40,
		{ model: purple, separator: grey, flag: grey },
	);
	assert.equal(stripAnsi(line), " grok-4 • low · plan ");
	assert.equal(
		line,
		` \x1b[35mgrok-4 • low\x1b[0m\x1b[90m · \x1b[0m\x1b[90mplan\x1b[0m `,
	);
});

test("empty captions preserve top and lower border widths", () => {
	const border = "─".repeat(20);
	const top = titleOnBorder(border, "", id);
	const bottom = captionOnBottomBorder(border, "", 20, "─");
	assert.equal(top, border);
	assert.equal(bottom, border);
	assert.equal(visibleWidth(top), 20);
	assert.equal(visibleWidth(bottom), 20);
});

test("captionOnBottomBorder keeps a visible caption inside the border width", () => {
	const result = captionOnBottomBorder(
		"─".repeat(20),
		" model (high) ",
		20,
		"─",
	);
	assert.equal(result, "───── model (high) ─");
	assert.equal(visibleWidth(result), 20);
});

test("overlayRight writes onto the right end of base", () => {
	assert.equal(overlayRight("0123456789", "AB", 3), "01234AB789");
	assert.equal(visibleWidth(overlayRight("0123456789", "AB", 3)), 10);
	assert.equal(overlayRight("0123456789", "AB", 0), "01234567AB");
});

test("overlayRight returns base when the overlay does not fit", () => {
	assert.equal(overlayRight("0123456789", "ABCDEFG", 3), "ABCDEFG789");
	assert.equal(overlayRight("0123456789", "ABCDEFGH", 3), "0123456789");
	assert.equal(overlayRight("0123", "ABCDEFGH", 0), "0123");
});

test("overlayRight handles wide characters in base", () => {
	assert.equal(overlayRight("日本語", "AB", 2), "日AB語");
	assert.equal(overlayRight("日本語", "A", 3), "日A 語");
	assert.equal(visibleWidth(overlayRight("日本語", "A", 3)), 6);
});

test("overlayRight preserves colour state around the overlay", () => {
	const base = grey("----------");
	const result = overlayRight(base, purple("AB"), 3);
	assert.equal(stripAnsi(result), "-----AB---");
	assert.equal(
		result,
		"\x1b[90m-----\x1b[0m\x1b[35mAB\x1b[0m\x1b[90m---\x1b[0m",
	);
});

test("titleOnBorder leaves 2 border cells before the corner", () => {
	const border = "─".repeat(20);
	const result = titleOnBorder(border, "hello", id);
	assert.equal(result, `${"─".repeat(11)} hello ${"─".repeat(2)}`);
	assert.equal(visibleWidth(result), 20);
});

test("titleOnBorder truncates the label to box width minus 6", () => {
	const result = titleOnBorder("─".repeat(12), "session-title", id);
	assert.equal(result, "── sessi… ──");
	assert.equal(visibleWidth(result), 12);
	assert.equal(titleOnBorder("─".repeat(10), "session-title", id), "── ses… ──");
});

test("titleOnBorder gives up when the label budget is under 6", () => {
	// border 9 → box 11 → labelMax 5: grok skips the title entirely.
	assert.equal(titleOnBorder("─".repeat(9), "session", id), "─".repeat(9));
	assert.equal(titleOnBorder("────────", "session", id), "────────");
	assert.equal(titleOnBorder("─".repeat(20), "", id), "─".repeat(20));
	assert.equal(titleOnBorder("─".repeat(20), "   ", id), "─".repeat(20));
});

test("titleOnBorder styles the rendered title", () => {
	const result = titleOnBorder("─".repeat(12), "cli", purple);
	assert.equal(stripAnsi(result), "───── cli ──");
	assert.ok(result.includes("\x1b[35m cli \x1b[0m"));
});

test("placeholderRow paints into a row at a visible column", () => {
	assert.equal(
		placeholderRow(" ".repeat(10), PLACEHOLDER, 2, id),
		"  Build an",
	);
	assert.equal(
		visibleWidth(placeholderRow(" ".repeat(10), PLACEHOLDER, 2, id)),
		10,
	);
	assert.equal(placeholderRow("0123456789", "ab", 2, id), "01ab456789");
	assert.equal(placeholderRow("0123456789", "ab", 0, id), "ab23456789");
});

test("placeholderRow pads when startCol exceeds the row width", () => {
	assert.equal(placeholderRow("  ", PLACEHOLDER, 4, id), "    Build anything");
	assert.equal(placeholderRow("", PLACEHOLDER, 0, id), "Build anything");
	assert.equal(placeholderRow("012", "ab", 3, id), "012ab");
});

test("placeholderRow keeps the row's own styling around the text", () => {
	const row = grey("0123456789");
	const result = placeholderRow(row, "ab", 2, purple);
	assert.equal(stripAnsi(result), "01ab456789");
	assert.ok(result.includes("\x1b[35mab\x1b[0m"));
	assert.ok(result.startsWith("\x1b[90m01"));
});
