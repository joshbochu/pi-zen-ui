import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
	ACCENT_PRESET_LABELS,
	accentPresetFromLabel,
	buildAccentThemeColors,
	effectiveAccentHex,
	normalizeHexColor,
	resolveAccentPalette,
	type ThemeTemplate,
} from "./palette.ts";

const theme = JSON.parse(
	readFileSync(
		join(import.meta.dirname, "../../themes/oscura-midnight.json"),
		"utf8",
	),
) as ThemeTemplate;

test("normalizeHexColor accepts six-digit hex and canonicalizes it", () => {
	assert.equal(normalizeHexColor("#88c0d0"), "#88C0D0");
	assert.equal(normalizeHexColor(" 88C0d0 "), "#88C0D0");
	for (const invalid of ["#fff", "#1234567", "88c0", "nord", "", null]) {
		assert.equal(normalizeHexColor(invalid), undefined);
	}
});

test("accent preset labels round-trip", () => {
	assert.equal(ACCENT_PRESET_LABELS.oscura, "Oscura");
	assert.equal(ACCENT_PRESET_LABELS.nord, "Nord Frost");
	assert.equal(accentPresetFromLabel("Nord Frost"), "nord");
	assert.equal(accentPresetFromLabel("unknown"), undefined);
});

test("Oscura and Nord presets use their exact accent ramps", () => {
	assert.deepEqual(
		resolveAccentPalette({ accentPreset: "oscura", customAccent: "#FFFFFF" }),
		{
			bright: "#C4A7E7",
			core: "#9B7ECE",
			dim: "#6E5A9A",
			highlightLow: "#12101C",
			highlightMed: "#242034",
			highlightHigh: "#343048",
		},
	);
	assert.deepEqual(
		resolveAccentPalette({ accentPreset: "nord", customAccent: "#FFFFFF" }),
		{
			bright: "#88C0D0",
			core: "#81A1C1",
			dim: "#5E81AC",
			highlightLow: "#0E1214",
			highlightMed: "#1B2529",
			highlightHigh: "#27363B",
		},
	);
});

test("custom accent derives core, dim, and highlight colors", () => {
	assert.deepEqual(
		resolveAccentPalette({ accentPreset: "custom", customAccent: "#ff0000" }),
		{
			bright: "#FF0000",
			core: "#C80101",
			dim: "#900102",
			highlightLow: "#170304",
			highlightMed: "#300203",
			highlightHigh: "#470203",
		},
	);
	assert.equal(
		effectiveAccentHex({ accentPreset: "custom", customAccent: "bad" }),
		"#C4A7E7",
	);
});

test("buildAccentThemeColors recolors chrome but preserves syntax and semantics", () => {
	const maps = buildAccentThemeColors(
		theme,
		resolveAccentPalette({ accentPreset: "nord", customAccent: "#C4A7E7" }),
	);

	assert.equal(maps.foregrounds.accent, "#88C0D0");
	assert.equal(maps.foregrounds.customMessageLabel, "#81A1C1");
	assert.equal(maps.foregrounds.mdHeading, "#88C0D0");
	assert.equal(maps.foregrounds.thinkingMax, "#5E81AC");
	assert.equal(maps.foregrounds.border, "#1B2529");
	assert.equal(maps.foregrounds.borderAccent, "#27363B");
	assert.equal(maps.backgrounds.selectedBg, "#1B2529");

	assert.equal(maps.foregrounds.syntaxKeyword, "#bb9af7");
	assert.equal(maps.foregrounds.success, "#50b48c");
	assert.equal(maps.foregrounds.warning, "#ebd96e");
	assert.equal(maps.backgrounds.userMessageBg, "#0f1216");
	assert.equal(
		Object.keys(maps.foregrounds).length + Object.keys(maps.backgrounds).length,
		Object.keys(theme.colors).length,
	);
});
