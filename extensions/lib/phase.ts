/**
 * Turn-phase state machine driving the status row's label (spec §4).
 *
 * grok reads its phase straight off its own agent loop; Pi exposes the same
 * information as discrete events, so this reduces those events into the phase
 * the row should show. Pure and event-sourced so it is testable without
 * booting Pi.
 */
import type { StatusPhase } from "./status.ts";

/**
 * Pi extension events, normalised to the signals the phase actually depends on.
 *
 * `cancel` and `retry` complete grok's phase set (spec §4) but Pi emits no event
 * for either yet, so nothing fires them today — the extension wires the other seven.
 */
export type PhaseSignal =
	| "agent_start"
	| "assistant_text"
	| "assistant_thinking"
	| "tool_start"
	| "tool_end"
	| "compact_start"
	| "compact_end"
	| "cancel"
	| "retry"
	| "settled";

export interface PhaseState {
	phase: StatusPhase;
	/** Whether the status row should be visible at all. */
	active: boolean;
	turnStartedAt: number;
	phaseStartedAt: number;
	/** Tools currently in flight — the row stays on "Running…" until it hits 0. */
	running: number;
	/** 1 while on the first attempt; grok labels the first retry "attempt 2". */
	attempt: number;
}

export function idlePhase(): PhaseState {
	return {
		phase: "thinking",
		active: false,
		turnStartedAt: 0,
		phaseStartedAt: 0,
		running: 0,
		attempt: 1,
	};
}

/** Move to `phase`, restarting the phase clock only on a real change. */
function enter(state: PhaseState, phase: StatusPhase, now: number): PhaseState {
	if (state.phase === phase) return state;
	return { ...state, phase, phaseStartedAt: now };
}

export function reducePhase(
	state: PhaseState,
	signal: PhaseSignal,
	now: number,
): PhaseState {
	switch (signal) {
		case "agent_start":
			// A retry or a queued follow-up re-enters the loop inside one turn;
			// the turn clock belongs to the turn, so only start it once.
			return {
				...state,
				phase: "thinking",
				active: true,
				turnStartedAt: state.active ? state.turnStartedAt : now,
				phaseStartedAt: now,
			};

		case "compact_start":
			// Compaction can run outside a turn (auto-compact), so it opens one.
			return {
				...enter(state, "compacting", now),
				active: true,
				turnStartedAt: state.active ? state.turnStartedAt : now,
			};

		case "settled":
			return { ...state, active: false, running: 0, attempt: 1 };

		default:
			break;
	}

	// Everything below only refines a turn that is already open — a stray tool
	// or delta event must never fake activity.
	if (!state.active) return state;

	switch (signal) {
		case "assistant_text":
			return state.running > 0 ? state : enter(state, "responding", now);
		case "assistant_thinking":
			return state.running > 0 ? state : enter(state, "thinking", now);
		case "tool_start":
			return { ...enter(state, "running", now), running: state.running + 1 };
		case "tool_end": {
			const running = Math.max(0, state.running - 1);
			const next = running === 0 ? enter(state, "thinking", now) : state;
			return { ...next, running };
		}
		case "compact_end":
			return enter(state, "thinking", now);
		case "cancel":
			return enter(state, "cancelling", now);
		case "retry":
			return { ...enter(state, "retrying", now), attempt: state.attempt + 1 };
		default:
			return state;
	}
}
