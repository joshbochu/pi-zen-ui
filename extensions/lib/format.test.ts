import { test } from "node:test";
import assert from "node:assert/strict";
import {
	blendHex,
	contextGradientHex,
	formatContextTokens,
	formatCwd,
	formatDuration,
	formatPercent5,
	formatTurnTokens,
	hexToRgb,
} from "./format.ts";

test("formatDuration: sub-10s keeps one decimal", () => {
	assert.equal(formatDuration(0), "0.0s");
	assert.equal(formatDuration(1), "0.0s");
	assert.equal(formatDuration(5200), "5.2s");
	assert.equal(formatDuration(9900), "9.9s");
	// faithful port: {:.1} of 9.999 rounds up, so the row can read "10.0s"
	assert.equal(formatDuration(9999), "10.0s");
});

test("formatDuration: seconds, minutes, hours boundaries", () => {
	assert.equal(formatDuration(10000), "10s");
	assert.equal(formatDuration(10999), "10s");
	assert.equal(formatDuration(32000), "32s");
	assert.equal(formatDuration(59000), "59s");
	assert.equal(formatDuration(59999), "59s");
	assert.equal(formatDuration(60000), "1m0s");
	assert.equal(formatDuration(62000), "1m2s");
	assert.equal(formatDuration(125000), "2m5s");
	assert.equal(formatDuration(3599000), "59m59s");
	assert.equal(formatDuration(3599999), "59m59s");
	assert.equal(formatDuration(3600000), "1h0m");
	assert.equal(formatDuration(3720000), "1h2m");
	assert.equal(formatDuration(86400000), "24h0m");
});

test("formatDuration: negative and non-finite clamp to zero", () => {
	assert.equal(formatDuration(-1), "0.0s");
	assert.equal(formatDuration(-99999), "0.0s");
	assert.equal(formatDuration(Number.NaN), "0.0s");
});

test("formatTurnTokens: lowercase k/m ladder", () => {
	assert.equal(formatTurnTokens(0), "0");
	assert.equal(formatTurnTokens(842), "842");
	assert.equal(formatTurnTokens(999), "999");
	assert.equal(formatTurnTokens(1000), "1.00k");
	assert.equal(formatTurnTokens(1234), "1.23k");
	assert.equal(formatTurnTokens(8420), "8.42k");
	assert.equal(formatTurnTokens(9999), "10.00k");
	assert.equal(formatTurnTokens(10000), "10.0k");
	assert.equal(formatTurnTokens(10100), "10.1k");
	assert.equal(formatTurnTokens(99999), "100.0k");
	assert.equal(formatTurnTokens(100000), "100k");
	assert.equal(formatTurnTokens(123456), "123k");
	assert.equal(formatTurnTokens(999999), "999k");
	assert.equal(formatTurnTokens(1000000), "1.00m");
	assert.equal(formatTurnTokens(1234000), "1.23m");
	assert.equal(formatTurnTokens(9999999), "10.00m");
	assert.equal(formatTurnTokens(10000000), "10.0m");
	assert.equal(formatTurnTokens(12300000), "12.3m");
});

test("formatTurnTokens: negative and fractional inputs floor to zero-safe ints", () => {
	assert.equal(formatTurnTokens(-5), "0");
	assert.equal(formatTurnTokens(999.9), "999");
	assert.equal(formatTurnTokens(Number.NaN), "0");
});

test("formatContextTokens: uppercase K/M ladder", () => {
	assert.equal(formatContextTokens(0), "0");
	assert.equal(formatContextTokens(999), "999");
	assert.equal(formatContextTokens(1000), "1.0K");
	assert.equal(formatContextTokens(1234), "1.2K");
	assert.equal(formatContextTokens(8500), "8.5K");
	assert.equal(formatContextTokens(9999), "10.0K");
	assert.equal(formatContextTokens(10000), "10K");
	assert.equal(formatContextTokens(12000), "12K");
	assert.equal(formatContextTokens(999999), "999K");
	assert.equal(formatContextTokens(1000000), "1.0M");
	assert.equal(formatContextTokens(9999999), "10.0M");
	assert.equal(formatContextTokens(10000000), "10M");
	assert.equal(formatContextTokens(12000000), "12M");
});

test("formatContextTokens differs from formatTurnTokens on purpose", () => {
	assert.notEqual(formatContextTokens(1234), formatTurnTokens(1234));
	assert.equal(
		`${formatContextTokens(8500)} / ${formatContextTokens(1000000)}`,
		"8.5K / 1.0M",
	);
});

test("formatPercent5: always exactly 5 chars", () => {
	assert.equal(formatPercent5(0), "0.00%");
	assert.equal(formatPercent5(5.123), "5.12%");
	assert.equal(formatPercent5(9.5), "9.50%");
	assert.equal(formatPercent5(9.999), "10.0%");
	assert.equal(formatPercent5(10), "10.0%");
	assert.equal(formatPercent5(20.24), "20.2%");
	assert.equal(formatPercent5(99.9), "99.9%");
	assert.equal(formatPercent5(99.99), "MAX %");
	assert.equal(formatPercent5(100), "MAX %");
	assert.equal(formatPercent5(1000), "MAX %");
	assert.equal(formatPercent5(-3), "0.00%");
	for (const p of [
		0, 0.004, 1, 9.98, 9.999, 10, 55.55, 99.94, 99.99, 100, 1e6, -1,
	]) {
		assert.equal(formatPercent5(p).length, 5, `width for ${p}`);
	}
});

test("hexToRgb: long form, shorthand, rejects garbage", () => {
	assert.deepEqual(hexToRgb("#C4A7E7"), [196, 167, 231]);
	assert.deepEqual(hexToRgb("030304"), [3, 3, 4]);
	assert.deepEqual(hexToRgb("#fff"), [255, 255, 255]);
	assert.throws(() => hexToRgb("#12345"));
});

test("blendHex: endpoints, rounding, shorthand, clamping", () => {
	assert.equal(blendHex("#000000", "#ffffff", 0), "#000000");
	assert.equal(blendHex("#000000", "#ffffff", 1), "#ffffff");
	// 127.5 must round up, not truncate
	assert.equal(blendHex("#000000", "#ffffff", 0.5), "#808080");
	assert.equal(blendHex("#000", "#fff", 0.5), "#808080");
	assert.equal(blendHex("#E4E4E4", "#C4A7E7", 0), "#e4e4e4");
	assert.equal(blendHex("#E4E4E4", "#C4A7E7", 1), "#c4a7e7");
	assert.equal(blendHex("#E4E4E4", "#C4A7E7", 0.5), "#d4c6e6");
	assert.equal(blendHex("#000000", "#ffffff", 2), "#ffffff");
	assert.equal(blendHex("#000000", "#ffffff", -1), "#000000");
	assert.equal(blendHex("#123456", "#123456", 0.37), "#123456");
});

test("blendHex: rejects malformed hex", () => {
	assert.throws(() => blendHex("#12345", "#ffffff", 0.5));
	assert.throws(() => blendHex("nope", "#ffffff", 0.5));
});

test("contextGradientHex: breakpoints", () => {
	assert.equal(contextGradientHex(0), "#e4e4e4");
	assert.equal(contextGradientHex(50), "#c4a7e7");
	assert.equal(contextGradientHex(65), "#c4a7e7");
	assert.equal(contextGradientHex(75), "#ebd96e");
	assert.equal(contextGradientHex(85), "#ebd96e");
	assert.equal(contextGradientHex(95), "#dc5a64");
});

test("contextGradientHex: segment midpoints", () => {
	assert.equal(contextGradientHex(25), "#d4c6e6");
	assert.equal(contextGradientHex(70), "#d8c0ab");
	assert.equal(contextGradientHex(90), "#e49a69");
});

test("contextGradientHex accepts a custom accent", () => {
	assert.equal(contextGradientHex(50, "#88C0D0"), "#88c0d0");
	assert.equal(contextGradientHex(65, "#88C0D0"), "#88c0d0");
});

test("contextGradientHex: flat segments stay flat", () => {
	assert.equal(contextGradientHex(51), "#c4a7e7");
	assert.equal(contextGradientHex(57.5), "#c4a7e7");
	assert.equal(contextGradientHex(64.9), "#c4a7e7");
	assert.equal(contextGradientHex(76), "#ebd96e");
	assert.equal(contextGradientHex(80), "#ebd96e");
	assert.equal(contextGradientHex(84.9), "#ebd96e");
});

test("contextGradientHex: clamps outside 0..95", () => {
	assert.equal(contextGradientHex(-10), "#e4e4e4");
	assert.equal(contextGradientHex(96), "#dc5a64");
	assert.equal(contextGradientHex(1000), "#dc5a64");
	assert.equal(contextGradientHex(Number.NaN), "#e4e4e4");
});

test("formatCwd: collapses under home", () => {
	assert.equal(formatCwd("/Users/jo", "/Users/jo"), "~");
	assert.equal(formatCwd("/Users/jo/", "/Users/jo"), "~");
	assert.equal(formatCwd("/Users/jo/dev/pi", "/Users/jo"), "~/dev/pi");
	assert.equal(formatCwd("/Users/jo/dev/pi/", "/Users/jo"), "~/dev/pi");
	assert.equal(formatCwd("/Users/jo/dev", "/Users/jo/"), "~/dev");
});

test("formatCwd: leaves paths outside home untouched", () => {
	assert.equal(formatCwd("/Users/joanne/x", "/Users/jo"), "/Users/joanne/x");
	assert.equal(formatCwd("/Users/jo-other", "/Users/jo"), "/Users/jo-other");
	assert.equal(formatCwd("/tmp/build", "/Users/jo"), "/tmp/build");
	assert.equal(formatCwd("/", "/Users/jo"), "/");
});

test("formatCwd: relative input and empty home pass through", () => {
	assert.equal(formatCwd("dev/pi", "/Users/jo"), "dev/pi");
	assert.equal(formatCwd("./dev", "/Users/jo"), "./dev");
	assert.equal(formatCwd("/Users/jo/dev", ""), "/Users/jo/dev");
	assert.equal(formatCwd("/Users/jo/dev", "/"), "~/Users/jo/dev");
});

