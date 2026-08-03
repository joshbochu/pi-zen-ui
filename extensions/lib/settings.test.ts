import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
	DEFAULT_PI_GROK_BUILD_UI_SETTINGS,
	MINIMAL_PI_GROK_BUILD_UI_SETTINGS,
	applyVisibilityPreset,
	loadPiGrokBuildUISettings,
	normalizePiGrokBuildUISettings,
	savePiGrokBuildUISettings,
	withAccentPreset,
	withCustomAccent,
	withVisibilitySetting,
} from "./settings.ts";

test("PiGrokBuild UI defaults show every configurable chrome region", () => {
	assert.deepEqual(DEFAULT_PI_GROK_BUILD_UI_SETTINGS, {
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

test("normalizePiGrokBuildUISettings accepts known booleans from partial values", () => {
	assert.deepEqual(
		normalizePiGrokBuildUISettings({
			accentPreset: "custom",
			customAccent: "88c0d0",
			showSessionTitle: false,
			showCurrentDirectory: false,
			showContextUsage: "no",
			unknown: false,
		}),
		{
			...DEFAULT_PI_GROK_BUILD_UI_SETTINGS,
			accentPreset: "custom",
			customAccent: "#88C0D0",
			showSessionTitle: false,
			showCurrentDirectory: false,
		},
	);
});

test("normalizePiGrokBuildUISettings rejects malformed roots", () => {
	for (const value of [undefined, null, true, "settings", [], 42]) {
		assert.deepEqual(
			normalizePiGrokBuildUISettings(value),
			DEFAULT_PI_GROK_BUILD_UI_SETTINGS,
		);
	}
});

test("Default and Minimal presets update visibility without replacing accent", () => {
	assert.deepEqual(
		applyVisibilityPreset("default"),
		DEFAULT_PI_GROK_BUILD_UI_SETTINGS,
	);
	assert.deepEqual(
		applyVisibilityPreset("minimal"),
		MINIMAL_PI_GROK_BUILD_UI_SETTINGS,
	);
	const nord = {
		...DEFAULT_PI_GROK_BUILD_UI_SETTINGS,
		accentPreset: "nord" as const,
		customAccent: "#123456",
	};
	assert.deepEqual(applyVisibilityPreset("minimal", nord), {
		...MINIMAL_PI_GROK_BUILD_UI_SETTINGS,
		accentPreset: "nord",
		customAccent: "#123456",
	});
	assert.notStrictEqual(
		applyVisibilityPreset("default"),
		DEFAULT_PI_GROK_BUILD_UI_SETTINGS,
	);
	assert.notStrictEqual(
		applyVisibilityPreset("minimal"),
		MINIMAL_PI_GROK_BUILD_UI_SETTINGS,
	);
});

test("withVisibilitySetting returns a new settings value", () => {
	const next = withVisibilitySetting(
		applyVisibilityPreset("default"),
		"showGitBranch",
		false,
	);
	assert.equal(next.showGitBranch, false);
	assert.equal(DEFAULT_PI_GROK_BUILD_UI_SETTINGS.showGitBranch, true);
});

test("accent helpers select presets and validate custom colors", () => {
	const nord = withAccentPreset(applyVisibilityPreset("default"), "nord");
	assert.equal(nord.accentPreset, "nord");
	const custom = withCustomAccent(nord, "#88c0d0");
	assert.deepEqual(custom, {
		...nord,
		accentPreset: "custom",
		customAccent: "#88C0D0",
	});
	assert.equal(withCustomAccent(nord, "not-a-color"), undefined);
});

test("loadPiGrokBuildUISettings safely handles missing, malformed, and unsupported files", () => {
	const dir = mkdtempSync(join(tmpdir(), "pi-grok-build-ui-settings-"));
	try {
		const path = join(dir, "pi-grok-build-ui.json");
		assert.deepEqual(
			loadPiGrokBuildUISettings(path),
			DEFAULT_PI_GROK_BUILD_UI_SETTINGS,
		);

		writeFileSync(path, "{ definitely not json", "utf8");
		assert.deepEqual(
			loadPiGrokBuildUISettings(path),
			DEFAULT_PI_GROK_BUILD_UI_SETTINGS,
		);

		writeFileSync(
			path,
			JSON.stringify({ version: 999, settings: { showGitBranch: false } }),
			"utf8",
		);
		assert.deepEqual(
			loadPiGrokBuildUISettings(path),
			DEFAULT_PI_GROK_BUILD_UI_SETTINGS,
		);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("loadPiGrokBuildUISettings normalizes partial persisted settings", () => {
	const dir = mkdtempSync(join(tmpdir(), "pi-grok-build-ui-settings-"));
	try {
		const path = join(dir, "pi-grok-build-ui.json");
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
		assert.deepEqual(loadPiGrokBuildUISettings(path), {
			...DEFAULT_PI_GROK_BUILD_UI_SETTINGS,
			showSessionTitle: false,
			showGitBranch: false,
		});
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("loadPiGrokBuildUISettings falls back to the legacy file only when needed", () => {
	const dir = mkdtempSync(join(tmpdir(), "pi-grok-build-ui-settings-"));
	try {
		const path = join(dir, "pi-grok-build-ui.json");
		const legacyPath = join(dir, "oscura-theme.json");
		writeFileSync(
			legacyPath,
			JSON.stringify({
				version: 1,
				settings: { showGitBranch: false },
			}),
			"utf8",
		);
		assert.equal(
			loadPiGrokBuildUISettings(path, legacyPath).showGitBranch,
			false,
		);

		writeFileSync(
			path,
			JSON.stringify({
				version: 1,
				settings: { showGitBranch: true },
			}),
			"utf8",
		);
		assert.equal(
			loadPiGrokBuildUISettings(path, legacyPath).showGitBranch,
			true,
		);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("savePiGrokBuildUISettings atomically round-trips without temp files", () => {
	const dir = mkdtempSync(join(tmpdir(), "pi-grok-build-ui-settings-"));
	try {
		const path = join(dir, "nested", "pi-grok-build-ui.json");
		const expected = withCustomAccent(
			{
				...applyVisibilityPreset("minimal"),
				showSessionTitle: true,
			},
			"#A3BE8C",
		)!;
		savePiGrokBuildUISettings(path, expected);
		assert.deepEqual(loadPiGrokBuildUISettings(path), expected);
		assert.deepEqual(readdirSync(join(dir, "nested")), [
			"pi-grok-build-ui.json",
		]);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
