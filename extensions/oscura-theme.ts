import { homedir } from "node:os";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	AssistantMessageComponent,
	CustomEditor,
	UserMessageComponent,
	type ExtensionAPI,
	type ExtensionContext,
	type KeybindingsManager,
	type Theme,
	type ThemeColor,
} from "@earendil-works/pi-coding-agent";
import type { EditorTheme, TUI } from "@earendil-works/pi-tui";
import {
	contextGradientHex,
	formatContextTokens,
	formatCwd,
	hexToRgb,
} from "./lib/format.ts";
import { grokMarkdownTheme, type MarkdownThemeLike } from "./lib/markdown.ts";
import { idlePhase, reducePhase, type PhaseSignal } from "./lib/phase.ts";
import {
	infoLine,
	placeholderRow,
	PLACEHOLDER,
	stripAnsi,
	titleOnBorder,
	truncateToWidth,
	visibleWidth,
} from "./lib/prompt.ts";
import {
	SPINNER_FRAMES,
	SPINNER_INTERVAL_MS,
	statusRow,
	type StatusPhase,
} from "./lib/status.ts";

const THEME_NAME = "oscura-midnight";
const THEME_PATH = resolve(
	dirname(fileURLToPath(import.meta.url)),
	"../themes/oscura-midnight.json",
);
const STATUS_KEY = "oscura-theme-turn-status";
const CHROME_MARGIN = 0;
// Space inside the box before ❯. Glyph stays put; chat text is shifted to the tip.
const PROMPT_INSET = 2;
const PROMPT_MARKER = "❯ ";
// Absolute column of the pointer tip / input text start:
//   CHROME_MARGIN + box border (│) + PROMPT_INSET + "❯ "
const TEXT_ALIGN_PAD =
	CHROME_MARGIN + 1 + PROMPT_INSET + visibleWidth(PROMPT_MARKER);
const TERMINAL_CANVAS_COLOR = "#030304";
const SET_TERMINAL_CANVAS = `\x1b]11;${TERMINAL_CANVAS_COLOR}\x07`;
const RESET_TERMINAL_CANVAS = "\x1b]111\x07";
// Spec §9: grok paints the cursor with accent_user via OSC 12, resets via OSC 112.
const SET_CURSOR_COLOR = "\x1b]12;rgb:c4/a7/e7\x07";
const RESET_CURSOR_COLOR = "\x1b]112\x07";
const CONTEXT_SEPARATOR = "│";
// grok's non-Nerd-font git branch icon (`git_info.rs:328`).
const BRANCH_ICON = "⎇";

/** Theme in use, for the markdown skin patched onto message prototypes. */
let activeTheme: Theme | undefined;

/** Truecolor foreground for a computed hex (context gradient has no theme key). */
function hexFg(theme: Theme, hex: string, text: string): string {
	if (theme.getColorMode() !== "truecolor") return theme.fg("text", text);
	const [r, g, b] = hexToRgb(hex);
	return `\x1b[38;2;${r};${g};${b}m${text}\x1b[39m`;
}

/**
 * grok's heading ramp, as far as Pi makes it reachable (spec §1, §10).
 * Pi reveals a heading's level only after it has already styled the text, so
 * h3-h6 fold onto h2's colour; h1 stays separable because Pi underlines it.
 * See lib/markdown.ts for the signal, markdown.integration.test.ts for proof.
 */
const HEADING_COLORS: readonly ThemeColor[] = [
	"text", // h1 TEXT
	"mdHeading", // h2 PURPLE_BRIGHT, carrying h3-h6 with it
];

function markdownPalette(theme: Theme) {
	return {
		headingLevel: (level: number, s: string) => {
			const color = HEADING_COLORS[level - 1] ?? "mdHeading";
			return theme.bold(theme.fg(color, s));
		},
		muted: (s: string) => theme.fg("muted", s),
		codeBg: (s: string) => theme.bg("toolPendingBg", s),
	};
}

/**
 * Pi builds each message component with its own MarkdownTheme and exposes no
 * setter, so the skin is applied on the instance the first time it renders.
 * Also pins outputPad: Pi only exposes 0|1 via settings, but body text has to
 * line up with the tip of ❯ in the composer (TEXT_ALIGN_PAD).
 */
function skinMessageComponent(Component: { prototype: object }): void {
	const proto = Component.prototype as {
		__oscuraSkin?: boolean;
		setOutputPad?: (padding: number) => void;
		updateContent?: (this: object, ...args: unknown[]) => unknown;
		rebuild?: (this: object, ...args: unknown[]) => unknown;
	};
	if (proto.__oscuraSkin) return;
	proto.__oscuraSkin = true;

	const pin = (instance: {
		outputPad?: number;
		markdownTheme?: MarkdownThemeLike;
		__oscuraMarkdown?: boolean;
	}) => {
		instance.outputPad = TEXT_ALIGN_PAD;
		if (instance.__oscuraMarkdown || !instance.markdownTheme || !activeTheme)
			return;
		instance.__oscuraMarkdown = true;
		instance.markdownTheme = grokMarkdownTheme(
			instance.markdownTheme,
			markdownPalette(activeTheme),
		);
	};

	if (typeof proto.setOutputPad === "function") {
		const original = proto.setOutputPad;
		proto.setOutputPad = function (this: object, _padding: number) {
			return original.call(this, TEXT_ALIGN_PAD);
		};
	}
	for (const hook of ["updateContent", "rebuild"] as const) {
		const original = proto[hook];
		if (typeof original !== "function") continue;
		proto[hook] = function (this: object, ...args: unknown[]) {
			pin(this);
			return original.apply(this, args);
		};
	}
}

skinMessageComponent(AssistantMessageComponent);
skinMessageComponent(UserMessageComponent);

let activity = idlePhase();
let requestActivityRender: (() => void) | undefined;
let contextTokens: (() => number | undefined) | undefined;
let terminalCanvasActive = false;
let resetTerminalCanvasOnExit: (() => void) | undefined;

/**
 * Drive the phase through the reducer rather than mutating flags here: tools run
 * concurrently, so "back to thinking" depends on a running count, not on the
 * last tool_execution_end. See lib/phase.ts.
 */
function signal(name: PhaseSignal): void {
	const next = reducePhase(activity, name, Date.now());
	if (next === activity) return;
	activity = next;
	requestActivityRender?.();
}

/** Spec §4: spinner colour tracks the phase. */
function spinnerColor(phase: StatusPhase): ThemeColor {
	if (phase === "running") return "success";
	if (phase === "retrying") return "warning";
	if (phase === "cancelling") return "error";
	return "customMessageText";
}

function enableTerminalCanvas(): void {
	if (
		terminalCanvasActive ||
		!process.stdout.isTTY ||
		process.env.PI_OSCURA_TERMINAL_CANVAS === "0"
	) {
		return;
	}

	process.stdout.write(SET_TERMINAL_CANVAS + SET_CURSOR_COLOR);
	terminalCanvasActive = true;
	resetTerminalCanvasOnExit = () => {
		if (!terminalCanvasActive) return;
		process.stdout.write(RESET_TERMINAL_CANVAS + RESET_CURSOR_COLOR);
		terminalCanvasActive = false;
	};
	process.once("exit", resetTerminalCanvasOnExit);
}

function disableTerminalCanvas(): void {
	if (terminalCanvasActive) {
		process.stdout.write(RESET_TERMINAL_CANVAS + RESET_CURSOR_COLOR);
		terminalCanvasActive = false;
	}
	if (resetTerminalCanvasOnExit) {
		process.off("exit", resetTerminalCanvasOnExit);
		resetTerminalCanvasOnExit = undefined;
	}
}

function editorLayout(width: number): {
	outerMargin: number;
	contentWidth: number;
	promptInset: number;
} {
	const outerMargin = width >= 12 ? CHROME_MARGIN : 0;
	const contentWidth = Math.max(1, width - outerMargin * 2 - 2);
	const promptInset = contentWidth > PROMPT_INSET + 4 ? PROMPT_INSET : 0;
	return { outerMargin, contentWidth, promptInset };
}

function borderLineIndex(lines: string[]): number | undefined {
	for (let i = lines.length - 1; i >= 2; i--) {
		const plain = stripAnsi(lines[i] ?? "");
		if (/^─+(?: [↑↓] \d+ more )?─*$/.test(plain)) return i;
	}
	return undefined;
}

interface EditorChrome {
	title: () => string;
	model: () => string;
	effort: () => string;
	flags: () => readonly string[];
}

class OscuraEditor extends CustomEditor {
	private readonly menuRenderState: { width: number };

	constructor(
		tui: TUI,
		editorTheme: EditorTheme,
		keybindings: KeybindingsManager,
		private readonly fullTheme: () => Theme,
		private readonly chrome: EditorChrome,
	) {
		const menuRenderState = { width: 1 };
		super(
			tui,
			{
				...editorTheme,
				selectList: {
					...editorTheme.selectList,
					selectedText: (text: string) => {
						const theme = fullTheme();
						const row = text.replace(/^→ /, "❯ ");
						const clipped = truncateToWidth(row, menuRenderState.width, "");
						const columns = clipped.match(/^(❯ .+?)(\s{2,})(\S.*)$/);
						const styled = columns
							? theme.fg("accent", theme.bold(columns[1] ?? "")) +
								theme.fg("muted", `${columns[2] ?? ""}${columns[3] ?? ""}`)
							: theme.fg("accent", theme.bold(clipped));
						const padding = " ".repeat(
							Math.max(0, menuRenderState.width - visibleWidth(clipped)),
						);
						return theme.bg("selectedBg", styled + padding);
					},
				},
			},
			keybindings,
			{ paddingX: 2 },
		);
		this.menuRenderState = menuRenderState;
	}

	override setPaddingX(_padding: number): void {
		super.setPaddingX(2);
	}

	private autocompleteItemCount(): number | undefined {
		const internals = this as unknown as {
			autocompleteList?: { filteredItems?: unknown[] };
		};
		return internals.autocompleteList?.filteredItems?.length;
	}

	private renderAutocompleteMenu(
		lines: string[],
		width: number,
		outerMargin: number,
		theme: Theme,
	): string[] {
		const rows = lines.filter(
			(line) => !/^\s*\(\d+\/\d+\)\s*$/.test(stripAnsi(line)),
		);
		if (rows.length === 0) return [];

		const menuMarginWidth = outerMargin > 0 ? outerMargin - 1 : 0;
		const menuMargin = " ".repeat(menuMarginWidth);
		const panelWidth = Math.max(1, width - menuMarginWidth * 2);
		const count = this.autocompleteItemCount();
		const countText = count === undefined ? "" : String(count);
		const countWidth = visibleWidth(countText);
		const countFits = countText !== "" && countWidth + 1 < panelWidth;
		const top = countFits
			? theme.fg("borderMuted", "─".repeat(panelWidth - countWidth - 1)) +
				theme.fg("muted", countText) +
				theme.fg("borderMuted", "─")
			: theme.fg("borderMuted", "─".repeat(panelWidth));
		const bottom = theme.fg("borderMuted", "─".repeat(panelWidth));

		const body = rows.map((line) => {
			const clipped = truncateToWidth(line, panelWidth, "");
			const padded =
				clipped + " ".repeat(Math.max(0, panelWidth - visibleWidth(clipped)));
			return menuMargin + theme.bg("customMessageBg", padded) + menuMargin;
		});

		return [
			menuMargin + top + menuMargin,
			...body,
			menuMargin + bottom + menuMargin,
		];
	}

	override render(width: number): string[] {
		if (width < 4) return super.render(width);

		const theme = this.fullTheme();
		// Spec §3: prompt_border idle, prompt_border_active while focused.
		const borderKey: ThemeColor = this.focused ? "borderAccent" : "border";
		const paintBorder = (text: string) => theme.fg(borderKey, text);
		this.borderColor = paintBorder;

		const { outerMargin, contentWidth, promptInset } = editorLayout(width);
		const baseEditorWidth = Math.max(1, contentWidth - promptInset);
		this.menuRenderState.width = Math.max(1, baseEditorWidth - 4);
		const lines = super.render(baseEditorWidth);
		const bottom = borderLineIndex(lines);
		if (bottom === undefined) return lines;

		const editorLines = lines.slice(0, bottom + 1);
		const autocompleteLines = lines.slice(bottom + 1);

		const promptIndent = " ".repeat(promptInset);
		const markerWidth = visibleWidth(PROMPT_MARKER);
		// Spec §3: ❯ is never replaced by a spinner; it only dims when unfocused.
		const marker = this.focused
			? theme.fg("accent", theme.bold(PROMPT_MARKER))
			: theme.fg("dim", PROMPT_MARKER);
		const showPlaceholder = this.getText() === "" && !this.focused;
		for (let index = 1; index < bottom; index++) {
			const line = editorLines[index] ?? "";
			if (index === 1 && line.startsWith(" ".repeat(markerWidth))) {
				const body = line.slice(markerWidth);
				editorLines[index] =
					promptIndent +
					marker +
					(showPlaceholder
						? placeholderRow(body, PLACEHOLDER, 0, (s) => theme.fg("muted", s))
						: body);
			} else {
				editorLines[index] = promptIndent + line;
			}
		}

		// Spec §3: model (effort) on the bottom border, right-aligned. No context %.
		const info = infoLine(
			{
				model: this.chrome.model(),
				effort: this.chrome.effort(),
				flags: this.chrome.flags(),
			},
			Math.max(1, Math.floor(contentWidth * 0.55)),
			{
				model: (s) => theme.fg("dim", s),
				separator: (s) => theme.fg("dim", s),
				flag: (s) => theme.fg("muted", s),
			},
		);
		const cornerConnector = paintBorder("─");
		const borderWidth = Math.max(
			0,
			contentWidth - visibleWidth(info) - visibleWidth(cornerConnector),
		);
		editorLines[bottom] =
			truncateToWidth(editorLines[bottom] ?? "", borderWidth, "") +
			info +
			cornerConnector;

		const editorBottom = editorLines.length - 1;
		const margin = " ".repeat(outerMargin);
		const side = paintBorder("│");
		const fit = (line: string) => {
			const clipped = truncateToWidth(line, contentWidth, "");
			return (
				clipped + " ".repeat(Math.max(0, contentWidth - visibleWidth(clipped)))
			);
		};
		const fitTopBorder = (line: string) => {
			const clipped = truncateToWidth(line, contentWidth, "");
			return (
				clipped +
				paintBorder(
					"─".repeat(Math.max(0, contentWidth - visibleWidth(clipped))),
				)
			);
		};
		const box = editorLines.map((line, index) => {
			if (index === 0) {
				// Spec §3: session title rides the top border, right-aligned.
				const top = titleOnBorder(
					fitTopBorder(line),
					this.chrome.title(),
					(s) => theme.fg("muted", s),
				);
				return margin + paintBorder("╭") + top + paintBorder("╮") + margin;
			}
			if (index < editorBottom) {
				return margin + side + fit(line) + side + margin;
			}
			return margin + paintBorder("╰") + fit(line) + paintBorder("╯") + margin;
		});

		const menu = this.renderAutocompleteMenu(
			autocompleteLines,
			width,
			outerMargin,
			theme,
		);
		return [...menu, ...box];
	}
}

function installTurnStatus(ctx: ExtensionContext): void {
	ctx.ui.setWidget(
		STATUS_KEY,
		(tui, theme) => {
			const rerender = () => tui.requestRender();
			requestActivityRender = rerender;
			const timer = setInterval(() => {
				if (activity.active) rerender();
			}, SPINNER_INTERVAL_MS);

			return {
				render(width: number): string[] {
					if (!activity.active || width <= 0) return [];
					const now = Date.now();
					const row = statusRow(
						{
							phase: activity.phase,
							attempt: activity.attempt,
							turnMs: now - activity.turnStartedAt,
							phaseMs: now - activity.phaseStartedAt,
							// Spec §4 / glyphs.rs: ⇣ is the context-token count.
							tokens: contextTokens?.(),
							now,
						},
						width,
						{
							spinner: (s) => theme.fg(spinnerColor(activity.phase), s),
							label: (s) => theme.fg("customMessageText", s),
							timer: (s) => theme.fg("muted", s),
							stop: (s) => theme.fg("muted", s),
						},
					);
					// Spec §4: one blank gap row between the status row and the box.
					return row === "" ? [] : [row, ""];
				},
				invalidate() {},
				dispose() {
					clearInterval(timer);
					if (requestActivityRender === rerender)
						requestActivityRender = undefined;
				},
			};
		},
		{ placement: "aboveEditor" },
	);
}

function installFooter(ctx: ExtensionContext): void {
	ctx.ui.setFooter((tui, theme, footerData) => {
		const unsubscribe = footerData.onBranchChange(() => tui.requestRender());
		return {
			dispose: unsubscribe,
			invalidate() {},
			render(width: number): string[] {
				// Spec §3: grok's top bar reads `{branch_icon} {branch}` then the path,
				// as separate items rather than `path (branch)`.
				const branch = footerData.getGitBranch();
				const separator = theme.fg("dim", ` ${CONTEXT_SEPARATOR} `);
				const left = [
					branch ? theme.fg("muted", `${BRANCH_ICON} ${branch}`) : "",
					theme.fg("dim", formatCwd(ctx.cwd, homedir())),
				]
					.filter((item) => item !== "")
					.join(separator);

				const margin = width >= CHROME_MARGIN + 1 ? CHROME_MARGIN : 0;
				const available = width - margin;
				// Spec §5: context chip `8.5K / 1.0M`, gradient over usage percent.
				const usage = ctx.getContextUsage();
				const chip =
					usage && usage.tokens !== null
						? hexFg(
								theme,
								contextGradientHex(usage.percent ?? 0),
								`${formatContextTokens(usage.tokens)} / ${formatContextTokens(usage.contextWindow)}`,
							)
						: "";
				const chipWidth =
					chip === "" ? 0 : visibleWidth(chip) + visibleWidth(separator);
				const leftText = truncateToWidth(
					left,
					Math.max(0, available - chipWidth),
					"…",
				);
				const gap = Math.max(0, available - visibleWidth(leftText) - chipWidth);
				const row =
					chip === ""
						? leftText
						: leftText + " ".repeat(gap) + separator + chip;
				return [" ".repeat(margin) + row];
			},
		};
	});
}

export default function oscuraTheme(pi: ExtensionAPI) {
	let activeUi: ExtensionContext["ui"] | undefined;

	// Pi exposes one footer area. Keep pi-powerbar installed, but suppress its
	// extra widget while this skin owns the terminal chrome.
	pi.events.on("powerbar:update", () => {
		if (process.env.PI_OSCURA_KEEP_POWERBAR !== "1") {
			activeUi?.setWidget("powerbar", undefined);
		}
	});

	pi.on("resources_discover", (_event, ctx) => {
		if (ctx.mode === "tui") {
			setTimeout(() => {
				if (activeUi !== ctx.ui) return;
				const oscuraTheme = ctx.ui.getTheme(THEME_NAME);
				const selected = oscuraTheme
					? ctx.ui.setTheme(oscuraTheme)
					: {
							success: false,
							error: `Theme not found after discovery: ${THEME_NAME}`,
						};
				if (!selected.success) {
					ctx.ui.notify(
						`Oscura theme unavailable: ${selected.error ?? THEME_NAME}`,
						"warning",
					);
				}
			}, 0);
		}
		return { themePaths: [THEME_PATH] };
	});

	pi.on("session_start", (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		activeUi = ctx.ui;
		activeTheme = ctx.ui.theme;
		contextTokens = () => ctx.getContextUsage()?.tokens ?? undefined;
		enableTerminalCanvas();
		if (process.env.PI_OSCURA_KEEP_POWERBAR !== "1") {
			ctx.ui.setWidget("powerbar", undefined);
		}

		ctx.ui.setTitle(`pi · ${basename(ctx.cwd) || ctx.cwd}`);
		ctx.ui.setHeader(() => ({ render: () => [], invalidate() {} }));
		ctx.ui.setWorkingVisible(false);
		// Spec §6: grok's collapsed thinking label is "Thought"; ◆ is the tool bullet.
		ctx.ui.setHiddenThinkingLabel("Thought");
		ctx.ui.setWorkingIndicator({
			frames: SPINNER_FRAMES.map((frame) =>
				ctx.ui.theme.fg("customMessageLabel", frame),
			),
			intervalMs: SPINNER_INTERVAL_MS,
		});

		installTurnStatus(ctx);
		installFooter(ctx);

		ctx.ui.setEditorComponent(
			(tui, editorTheme, keybindings) =>
				new OscuraEditor(tui, editorTheme, keybindings, () => ctx.ui.theme, {
					title: () => pi.getSessionName() ?? basename(ctx.cwd) ?? "",
					// Spec §3: grok's info line shows the model id, not its display name.
					model: () => ctx.model?.id || ctx.model?.name || "no model",
					// grok flags queued input on the same line (`"3 queued"`).
					flags: () => (ctx.hasPendingMessages() ? ["queued"] : []),
					effort: () => pi.getThinkingLevel(),
				}),
		);
	});

	// Show the row from the moment the prompt is accepted, not once the provider
	// answers; `agent_start` also fires on retries, which must not restart the
	// turn clock (the reducer keeps it).
	pi.on("before_agent_start", () => signal("agent_start"));
	pi.on("agent_start", () => signal("agent_start"));
	pi.on("message_update", (event) => {
		const type = event.assistantMessageEvent?.type;
		if (type === "text_start" || type === "text_delta")
			signal("assistant_text");
		else if (type === "thinking_start" || type === "thinking_delta")
			signal("assistant_thinking");
	});
	pi.on("tool_execution_start", () => signal("tool_start"));
	pi.on("tool_execution_end", () => signal("tool_end"));
	pi.on("agent_end", (event) => {
		// `willRetry` ships on the Wealthsimple fork but not on public 0.81.1. Read it
		// structurally so the retrying phase lights up where the field exists and the
		// extension still typechecks where it does not.
		if ((event as { willRetry?: boolean }).willRetry) signal("retry");
	});
	pi.on("session_before_compact", () => signal("compact_start"));
	pi.on("session_compact", () => signal("compact_end"));
	pi.on("agent_settled", () => signal("settled"));
	pi.on("session_shutdown", () => {
		activeUi = undefined;
		activeTheme = undefined;
		contextTokens = undefined;
		disableTerminalCanvas();
		signal("settled");
	});
}
