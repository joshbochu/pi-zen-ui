import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
	DEFAULT_OSCURA_SETTINGS,
	MINIMAL_OSCURA_SETTINGS,
	applyOscuraPreset,
	loadOscuraSettings,
	normalizeOscuraSettings,
	saveOscuraSettings,
	withAccentPreset,
	withCustomAccent,
	withOscuraSetting,
} from "./settings.ts";

test("Oscura defaults show every configurable chrome region", () => {
	assert.deepEqual(DEFAULT_OSCURA_SETTINGS, {
		accentPreset: "oscura",
		customAccent: "#C4A7E7",
		showSessionTitle: true,
		useCwdAsSessionTitle: true,
		showModelCaption: true,
		showGitBranch: true,
		showCurrentDirectory: true,
		showContextUsage: true,
		showTurnStatus: true,
	});
});

test("normalizeOscuraSettings accepts known booleans from partial values", () => {
	assert.deepEqual(
		normalizeOscuraSettings({
			accentPreset: "custom",
			customAccent: "88c0d0",
			showSessionTitle: false,
			showCurrentDirectory: false,
			showContextUsage: "no",
			unknown: false,
		}),
		{
			...DEFAULT_OSCURA_SETTINGS,
			accentPreset: "custom",
			customAccent: "#88C0D0",
			showSessionTitle: false,
			showCurrentDirectory: false,
		},
	);
});

test("normalizeOscuraSettings rejects malformed roots", () => {
	for (const value of [undefined, null, true, "settings", [], 42]) {
		assert.deepEqual(normalizeOscuraSettings(value), DEFAULT_OSCURA_SETTINGS);
	}
});

test("Default and Minimal presets update visibility without replacing accent", () => {
	assert.deepEqual(applyOscuraPreset("default"), DEFAULT_OSCURA_SETTINGS);
	assert.deepEqual(applyOscuraPreset("minimal"), MINIMAL_OSCURA_SETTINGS);
	const nord = {
		...DEFAULT_OSCURA_SETTINGS,
		accentPreset: "nord" as const,
		customAccent: "#123456",
	};
	assert.deepEqual(applyOscuraPreset("minimal", nord), {
		...MINIMAL_OSCURA_SETTINGS,
		accentPreset: "nord",
		customAccent: "#123456",
	});
	assert.notStrictEqual(applyOscuraPreset("default"), DEFAULT_OSCURA_SETTINGS);
	assert.notStrictEqual(applyOscuraPreset("minimal"), MINIMAL_OSCURA_SETTINGS);
});

test("withOscuraSetting returns a new settings value", () => {
	const next = withOscuraSetting(
		applyOscuraPreset("default"),
		"showGitBranch",
		false,
	);
	assert.equal(next.showGitBranch, false);
	assert.equal(DEFAULT_OSCURA_SETTINGS.showGitBranch, true);
});

test("accent helpers select presets and validate custom colors", () => {
	const nord = withAccentPreset(applyOscuraPreset("default"), "nord");
	assert.equal(nord.accentPreset, "nord");
	const custom = withCustomAccent(nord, "#88c0d0");
	assert.deepEqual(custom, {
		...nord,
		accentPreset: "custom",
		customAccent: "#88C0D0",
	});
	assert.equal(withCustomAccent(nord, "not-a-color"), undefined);
});

test("loadOscuraSettings safely handles missing, malformed, and unsupported files", () => {
	const dir = mkdtempSync(join(tmpdir(), "oscura-settings-"));
	try {
		const path = join(dir, "oscura-theme.json");
		assert.deepEqual(loadOscuraSettings(path), DEFAULT_OSCURA_SETTINGS);

		writeFileSync(path, "{ definitely not json", "utf8");
		assert.deepEqual(loadOscuraSettings(path), DEFAULT_OSCURA_SETTINGS);

		writeFileSync(
			path,
			JSON.stringify({ version: 999, settings: { showGitBranch: false } }),
			"utf8",
		);
		assert.deepEqual(loadOscuraSettings(path), DEFAULT_OSCURA_SETTINGS);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("loadOscuraSettings normalizes partial persisted settings", () => {
	const dir = mkdtempSync(join(tmpdir(), "oscura-settings-"));
	try {
		const path = join(dir, "oscura-theme.json");
		writeFileSync(
			path,
			JSON.stringify({
				version: 1,
				settings: {
					showSessionTitle: false,
					showGitBranch: false,
					showTurnStatus: "invalid",
				},
			}),
			"utf8",
		);
		assert.deepEqual(loadOscuraSettings(path), {
			...DEFAULT_OSCURA_SETTINGS,
			showSessionTitle: false,
			showGitBranch: false,
		});
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("saveOscuraSettings atomically round-trips without temp files", () => {
	const dir = mkdtempSync(join(tmpdir(), "oscura-settings-"));
	try {
		const path = join(dir, "nested", "oscura-theme.json");
		const expected = withCustomAccent(
			{
				...applyOscuraPreset("minimal"),
				showSessionTitle: true,
			},
			"#A3BE8C",
		)!;
		saveOscuraSettings(path, expected);
		assert.deepEqual(loadOscuraSettings(path), expected);
		assert.deepEqual(readdirSync(join(dir, "nested")), ["oscura-theme.json"]);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
