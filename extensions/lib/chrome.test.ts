import assert from "node:assert/strict";
import test from "node:test";

import { composeFooterRow, resolveSessionTitle } from "./chrome.ts";
import {
	DEFAULT_PI_GROK_BUILD_UI_SETTINGS,
	type PiGrokBuildUISettings,
} from "./settings.ts";
import { visibleWidth } from "./prompt.ts";

const values = {
	branch: "⎇ main",
	cwd: "~/dev/pi-grok-build-ui",
	context: "21K / 1.0M",
};
const separator = " │ ";

function visibility(
	showGitBranch: boolean,
	showCurrentDirectory: boolean,
	showContextUsage: boolean,
): PiGrokBuildUISettings {
	return {
		...DEFAULT_PI_GROK_BUILD_UI_SETTINGS,
		showGitBranch,
		showCurrentDirectory,
		showContextUsage,
	};
}

test("resolveSessionTitle distinguishes explicit names from cwd fallback", () => {
	assert.equal(
		resolveSessionTitle(
			{ ...DEFAULT_PI_GROK_BUILD_UI_SETTINGS, useCwdAsSessionTitle: false },
			"Named session",
			"dev",
		),
		"Named session",
	);
	assert.equal(
		resolveSessionTitle(
			{ ...DEFAULT_PI_GROK_BUILD_UI_SETTINGS, useCwdAsSessionTitle: false },
			undefined,
			"dev",
		),
		"",
	);
	assert.equal(
		resolveSessionTitle(DEFAULT_PI_GROK_BUILD_UI_SETTINGS, undefined, "dev"),
		"dev",
	);
	assert.equal(
		resolveSessionTitle(
			{ ...DEFAULT_PI_GROK_BUILD_UI_SETTINGS, showSessionTitle: false },
			"Named session",
			"dev",
		),
		"",
	);
});

test("composeFooterRow handles all visibility combinations without orphan separators", () => {
	const width = 60;
	const cases = [
		[false, false, false, ""],
		[true, false, false, "⎇ main"],
		[false, true, false, "~/dev/pi-grok-build-ui"],
		[true, true, false, "⎇ main │ ~/dev/pi-grok-build-ui"],
		[false, false, true, "21K / 1.0M"],
		[true, false, true, "⎇ main │ 21K / 1.0M"],
		[false, true, true, "~/dev/pi-grok-build-ui │ 21K / 1.0M"],
		[
			true,
			true,
			true,
			"⎇ main │ ~/dev/pi-grok-build-ui │ 21K / 1.0M",
		],
	] as const;

	for (const [branch, cwd, context, expected] of cases) {
		const row = composeFooterRow(
			visibility(branch, cwd, context),
			values,
			width,
			separator,
		);
		assert.equal(
			row.trim().replaceAll(/ +/g, " "),
			expected,
			`${branch}/${cwd}/${context}`,
		);
		assert.ok(visibleWidth(row) <= width);
		if (context) assert.equal(visibleWidth(row), width);
		assert.ok(!row.trimStart().startsWith("│"));
		assert.ok(!row.trimEnd().endsWith("│"));
	}
});

test("composeFooterRow omits unavailable branch and context values", () => {
	assert.equal(
		composeFooterRow(
			DEFAULT_PI_GROK_BUILD_UI_SETTINGS,
			{ branch: undefined, cwd: "~/dev", context: undefined },
			40,
			separator,
		),
		"~/dev",
	);
});

test("composeFooterRow stays within narrow widths", () => {
	for (let width = 0; width <= 40; width++) {
		const row = composeFooterRow(
			DEFAULT_PI_GROK_BUILD_UI_SETTINGS,
			values,
			width,
			separator,
		);
		assert.ok(visibleWidth(row) <= width, `overflow at ${width}`);
	}
});
