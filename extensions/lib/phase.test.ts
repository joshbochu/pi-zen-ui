import { strict as assert } from "node:assert";
import { test } from "node:test";

import { idlePhase, reducePhase } from "./phase.ts";

test("idle state is inactive", () => {
	const s = idlePhase();
	assert.equal(s.active, false);
	assert.equal(s.running, 0);
});

test("agent_start opens a turn in the thinking phase", () => {
	const s = reducePhase(idlePhase(), "agent_start", 1_000);
	assert.equal(s.active, true);
	assert.equal(s.phase, "thinking");
	assert.equal(s.turnStartedAt, 1_000);
	assert.equal(s.phaseStartedAt, 1_000);
});

test("a second agent_start inside one turn keeps the original turn clock", () => {
	let s = reducePhase(idlePhase(), "agent_start", 1_000);
	s = reducePhase(s, "agent_start", 5_000);
	assert.equal(s.turnStartedAt, 1_000, "turn timer must not restart mid-turn");
});

test("text deltas switch to responding, thinking deltas switch back", () => {
	let s = reducePhase(idlePhase(), "agent_start", 0);
	s = reducePhase(s, "assistant_text", 500);
	assert.equal(s.phase, "responding");
	assert.equal(s.phaseStartedAt, 500, "phase clock restarts on a phase change");
	s = reducePhase(s, "assistant_thinking", 900);
	assert.equal(s.phase, "thinking");
	assert.equal(s.phaseStartedAt, 900);
});

test("repeating the same signal does not reset the phase clock", () => {
	let s = reducePhase(idlePhase(), "agent_start", 0);
	s = reducePhase(s, "assistant_text", 500);
	s = reducePhase(s, "assistant_text", 700);
	assert.equal(s.phaseStartedAt, 500);
});

test("tool starts are counted and drop back to thinking only when all finish", () => {
	let s = reducePhase(idlePhase(), "agent_start", 0);
	s = reducePhase(s, "tool_start", 100);
	s = reducePhase(s, "tool_start", 150);
	assert.equal(s.phase, "running");
	assert.equal(s.running, 2);
	s = reducePhase(s, "tool_end", 200);
	assert.equal(s.phase, "running", "one tool is still running");
	s = reducePhase(s, "tool_end", 250);
	assert.equal(s.running, 0);
	assert.equal(s.phase, "thinking");
});

test("tool_end never drives the running count negative", () => {
	let s = reducePhase(idlePhase(), "agent_start", 0);
	s = reducePhase(s, "tool_end", 10);
	assert.equal(s.running, 0);
});

test("compaction takes over and hands back to thinking", () => {
	let s = reducePhase(idlePhase(), "compact_start", 0);
	assert.equal(s.phase, "compacting");
	assert.equal(
		s.active,
		true,
		"compaction outside a turn still shows activity",
	);
	s = reducePhase(s, "compact_end", 100);
	assert.equal(s.phase, "thinking");
});

test("cancel wins over a running tool", () => {
	let s = reducePhase(idlePhase(), "agent_start", 0);
	s = reducePhase(s, "tool_start", 10);
	s = reducePhase(s, "cancel", 20);
	assert.equal(s.phase, "cancelling");
});

test("retry carries the attempt number and increments", () => {
	let s = reducePhase(idlePhase(), "agent_start", 0);
	s = reducePhase(s, "retry", 10);
	assert.equal(s.phase, "retrying");
	assert.equal(s.attempt, 2, "first retry is attempt 2");
	s = reducePhase(s, "retry", 20);
	assert.equal(s.attempt, 3);
});

test("settled closes the turn and clears tool + retry bookkeeping", () => {
	let s = reducePhase(idlePhase(), "agent_start", 0);
	s = reducePhase(s, "tool_start", 10);
	s = reducePhase(s, "retry", 20);
	s = reducePhase(s, "settled", 30);
	assert.equal(s.active, false);
	assert.equal(s.running, 0);
	assert.equal(s.attempt, 1);
});

test("signals arriving while idle do not fake activity", () => {
	for (const signal of ["assistant_text", "tool_start", "tool_end"] as const) {
		const s = reducePhase(idlePhase(), signal, 100);
		assert.equal(s.active, false, `${signal} must not open a turn`);
	}
});
