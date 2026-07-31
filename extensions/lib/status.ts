/**
 * Turn-status row composition, ported from grok's `turn_status.rs`.
 * See docs/grok-fidelity-spec.md §4.
 *
 * Pure: the only import is the sibling formatter module. Colours arrive as
 * style callbacks so this runs under `node --test` without booting Pi.
 */
import { formatDuration, formatTurnTokens } from "./format.ts";

/** Spec §4: 8 braille frames, `SPINNER_DIVISOR = 4` at 30fps. */
export const SPINNER_FRAMES: readonly string[] = [
	"⠋",
	"⠙",
	"⠹",
	"⠸",
	"⠼",
	"⠴",
	"⠦",
	"⠧",
];
export const SPINNER_INTERVAL_MS = 133;

export type StatusPhase =
	| "thinking"
	| "responding"
	| "verifying"
	| "compacting"
	| "running"
	| "waiting"
	| "cancelling"
	| "retrying"
	| "starting";

export interface StatusState {
	phase: StatusPhase;
	attempt?: number;
	turnMs: number;
	phaseMs: number;
	tokens?: number;
	/**
	 * Queued (steering) input exists. grok appends `" · {n} queued"` to the
	 * left group (`turn_status.rs:562`); Pi only exposes a boolean
	 * (`hasPendingMessages`), so the count is omitted.
	 */
	queued?: boolean;
	now: number;
}

export interface StatusStyle {
	spinner: (s: string) => string;
	label: (s: string) => string;
	timer: (s: string) => string;
	stop: (s: string) => string;
}

const LABELS: Record<Exclude<StatusPhase, "retrying">, string> = {
	thinking: "Thinking…",
	responding: "Responding…",
	verifying: "Verifying…",
	compacting: "Compacting…",
	running: "Running…",
	waiting: "Waiting…",
	cancelling: "Cancelling…",
	starting: "Starting session…",
};

/** Spec §4 label literals; `retrying` carries the attempt number. */
export function phaseLabel(phase: StatusPhase, attempt?: number): string {
	if (phase === "retrying") return `Retrying (attempt ${attempt ?? 1})…`;
	return LABELS[phase];
}

export function spinnerFrame(now: number): string {
	const tick = Number.isFinite(now) ? Math.floor(now / SPINNER_INTERVAL_MS) : 0;
	const len = SPINNER_FRAMES.length;
	return SPINNER_FRAMES[((tick % len) + len) % len]!;
}

// ponytail: CSI-only stripper — that is all the style callbacks emit.
const ANSI = /\x1b\[[0-9;]*[a-zA-Z]/g;

function visibleWidth(s: string): number {
	return [...s.replace(ANSI, "")].length;
}

interface Part {
	text: string;
	paint: (s: string) => string;
}

/** Parts inside a group are separated by exactly one unstyled space. */
const groupWidth = (parts: Part[]) =>
	parts.length === 0
		? 0
		: parts.reduce((w, p) => w + visibleWidth(p.text), 0) + parts.length - 1;
const paintGroup = (parts: Part[]) =>
	parts.map((p) => p.paint(p.text)).join(" ");
const plainGroup = (parts: Part[]) => parts.map((p) => p.text).join(" ");

/**
 * One status line, right group flush right with a minimum 1-column gap.
 * As `width` shrinks the row degrades: tokens, phase timer, turn timer, label,
 * then the stop button, leaving just the spinner. Never exceeds `width`.
 */
export function statusRow(
	state: StatusState,
	width: number,
	style: StatusStyle,
): string {
	if (!(width > 0)) return "";

	const starting = state.phase === "starting";
	// Spec §4: the startup row is painted entirely in gray_dim.
	const paint: StatusStyle = starting
		? {
				spinner: style.timer,
				label: style.timer,
				timer: style.timer,
				stop: style.timer,
			}
		: style;

	const part = (text: string, brush: (s: string) => string): Part => ({
		text,
		paint: brush,
	});
	const spinner = part(spinnerFrame(state.now), paint.spinner);
	const label = part(phaseLabel(state.phase, state.attempt), paint.label);
	const phaseTimer = part(formatDuration(state.phaseMs), paint.timer);
	const turnTimer = part(formatDuration(state.turnMs), paint.timer);
	const stop = part("[stop]", paint.stop);
	const tokens =
		state.tokens === undefined
			? undefined
			: part(`⇣${formatTurnTokens(state.tokens)}`, paint.timer);
	// Spec §4: grok's queued hint rides the left group after the phase timer,
	// in gray. The startup row never shows it.
	const queued =
		state.queued && !starting ? part("· queued", paint.timer) : undefined;

	const rightFull = tokens ? [turnTimer, tokens, stop] : [turnTimer, stop];
	const leftFull = queued
		? [spinner, label, phaseTimer, queued]
		: [spinner, label, phaseTimer];

	// Startup shows no turn timer, no tokens and no stop button.
	const candidates: [Part[], Part[]][] = starting
		? [
				[[spinner, label, phaseTimer], []],
				[[spinner, label], []],
				[[spinner], []],
			]
		: [
				[leftFull, rightFull],
				// The queued hint is the first casualty as the row narrows.
				[[spinner, label, phaseTimer], rightFull],
				[
					[spinner, label, phaseTimer],
					[turnTimer, stop],
				],
				[
					[spinner, label],
					[turnTimer, stop],
				],
				[[spinner, label], [stop]],
				[[spinner], [stop]],
				[[spinner], []],
			];

	for (const [l, r] of candidates) {
		const lw = groupWidth(l);
		const rw = groupWidth(r);
		if (rw === 0) {
			if (lw > width) continue;
			// Spec §4: the whole startup row is one gray_dim span.
			return starting ? style.timer(plainGroup(l)) : paintGroup(l);
		}
		if (lw + rw + 1 > width) continue;
		return paintGroup(l) + " ".repeat(width - lw - rw) + paintGroup(r);
	}
	return "";
}
