import { test } from "node:test";
import assert from "node:assert/strict";
import {
	SPINNER_FRAMES,
	SPINNER_INTERVAL_MS,
	phaseLabel,
	spinnerFrame,
	statusRow,
	type StatusState,
	type StatusStyle,
} from "./status.ts";

const plain: StatusStyle = {
	spinner: (s) => s,
	label: (s) => s,
	timer: (s) => s,
	stop: (s) => s,
};
const ansi: StatusStyle = {
	spinner: (s) => `\x1b[35m${s}\x1b[0m`,
	label: (s) => `\x1b[37m${s}\x1b[0m`,
	timer: (s) => `\x1b[90m${s}\x1b[0m`,
	stop: (s) => `\x1b[31m${s}\x1b[0m`,
};
const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
const cols = (s: string) => [...s].length;

const thinking: StatusState = {
	phase: "thinking",
	turnMs: 62_000,
	phaseMs: 5_200,
	tokens: 8_420,
	now: 133,
};

test("spinner constants match grok", () => {
	assert.equal(SPINNER_INTERVAL_MS, 133);
	assert.equal(SPINNER_FRAMES.length, 8);
	assert.deepEqual(
		[...SPINNER_FRAMES],
		["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧"],
	);
});

test("spinnerFrame advances every 133ms and wraps", () => {
	assert.equal(spinnerFrame(0), "⠋");
	assert.equal(spinnerFrame(132), "⠋");
	assert.equal(spinnerFrame(133), "⠙");
	assert.equal(spinnerFrame(265), "⠙");
	assert.equal(spinnerFrame(266), "⠹");
	assert.equal(spinnerFrame(133 * 7), "⠧");
	assert.equal(spinnerFrame(133 * 8), "⠋");
	assert.equal(spinnerFrame(133 * 9), "⠙");
	assert.ok(SPINNER_FRAMES.includes(spinnerFrame(-1)));
	assert.ok(SPINNER_FRAMES.includes(spinnerFrame(-5000)));
});

test("phaseLabel literals", () => {
	assert.equal(phaseLabel("thinking"), "Thinking…");
	assert.equal(phaseLabel("responding"), "Responding…");
	assert.equal(phaseLabel("verifying"), "Verifying…");
	assert.equal(phaseLabel("compacting"), "Compacting…");
	assert.equal(phaseLabel("running"), "Running…");
	assert.equal(phaseLabel("waiting"), "Waiting…");
	assert.equal(phaseLabel("cancelling"), "Cancelling…");
	assert.equal(phaseLabel("starting"), "Starting session…");
	assert.equal(phaseLabel("retrying", 2), "Retrying (attempt 2)…");
	assert.equal(phaseLabel("retrying", 11), "Retrying (attempt 11)…");
	assert.equal(phaseLabel("retrying"), "Retrying (attempt 1)…");
});

test("statusRow: full row is flush right at generous width", () => {
	const row = statusRow(thinking, 60, plain);
	assert.equal(row, `⠙ Thinking… 5.2s${" ".repeat(26)}1m2s ⇣8.42k [stop]`);
	assert.equal(cols(row), 60);
});

test("statusRow: tightest full row keeps a 1 column gap", () => {
	assert.equal(
		statusRow(thinking, 35, plain),
		"⠙ Thinking… 5.2s 1m2s ⇣8.42k [stop]",
	);
	assert.equal(cols(statusRow(thinking, 35, plain)), 35);
});

test("statusRow: step 1 drops the token counter", () => {
	assert.equal(
		statusRow(thinking, 34, plain),
		`⠙ Thinking… 5.2s${" ".repeat(7)}1m2s [stop]`,
	);
	assert.equal(statusRow(thinking, 28, plain), "⠙ Thinking… 5.2s 1m2s [stop]");
});

test("statusRow: step 2 drops the phase timer", () => {
	assert.equal(
		statusRow(thinking, 27, plain),
		`⠙ Thinking…${" ".repeat(5)}1m2s [stop]`,
	);
	assert.equal(statusRow(thinking, 23, plain), "⠙ Thinking… 1m2s [stop]");
});

test("statusRow: step 3 drops the turn timer", () => {
	assert.equal(
		statusRow(thinking, 22, plain),
		`⠙ Thinking…${" ".repeat(5)}[stop]`,
	);
	assert.equal(statusRow(thinking, 18, plain), "⠙ Thinking… [stop]");
});

test("statusRow: step 4 drops the label", () => {
	assert.equal(statusRow(thinking, 17, plain), `⠙${" ".repeat(10)}[stop]`);
	assert.equal(statusRow(thinking, 8, plain), "⠙ [stop]");
});

test("statusRow: spinner only when nothing else fits", () => {
	assert.equal(statusRow(thinking, 7, plain), "⠙");
	assert.equal(statusRow(thinking, 1, plain), "⠙");
});

test("statusRow: no output at zero or negative width", () => {
	assert.equal(statusRow(thinking, 0, plain), "");
	assert.equal(statusRow(thinking, -5, plain), "");
});

test("statusRow: never wider than the width it was given", () => {
	for (let width = 0; width <= 80; width++) {
		assert.ok(
			cols(statusRow(thinking, width, plain)) <= width,
			`overflow at ${width}`,
		);
		assert.ok(
			cols(statusRow({ ...thinking, phase: "starting" }, width, plain)) <=
				width,
		);
	}
});

test("statusRow: omits the token group when tokens are undefined", () => {
	const row = statusRow(
		{ phase: "thinking", turnMs: 62_000, phaseMs: 5_200, now: 133 },
		40,
		plain,
	);
	assert.equal(row, `⠙ Thinking… 5.2s${" ".repeat(13)}1m2s [stop]`);
	assert.equal(cols(row), 40);
});

test("statusRow: zero tokens still render", () => {
	assert.ok(statusRow({ ...thinking, tokens: 0 }, 40, plain).includes("⇣0"));
});

test("statusRow: queued hint follows the phase timer", () => {
	const row = statusRow({ ...thinking, queued: true }, 60, plain);
	assert.equal(
		row,
		`⠙ Thinking… 5.2s · queued${" ".repeat(17)}1m2s ⇣8.42k [stop]`,
	);
	assert.equal(cols(row), 60);
});

test("statusRow: queued hint is dropped first as the row narrows", () => {
	const queued = { ...thinking, queued: true };
	assert.equal(
		statusRow(queued, 44, plain),
		"⠙ Thinking… 5.2s · queued 1m2s ⇣8.42k [stop]",
	);
	assert.equal(
		statusRow(queued, 43, plain),
		`⠙ Thinking… 5.2s${" ".repeat(9)}1m2s ⇣8.42k [stop]`,
	);
});

test("statusRow: startup row ignores the queued hint", () => {
	const row = statusRow(
		{ ...thinking, phase: "starting", queued: true },
		60,
		plain,
	);
	assert.equal(row, "⠙ Starting session… 5.2s");
});

test("statusRow: retrying uses the attempt number", () => {
	const row = statusRow(
		{ ...thinking, phase: "retrying", attempt: 3 },
		60,
		plain,
	);
	assert.ok(row.startsWith("⠙ Retrying (attempt 3)… 5.2s"));
	assert.ok(row.endsWith("1m2s ⇣8.42k [stop]"));
	assert.equal(cols(row), 60);
});

test("statusRow: startup row is one gray group, no stop, no tokens", () => {
	const start: StatusState = {
		phase: "starting",
		turnMs: 1_000,
		phaseMs: 1_000,
		tokens: 5_000,
		now: 0,
	};
	assert.equal(statusRow(start, 60, plain), "⠋ Starting session… 1.0s");
	assert.equal(
		statusRow(start, 60, ansi),
		"\x1b[90m⠋ Starting session… 1.0s\x1b[0m",
	);
	assert.equal(statusRow(start, 23, plain), "⠋ Starting session…");
	assert.equal(statusRow(start, 18, plain), "⠋");
	assert.equal(statusRow(start, 1, plain), "⠋");
});

test("statusRow: padding is computed on unstyled text", () => {
	const row = statusRow(thinking, 40, ansi);
	assert.equal(
		strip(row),
		`⠙ Thinking… 5.2s${" ".repeat(6)}1m2s ⇣8.42k [stop]`,
	);
	assert.equal(cols(strip(row)), 40);
	assert.equal(
		row,
		"\x1b[35m⠙\x1b[0m" +
			" " +
			"\x1b[37mThinking…\x1b[0m" +
			" " +
			"\x1b[90m5.2s\x1b[0m" +
			" ".repeat(6) +
			"\x1b[90m1m2s\x1b[0m" +
			" " +
			"\x1b[90m⇣8.42k\x1b[0m" +
			" " +
			"\x1b[31m[stop]\x1b[0m",
	);
});

test("statusRow: already-styled label text does not inflate the width", () => {
	const preStyled: StatusStyle = {
		...plain,
		label: (s) => `\x1b[1m${s}\x1b[22m`,
	};
	assert.equal(cols(strip(statusRow(thinking, 60, preStyled))), 60);
});
