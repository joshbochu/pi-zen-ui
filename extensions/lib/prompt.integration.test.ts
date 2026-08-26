/**
 * Pins the prompt-box geometry against the real Pi editor compositor.
 *
 * lib/prompt.test.ts proves the width math in isolation. This file instantiates
 * PiGrokBuildUIEditor and asserts the framed rows: matching 1-cell gaps inside
 * both `│`, wrap budget = terminal width − 10, and a resize that reflows
 * instead of clipping into the right border.
 *
 * Requires the peer packages to be resolvable; skips cleanly when they are not
 * so `npm test` still works in a bare checkout.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
	buildAccentThemeColors,
	resolveAccentPalette,
	type ThemeTemplate,
} from "./palette.ts";
import { DEFAULT_PI_GROK_BUILD_UI_SETTINGS } from "./settings.ts";
import { PLACEHOLDER, stripAnsi, visibleWidth } from "./prompt.ts";

type ThemeCtor = new (
	fg: Record<string, string | number>,
	bg: Record<string, string | number>,
	mode: "truecolor" | "256color",
	options?: { name?: string },
) => unknown;

type KeybindingsCtor = new (definitions: unknown) => unknown;

type EditorChrome = {
	title: () => string;
	showModelCaption: () => boolean;
	model: () => string;
	effort: () => string;
};

type EditorHarness = {
	focused: boolean;
	setText: (text: string) => void;
	getText: () => string;
	render: (width: number) => string[];
};

type EditorCtor = new (
	tui: { terminal: { rows: number } },
	editorTheme: {
		borderColor: (s: string) => string;
		selectList: {
			selectedPrefix: (s: string) => string;
			selectedText: (s: string) => string;
			description: (s: string) => string;
			scrollInfo: (s: string) => string;
			noMatch: (s: string) => string;
		};
	},
	keybindings: unknown,
	fullTheme: () => unknown,
	chrome: EditorChrome,
) => EditorHarness;

const identity = (s: string) => s;

const THEME_PATH = join(
	fileURLToPath(new URL(".", import.meta.url)),
	"../../themes/oscura-midnight.json",
);

let Theme: ThemeCtor | undefined;
let KeybindingsManager: KeybindingsCtor | undefined;
let TUI_KEYBINDINGS: unknown;
let PiGrokBuildUIEditor: EditorCtor | undefined;

try {
	({ Theme } = (await import("@earendil-works/pi-coding-agent")) as unknown as {
		Theme: ThemeCtor;
	});
	({
		KeybindingsManager,
		TUI_KEYBINDINGS,
	} = (await import("@earendil-works/pi-tui")) as unknown as {
		KeybindingsManager: KeybindingsCtor;
		TUI_KEYBINDINGS: unknown;
	});
	({ PiGrokBuildUIEditor } = (await import(
		"../pi-grok-build-ui.ts"
	)) as unknown as { PiGrokBuildUIEditor: EditorCtor });
} catch {
	Theme = undefined;
	KeybindingsManager = undefined;
	PiGrokBuildUIEditor = undefined;
}

function createEditor(): EditorHarness {
	const template = JSON.parse(
		readFileSync(THEME_PATH, "utf8"),
	) as ThemeTemplate;
	const maps = buildAccentThemeColors(
		template,
		resolveAccentPalette(DEFAULT_PI_GROK_BUILD_UI_SETTINGS),
	);
	// biome-ignore lint/style/noNonNullAssertion: guarded by the skip in each test
	const theme = new Theme!(maps.foregrounds, maps.backgrounds, "truecolor", {
		name: "oscura-midnight",
	});
	return new PiGrokBuildUIEditor!(
		{ terminal: { rows: 40 } },
		{
			borderColor: identity,
			selectList: {
				selectedPrefix: identity,
				selectedText: identity,
				description: identity,
				scrollInfo: identity,
				noMatch: identity,
			},
		},
		new KeybindingsManager!(TUI_KEYBINDINGS),
		() => theme,
		{
			title: () => "session",
			showModelCaption: () => true,
			model: () => "grok-4",
			effort: () => "high",
		},
	);
}

function peersAvailable(): boolean {
	return Boolean(Theme && KeybindingsManager && PiGrokBuildUIEditor);
}

function boxRows(lines: string[]): string[] {
	return lines.map(stripAnsi).filter((line) => /[╭╰│]/.test(line));
}

function contentRow(lines: string[]): string {
	const row = boxRows(lines).find((line) => line.includes("❯"));
	assert.ok(row, `no prompt row in:\n${lines.map(stripAnsi).join("\n")}`);
	return row;
}

/** Inner span between the two `│` cells, including the 1-cell pads. */
function inner(row: string): string {
	const start = row.indexOf("│");
	const end = row.lastIndexOf("│");
	assert.ok(start >= 0 && end > start, `missing side borders: ${row}`);
	return row.slice(start + 1, end);
}

test("prompt box keeps matching 1-cell gaps at several terminal widths", (t) => {
	if (!peersAvailable()) return t.skip("pi peers not resolvable");
	const editor = createEditor();
	editor.focused = true;
	editor.setText("hello");

	for (const width of [40, 60, 80, 100, 120]) {
		const row = contentRow(editor.render(width));
		assert.equal(visibleWidth(row), width, `row width at ${width}: ${row}`);
		assert.ok(row.startsWith("  │"), `left chrome at ${width}: ${row}`);
		assert.ok(row.endsWith("│  "), `right chrome at ${width}: ${row}`);

		const body = inner(row);
		assert.equal(body.length, width - 6, `inner width at ${width}`);
		assert.ok(body.startsWith(" ❯ hello"), `left gap at ${width}: |${body}|`);
		assert.ok(body.endsWith(" "), `right gap at ${width}: |${body}|`);
		const afterText = body.slice(" ❯ hello".length);
		assert.ok(
			afterText.length >= 1 && afterText.trim() === "",
			`text should not reach the right border at ${width}: |${body}|`,
		);
	}
});

test("long prompt reflows on resize instead of clipping into the right border", (t) => {
	if (!peersAvailable()) return t.skip("pi peers not resolvable");
	const editor = createEditor();
	editor.focused = true;
	const filler = "x".repeat(200);
	editor.setText(filler);

	const wrapCounts: number[] = [];
	for (const width of [40, 80, 120]) {
		const frames = editor.render(width);
		const rows = boxRows(frames).filter((line) => line.includes("│"));
		assert.ok(rows.length >= 1, `no content rows at width ${width}`);

		for (const row of rows) {
			assert.equal(visibleWidth(row), width, `row width at ${width}: ${row}`);
			assert.ok(row.startsWith("  │") && row.endsWith("│  "), row);
			const body = inner(row);
			assert.ok(body.startsWith(" "), `left inset at ${width}: |${body}|`);
			assert.ok(body.endsWith(" "), `right inset at ${width}: |${body}|`);
			assert.ok(
				!body.slice(1, -1).includes("│"),
				`text leaked into a border at ${width}: |${body}|`,
			);
		}

		const wrapBudget = width - 10;
		const first = inner(rows[0] ?? "");
		const firstText = first.slice(" ❯ ".length, -1);
		assert.equal(
			firstText.length,
			wrapBudget,
			`first wrap at ${width} should be width-10=${wrapBudget}, got ${firstText.length}: |${first}|`,
		);
		assert.equal(firstText, "x".repeat(wrapBudget));
		wrapCounts.push(rows.length);
	}

	assert.ok(
		wrapCounts[0]! > wrapCounts[1]! && wrapCounts[1]! > wrapCounts[2]!,
		`wrap count should drop as the terminal widens: ${wrapCounts.join(",")}`,
	);
});

test("empty unfocused prompt shows the placeholder with matching insets", (t) => {
	if (!peersAvailable()) return t.skip("pi peers not resolvable");
	const editor = createEditor();
	editor.focused = false;
	editor.setText("");
	const width = 80;
	const row = contentRow(editor.render(width));
	assert.equal(visibleWidth(row), width);
	const body = inner(row);
	assert.ok(body.startsWith(` ❯ ${PLACEHOLDER}`), body);
	assert.ok(body.endsWith(" "), body);
	assert.equal(editor.getText(), "");
});
