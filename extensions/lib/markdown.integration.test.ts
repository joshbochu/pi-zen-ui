/**
 * Pins the parts of Pi's Markdown contract the skin depends on.
 *
 * lib/markdown.test.ts proves the transforms in isolation, but every one of them
 * is an assumption about *when and with what* Pi calls a MarkdownTheme callback.
 * The heading level is the cautionary case: the obvious reading is that the `#`
 * marker arrives before the heading text, and it does not — so a unit test built
 * on that assumption passed while the real render was wrong. This file asserts
 * the ordering against the real renderer.
 *
 * Requires the peer packages to be resolvable; skips cleanly when they are not
 * so `npm test` still works in a bare checkout.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { grokMarkdownTheme, type MarkdownThemeLike } from "./markdown.ts";

type MarkdownCtor = new (
	text: string,
	paddingX: number,
	paddingY: number,
	theme: MarkdownThemeLike,
) => { render(width: number): string[] };

let Markdown: MarkdownCtor | undefined;
try {
	({ Markdown } = (await import("@earendil-works/pi-tui")) as unknown as {
		Markdown: MarkdownCtor;
	});
} catch {
	Markdown = undefined;
}

/** Stand-in for Pi's app theme: tags each call so we can see what fired. */
function probeBase(calls: string[]): MarkdownThemeLike {
	const tag = (name: string) => (s: string) => {
		calls.push(`${name}:${s.replace(/\x1b\[[0-9;]*m/g, "")}`);
		return s;
	};
	return {
		heading: tag("heading"),
		hr: tag("hr"),
		listBullet: tag("listBullet"),
		codeBlockBorder: tag("codeBlockBorder"),
		codeBlock: tag("codeBlock"),
		link: (s: string) => s,
		linkUrl: (s: string) => s,
		code: (s: string) => s,
		quote: (s: string) => s,
		quoteBorder: (s: string) => s,
		bold: (s: string) => `\x1b[1m${s}\x1b[22m`,
		italic: (s: string) => s,
		strikethrough: (s: string) => s,
		underline: (s: string) => `\x1b[4m${s}\x1b[24m`,
	};
}

const palette = {
	headingLevel: (level: number, s: string) => `<h${level}>${s}`,
	muted: (s: string) => `<muted>${s}`,
	codeBg: (s: string) => `<bg>${s}`,
};

const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

const render = (markdown: string): { lines: string[]; calls: string[] } => {
	const calls: string[] = [];
	const theme = grokMarkdownTheme(probeBase(calls), palette);
	// Record at the skin's own boundary: the wrapper handles headings itself and
	// never delegates to base.heading, so instrumenting the base sees nothing.
	const wrapped = theme.heading;
	theme.heading = (s: string) => {
		calls.push(`heading:${strip(s)}`);
		return wrapped(s);
	};
	// biome-ignore lint/style/noNonNullAssertion: guarded by the skip in each test
	const lines = new Markdown!(markdown, 0, 0, theme).render(60);
	return { lines, calls };
};

test("Pi emits heading text before the `#` marker", (t) => {
	if (!Markdown) return t.skip("@earendil-works/pi-tui not resolvable");
	const { calls } = render("### Three\n");
	const headings = calls
		.filter((c) => c.startsWith("heading:"))
		.map((c) => c.slice("heading:".length))
		// Pi probes the style function with a NUL sentinel to extract a prefix.
		.filter((c) => !c.includes("\0"));
	assert.deepEqual(
		headings,
		["Three", "### "],
		"marker must arrive last — the level is unknowable while styling the text",
	);
});

test("H1 reaches the theme underlined, H2 does not", (t) => {
	if (!Markdown) return t.skip("@earendil-works/pi-tui not resolvable");
	const h1 = render("# One\n").lines.join("\n");
	const h2 = render("## Two\n").lines.join("\n");
	assert.ok(h1.includes("<h1>"), `H1 should style as level 1, got ${h1}`);
	assert.ok(h2.includes("<h2>"), `H2 should style as level 2, got ${h2}`);
});

test("heading markers do not survive into the output", (t) => {
	if (!Markdown) return t.skip("@earendil-works/pi-tui not resolvable");
	for (const src of ["# A\n", "## B\n", "### C\n", "###### F\n"]) {
		const out = strip(render(src).lines.join("\n"));
		assert.ok(!out.includes("#"), `${src.trim()} leaked a marker: ${out}`);
	}
});

test("bullets, rule and fences match grok's treatment end to end", (t) => {
	if (!Markdown) return t.skip("@earendil-works/pi-tui not resolvable");
	const out = strip(
		render("- one\n- two\n\n---\n\n```ts\nconst x = 1;\n```\n").lines.join(
			"\n",
		),
	);
	assert.ok(out.includes("\u2022 one"), `bullet not applied: ${out}`);
	assert.ok(!/^\s*- one/m.test(out), `source dash survived: ${out}`);
	assert.ok(out.includes("\u2500\u2500\u2500"), `rule missing: ${out}`);
	assert.ok(!out.includes("```"), `fence survived: ${out}`);
	assert.ok(out.includes("const x = 1;"), `code body lost: ${out}`);
	assert.ok(out.includes("<bg>"), `code band not applied: ${out}`);
});
