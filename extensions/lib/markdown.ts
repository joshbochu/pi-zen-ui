/**
 * grok markdown skin for Pi's Markdown renderer (spec §7).
 *
 * Pure: no imports. Takes Pi's markdown theme plus colour functions and returns
 * a new theme; `base` is never mutated.
 */

/** Minimal structural view of Pi's `MarkdownTheme` — deliberately not imported. */
export interface MarkdownThemeLike {
	heading: (s: string) => string;
	hr: (s: string) => string;
	listBullet: (s: string) => string;
	codeBlockBorder: (s: string) => string;
	codeBlock: (s: string) => string;
	highlightCode?: (code: string, lang?: string) => string[];
	codeBlockIndent?: string;
	[key: string]: unknown;
}

export interface GrokMarkdownPalette {
	headingLevel: (level: number, s: string) => string;
	muted: (s: string) => string;
	codeBg: (s: string) => string;
}

const ANSI = /\x1b\[[0-9;]*m/g;
/** A heading argument that is nothing but Pi's retained `#` prefix. */
const HEADING_MARKER = /^#{1,6} $/;
/**
 * Pi styles H1 as `heading(bold(underline(text)))` and every other level as
 * `heading(bold(text))`, so the underline SGR is the only level signal that
 * reaches us — and it is enough to separate grok's h1 from the rest.
 *
 * The `#` marker cannot help: Pi renders the heading text first and the marker
 * second (verified in markdown.integration.test.ts), so by the time the level
 * is knowable the text has already been emitted.
 */
const UNDERLINE_SGR = /\x1b\[(?:[0-9;]*;)?4(?:;[0-9;]*)?m/;
const UNORDERED_MARKER = /^[-*+] /;
const BULLET = "\u2022 ";
const DEFAULT_INDENT = "  ";
const HR = "\u2500".repeat(3);
/** H2's colour also carries H3-H6, whose level Pi reveals too late to use. */
const DEFAULT_LEVEL = 2;

// ponytail: code points, not grapheme/east-asian width. Code bands are ASCII in practice.
const visibleWidth = (s: string): number => [...s.replace(ANSI, "")].length;

export function grokMarkdownTheme(
	base: MarkdownThemeLike,
	palette: GrokMarkdownPalette,
	options?: { codeWidth?: () => number },
): MarkdownThemeLike {
	const indentWidth = visibleWidth(base.codeBlockIndent ?? DEFAULT_INDENT);

	/** Pad every line to one width and paint the band. */
	const band = (lines: string[]): string[] => {
		const requested = options?.codeWidth?.() ?? 0;
		const target =
			requested > 0
				? Math.max(0, requested - indentWidth)
				: lines.reduce((max, line) => Math.max(max, visibleWidth(line)), 0);
		return lines.map((line) =>
			palette.codeBg(
				line + " ".repeat(Math.max(0, target - visibleWidth(line))),
			),
		);
	};

	const theme: MarkdownThemeLike = {
		...base,

		heading: (s) => {
			// grok hides the marker at every level.
			if (HEADING_MARKER.test(s.replace(ANSI, ""))) return "";
			return palette.headingLevel(UNDERLINE_SGR.test(s) ? 1 : DEFAULT_LEVEL, s);
		},

		// grok renders a fixed 3-char rule, not a full-width one.
		hr: () => palette.muted(HR),

		listBullet: (s) =>
			UNORDERED_MARKER.test(s)
				? palette.muted(BULLET + s.slice(2)) // same visible width as "- "
				: base.listBullet(s),

		// Fence lines and the language tag are hidden.
		codeBlockBorder: () => "",
	};

	if (base.highlightCode) {
		const highlight = base.highlightCode;
		theme.highlightCode = (code, lang) => band(highlight(code, lang));
	} else {
		// ponytail: called per line, so the fallback width is that line alone.
		theme.codeBlock = (s) => band([base.codeBlock(s)])[0]!;
	}

	return theme;
}
