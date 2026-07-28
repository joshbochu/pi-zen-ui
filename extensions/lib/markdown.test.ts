import assert from "node:assert/strict";
import test from "node:test";
import {
	grokMarkdownTheme,
	type GrokMarkdownPalette,
	type MarkdownThemeLike,
} from "./markdown.ts";

const palette: GrokMarkdownPalette = {
	headingLevel: (level, s) => `h${level}<${s}>`,
	muted: (s) => `m<${s}>`,
	codeBg: (s) => `bg<${s}>`,
};

function makeBase(extra: Partial<MarkdownThemeLike> = {}): MarkdownThemeLike {
	return {
		heading: (s) => `H<${s}>`,
		hr: (s) => `HR<${s}>`,
		listBullet: (s) => `L<${s}>`,
		codeBlockBorder: (s) => `B<${s}>`,
		codeBlock: (s) => `C<${s}>`,
		// These land on the index signature (`unknown`), so annotate explicitly.
		quote: (s: string) => `Q<${s}>`,
		italic: (s: string) => `I<${s}>`,
		custom: 42,
		...extra,
	};
}

const visible = (s: string) => [...s.replace(/\x1b\[[0-9;]*m/g, "")].length;

test("heading markers are swallowed at every level", () => {
	const theme = grokMarkdownTheme(makeBase(), palette);
	for (const marker of ["# ", "## ", "### ", "#### ", "##### ", "###### "]) {
		assert.equal(theme.heading(marker), "");
	}
});

test("underlined heading text is H1; everything else is H2", () => {
	const theme = grokMarkdownTheme(makeBase(), palette);
	// Pi styles H1 as heading(bold(underline(text))) and H2+ as heading(bold(text)),
	// so the underline SGR is the only level signal that arrives with the text.
	assert.equal(
		theme.heading("\x1b[1m\x1b[4mOne\x1b[24m\x1b[22m"),
		"h1<\x1b[1m\x1b[4mOne\x1b[24m\x1b[22m>",
	);
	assert.equal(theme.heading("\x1b[1mTwo\x1b[22m"), "h2<\x1b[1mTwo\x1b[22m>");
	assert.equal(theme.heading("Plain"), "h2<Plain>");
});

test("underline detection tolerates combined SGR parameters", () => {
	const theme = grokMarkdownTheme(makeBase(), palette);
	for (const sgr of [
		"\x1b[4m",
		"\x1b[1;4m",
		"\x1b[4;38;5;12m",
		"\x1b[38;5;12;4m",
	]) {
		assert.equal(theme.heading(`${sgr}T\x1b[0m`), `h1<${sgr}T\x1b[0m>`, sgr);
	}
	// A colour that merely contains a 4 elsewhere must not read as underline.
	assert.equal(theme.heading("\x1b[34mT\x1b[0m"), "h2<\x1b[34mT\x1b[0m>");
	assert.equal(theme.heading("\x1b[14mT\x1b[0m"), "h2<\x1b[14mT\x1b[0m>");
});

test("a marker never colours the heading that follows it", () => {
	// Regression: Pi emits the heading text BEFORE the marker, so a scheme that
	// remembered the marker's level leaked it onto the next heading.
	const theme = grokMarkdownTheme(makeBase(), palette);
	assert.equal(theme.heading("Three"), "h2<Three>");
	assert.equal(theme.heading("### "), "");
	assert.equal(theme.heading("Next"), "h2<Next>");
});

test("marker detection ignores ANSI added by base.bold", () => {
	const theme = grokMarkdownTheme(makeBase(), palette);
	assert.equal(theme.heading("\x1b[1m##### \x1b[0m"), "");
});

test("a hash that is not a bare marker is heading text", () => {
	const theme = grokMarkdownTheme(makeBase(), palette);
	assert.equal(theme.heading("#tag"), "h2<#tag>");
	assert.equal(theme.heading("####### "), "h2<####### >");
});

test("unordered bullets become a muted U+2022 of identical width", () => {
	const theme = grokMarkdownTheme(makeBase(), palette);
	for (const marker of ["- ", "* ", "+ "]) {
		assert.equal(theme.listBullet(marker), "m<\u2022 >");
		assert.equal(visible("\u2022 "), visible(marker));
	}
});

test("task boxes keep their text; an unordered dash still becomes a bullet", () => {
	const theme = grokMarkdownTheme(makeBase(), palette);
	assert.equal(theme.listBullet("- [x] "), "m<\u2022 [x] >");
	assert.equal(theme.listBullet("* [ ] "), "m<\u2022 [ ] >");
	assert.equal(theme.listBullet("1. [x] "), "L<1. [x] >");
});

test("ordered markers keep their digits and the base style", () => {
	const theme = grokMarkdownTheme(makeBase(), palette);
	assert.equal(theme.listBullet("1. "), "L<1. >");
	assert.equal(theme.listBullet("12. "), "L<12. >");
	assert.equal(theme.listBullet("3) "), "L<3) >");
});

test("hr is exactly three box-drawing chars regardless of width", () => {
	const theme = grokMarkdownTheme(makeBase(), palette);
	assert.equal(theme.hr("\u2500".repeat(80)), "m<\u2500\u2500\u2500>");
	assert.equal(theme.hr("\u2500".repeat(12)), "m<\u2500\u2500\u2500>");
});

test("fence lines and the language tag are suppressed", () => {
	const theme = grokMarkdownTheme(makeBase(), palette);
	assert.equal(theme.codeBlockBorder("```ts"), "");
	assert.equal(theme.codeBlockBorder("```"), "");
});

test("code lines are padded to the code width minus the indent", () => {
	const base = makeBase({ highlightCode: () => ["a", "bbb"] });
	const theme = grokMarkdownTheme(base, palette, { codeWidth: () => 20 });
	assert.deepEqual(theme.highlightCode?.("a\nbbb", "ts"), [
		`bg<${"a".padEnd(18, " ")}>`,
		`bg<${"bbb".padEnd(18, " ")}>`,
	]);
});

test("codeBlockIndent widens the indent deduction", () => {
	const base = makeBase({
		highlightCode: () => ["x"],
		codeBlockIndent: "    ",
	});
	const theme = grokMarkdownTheme(base, palette, { codeWidth: () => 20 });
	assert.deepEqual(theme.highlightCode?.("x"), [`bg<${"x".padEnd(16, " ")}>`]);
});

test("missing or non-positive width falls back to the longest line", () => {
	const base = makeBase({ highlightCode: () => ["ab", "cdef"] });
	const noWidth = grokMarkdownTheme(base, palette);
	assert.deepEqual(noWidth.highlightCode?.("ab\ncdef"), [
		"bg<ab  >",
		"bg<cdef>",
	]);

	const zeroWidth = grokMarkdownTheme(base, palette, { codeWidth: () => 0 });
	assert.deepEqual(zeroWidth.highlightCode?.("ab\ncdef"), [
		"bg<ab  >",
		"bg<cdef>",
	]);
});

test("existing ANSI in a highlighted line is preserved and not counted as width", () => {
	const base = makeBase({ highlightCode: () => ["\x1b[31mconst\x1b[0m"] });
	const theme = grokMarkdownTheme(base, palette, { codeWidth: () => 12 });
	assert.deepEqual(theme.highlightCode?.("const"), [
		"bg<\x1b[31mconst\x1b[0m     >",
	]);
});

test("without highlightCode the band is applied through codeBlock", () => {
	const theme = grokMarkdownTheme(makeBase(), palette, { codeWidth: () => 10 });
	assert.equal(theme.highlightCode, undefined);
	assert.equal(theme.codeBlock("hi"), `bg<${"C<hi>".padEnd(8, " ")}>`);
});

test("untouched keys pass through and base is not mutated", () => {
	const base = makeBase();
	const snapshot = { ...base };
	const theme = grokMarkdownTheme(base, palette);

	const call = (fn: unknown, s: string) => (fn as (v: string) => string)(s);
	assert.equal(call(theme.quote, "q"), "Q<q>");
	assert.equal(call(theme.italic, "i"), "I<i>");
	assert.equal(theme.custom, 42);

	assert.deepEqual(Object.keys(base), Object.keys(snapshot));
	assert.equal(base.heading, snapshot.heading);
	assert.equal(base.hr("x"), "HR<x>");
	assert.equal(base.listBullet("- "), "L<- >");
	assert.equal(base.codeBlockBorder("```"), "B<```>");
});
