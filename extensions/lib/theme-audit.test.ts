// Audits themes/oscura-midnight.json against docs/grok-fidelity-spec.md.
// Every hex below is a literal from grok's own OscuraMidnight theme (spec §1, §2).
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";

const HEX = /^#[0-9a-fA-F]{6}$/;

function readJson(path: string): any {
	try {
		return JSON.parse(readFileSync(path, "utf8"));
	} catch (cause) {
		throw new Error(`cannot read JSON at ${path}`, { cause });
	}
}

const themePath = join(
	import.meta.dirname,
	"../../themes/oscura-midnight.json",
);
const theme = readJson(themePath) as {
	vars: Record<string, string>;
	colors: Record<string, string>;
	export: Record<string, string>;
};

/** A colors/vars value is either a literal #rrggbb or the name of another var. */
function resolveHex(value: string, label: string): string {
	let current: string = value;
	const seen = new Set<string>();
	while (!HEX.test(current)) {
		assert.ok(!seen.has(current), `${label}: var cycle at "${current}"`);
		seen.add(current);
		assert.ok(
			Object.hasOwn(theme.vars, current),
			`${label}: "${current}" is neither #rrggbb nor a known var`,
		);
		// Non-null: guarded by the hasOwn assertion above.
		current = theme.vars[current]!;
	}
	return current.toUpperCase();
}

const color = (key: string): string => {
	assert.ok(Object.hasOwn(theme.colors, key), `colors.${key} is missing`);
	return resolveHex(theme.colors[key]!, `colors.${key}`);
};

// spec §2 — grok-night.tmTheme (TokyoNight-derived), NOT the purple chrome palette.
const SYNTAX = {
	syntaxComment: "#51597D",
	syntaxKeyword: "#BB9AF7",
	syntaxFunction: "#7AA2F7",
	syntaxVariable: "#C8C8C8",
	syntaxString: "#9ECE6A",
	syntaxNumber: "#FF9E64",
	syntaxType: "#0DB9D7",
	syntaxOperator: "#89DDFF",
	syntaxPunctuation: "#9ABDF5",
};

// spec §1 — chrome palette semantic mapping.
const CHROME = {
	accent: "#C4A7E7", // accent_user = PURPLE_BRIGHT
	border: "#242034", // prompt_border = HIGHLIGHT_MED
	borderAccent: "#343048", // prompt_border_active = HIGHLIGHT_HIGH
	borderMuted: "#0F1216", // bg_highlight = ELEVATED (autocomplete panel rules)
	selectedBg: "#242034", // bg_visual = HIGHLIGHT_MED
	userMessageBg: "#0F1216", // bg_light = ELEVATED
	customMessageBg: "#0F1216", // autocomplete row bg = bg_light = ELEVATED
	customMessageLabel: "#9B7ECE", // accent_assistant = PURPLE
	toolPendingBg: "#040507", // bg_dark = SURFACE
	toolSuccessBg: "#040507", // bg_dark = SURFACE
	toolErrorBg: "#2D0F19", // diff_delete_bg
	toolTitle: "#81868F", // gray = MUTED (collapsed header; gray_bright is expanded-only)
	success: "#50B48C", // accent_success = TEAL
	error: "#DC5A64", // accent_error = RED
	warning: "#EBD96E", // warning = GOLD
	bashMode: "#EBD96E", // command = GOLD
	muted: "#81868F", // gray = MUTED
	dim: "#5E646C", // gray_dim = SUBTLE
	text: "#E4E4E4", // text_primary = TEXT
	thinkingText: "#81868F", // accent_thinking = MUTED
	mdHeading: "#C4A7E7", // h2 = PURPLE_BRIGHT
	mdCode: "#7DCFDF", // md_code = CYAN
	mdLink: "#7DCFDF", // link_fg = CYAN
	mdCodeBlock: "#E4E4E4", // md_text = TEXT, painted over md_code_bg
	mdHr: "#81868F", // md_muted = MUTED
	mdQuote: "#81868F", // md_muted = MUTED
	mdListBullet: "#81868F", // md_muted = MUTED
	toolDiffAdded: "#50B48C", // TEAL
	toolDiffRemoved: "#DC5A64", // RED
	toolDiffContext: "#81868F", // MUTED
};

test("syntax colors come from grok-night.tmTheme (spec §2)", () => {
	for (const [key, hex] of Object.entries(SYNTAX)) {
		assert.equal(color(key), hex, `colors.${key}`);
	}
});

test("chrome colors match the oscura palette mapping (spec §1)", () => {
	for (const [key, hex] of Object.entries(CHROME)) {
		assert.equal(color(key), hex, `colors.${key}`);
	}
});

test("export.pageBg is bg_base (spec §1)", () => {
	assert.equal(resolveHex(theme.export.pageBg!, "export.pageBg"), "#030304");
});

test("every var is referenced by colors or export", () => {
	const used = new Set<string>();
	const visit = (value: string) => {
		if (HEX.test(value) || used.has(value)) return;
		used.add(value);
		if (Object.hasOwn(theme.vars, value)) visit(theme.vars[value]!);
	};
	for (const value of Object.values(theme.colors)) visit(value);
	for (const value of Object.values(theme.export)) visit(value);

	const dead = Object.keys(theme.vars).filter((name) => !used.has(name));
	assert.deepEqual(
		dead,
		[],
		`dead vars (no Pi slot) — delete them: ${dead.join(", ")}`,
	);
});

test("colors keys match Pi's theme schema exactly", (t) => {
	const schemaPath = [
		process.env.PI_THEME_SCHEMA,
		join(
			import.meta.dirname,
			"../../node_modules/@wealthsimple/pi-coding-agent/dist/modes/interactive/theme/theme-schema.json",
		),
		"/opt/homebrew/lib/node_modules/@wealthsimple/pi-coding-agent/dist/modes/interactive/theme/theme-schema.json",
		"/usr/local/lib/node_modules/@wealthsimple/pi-coding-agent/dist/modes/interactive/theme/theme-schema.json",
	]
		.filter((p) => p !== undefined)
		.find(existsSync);
	if (!schemaPath) {
		t.skip("pi-coding-agent theme-schema.json not found (set PI_THEME_SCHEMA)");
		return;
	}
	const schema = readJson(schemaPath);
	const byName = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
	const expected = Object.keys(schema.properties.colors.properties).sort(
		byName,
	);
	const actual = Object.keys(theme.colors).sort(byName);
	assert.deepEqual(actual, expected);
});

test("every color resolves to a literal hex", () => {
	for (const key of Object.keys(theme.colors)) assert.match(color(key), HEX);
});
