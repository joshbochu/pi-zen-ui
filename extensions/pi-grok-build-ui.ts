import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	AssistantMessageComponent,
	CustomEditor,
	DynamicBorder,
	Theme,
	UserMessageComponent,
	getAgentDir,
	getSettingsListTheme,
	type ExtensionAPI,
	type ExtensionContext,
	type KeybindingsManager,
	type ThemeColor,
} from "@earendil-works/pi-coding-agent";
import {
	Container,
	Input,
	SettingsList,
	type EditorTheme,
	type SettingItem,
	type TUI,
} from "@earendil-works/pi-tui";
import { composeFooterRow, resolveSessionTitle } from "./lib/chrome.ts";
import {
	blendHex,
	contextGradientHex,
	formatContextTokens,
	formatCwd,
	hexToRgb,
} from "./lib/format.ts";
import { grokMarkdownTheme, type MarkdownThemeLike } from "./lib/markdown.ts";
import {
	ACCENT_PRESETS,
	ACCENT_PRESET_LABELS,
	accentPresetFromLabel,
	buildAccentThemeColors,
	effectiveAccentHex,
	normalizeHexColor,
	resolveAccentPalette,
	type ThemeTemplate,
} from "./lib/palette.ts";
import { idlePhase, reducePhase, type PhaseSignal } from "./lib/phase.ts";
import {
	captionOnBottomBorder,
	editorRenderWidth,
	infoLine,
	placeholderRow,
	PLACEHOLDER,
	promptWrapWidth,
	stripAnsi,
	titleOnBorder,
	truncateToWidth,
	visibleWidth,
} from "./lib/prompt.ts";
import {
	VISIBILITY_SETTING_KEYS,
	applyVisibilityPreset,
	loadPiGrokBuildUISettings,
	savePiGrokBuildUISettings,
	withAccentPreset,
	withCustomAccent,
	withVisibilitySetting,
	type PiGrokBuildUISettings,
	type VisibilitySettingKey,
} from "./lib/settings.ts";
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
const SETTINGS_PATH = join(getAgentDir(), "pi-grok-build-ui.json");
const LEGACY_SETTINGS_PATH = join(getAgentDir(), "oscura-theme.json");
const THEME_TEMPLATE = JSON.parse(
	readFileSync(THEME_PATH, "utf8"),
) as ThemeTemplate;
const STATUS_KEY = "pi-grok-build-ui-turn-status";
// Spec §3: grok's whole UI sits inside a 2-column outer pad
// (`LayoutConfig::outer_hpad_left/right = 2`); chrome rows share it.
const CHROME_MARGIN = 2;
// Spec §3: `chrome_pad_left = 2` is measured from the border cell itself, so
// exactly one blank cell separates │ from ❯.
const PROMPT_INSET = 1;
const PROMPT_MARKER = "❯ ";
// Pi's Editor only supports symmetric padding. The 2-column left pad is the
// `❯ ` slot; clipping the prefix-substitution overhang off the right pad
// leaves a matching 1-cell gap before `│`, same as Grok's chrome_pad_right=2.
const EDITOR_PADDING_X = 2;
// Spec §6: grok's transcript rows are [outer pad 2][accent ┃][block pad 2],
// putting content at column 5. (grok's composer text lands at column 6; the
// two surfaces are not aligned in grok either.)
const OUTPUT_PAD = 5;
const TERMINAL_CANVAS_COLOR = "#030304";
const SET_TERMINAL_CANVAS = `\x1b]11;${TERMINAL_CANVAS_COLOR}\x07`;
const RESET_TERMINAL_CANVAS = "\x1b]111\x07";
// Spec §9: grok paints the cursor with accent_user via OSC 12, resets via OSC 112.
const RESET_CURSOR_COLOR = "\x1b]112\x07";
const CONTEXT_SEPARATOR = "│";
// grok's non-Nerd-font git branch icon (`git_info.rs:328`).
const BRANCH_ICON = "⎇";

function environmentValue(name: string, legacyName: string): string | undefined {
	return process.env[name] ?? process.env[legacyName];
}

function keepPowerbar(): boolean {
	return environmentValue(
		"PI_GROK_BUILD_UI_KEEP_POWERBAR",
		"PI_OSCURA_KEEP_POWERBAR",
	) === "1";
}

const VISIBILITY_ITEMS: Record<
	VisibilitySettingKey,
	{ label: string; description: string }
> = {
	showSessionTitle: {
		label: "Show session title",
		description: "Show an explicit session name on the input box's top border.",
	},
	useCwdAsSessionTitle: {
		label: "Use cwd title fallback",
		description: "When no session name is set, use the current directory name.",
	},
	showModelCaption: {
		label: "Show model / effort",
		description: "Show the model id and thinking effort on the lower border.",
	},
	showGitBranch: {
		label: "Show Git branch",
		description: "Show the current Git branch in the footer.",
	},
	showCurrentDirectory: {
		label: "Show current directory",
		description: "Show the current working directory in the footer.",
	},
	showContextUsage: {
		label: "Show context usage",
		description: "Show used and available context tokens in the footer.",
	},
	showTurnStatus: {
		label: "Show turn-status row",
		description: "Show phase, timers, queue state, tokens, and stop hint above the editor.",
	},
};

// Spec §3 `chrome_caption_style`: the session title and the model name share
// one caption — text_secondary blended toward the canvas, 0.6 alpha focused,
// 0.4 unfocused — so both borders read as one chrome.
const CAPTION_FOCUSED_HEX = blendHex(TERMINAL_CANVAS_COLOR, "#bebebe", 0.6);
const CAPTION_UNFOCUSED_HEX = blendHex(TERMINAL_CANVAS_COLOR, "#bebebe", 0.4);
// Spec §3: unfocused, the info-line separator fades to gray_dim at 0.6 and
// flags to gray at 0.5; focused they stay plain gray_dim / gray.
const SEPARATOR_UNFOCUSED_HEX = blendHex(TERMINAL_CANVAS_COLOR, "#5e646c", 0.6);
const FLAG_UNFOCUSED_HEX = blendHex(TERMINAL_CANVAS_COLOR, "#81868f", 0.5);
// Spec §3: grok blends everything between the side borders 0.66 toward the
// canvas while the prompt is unfocused (`blend_area`). The ❯ (already
// gray_dim) and the placeholder (gray) get the same treatment on top.
const DIM_TEXT_HEX = blendHex(TERMINAL_CANVAS_COLOR, "#e4e4e4", 0.66);
const DIM_MARKER_HEX = blendHex(TERMINAL_CANVAS_COLOR, "#5e646c", 0.66);
const DIM_PLACEHOLDER_HEX = blendHex(TERMINAL_CANVAS_COLOR, "#81868f", 0.66);

/** Theme in use, for the markdown skin patched onto message prototypes. */
let activeTheme: Theme | undefined;

/**
 * grok's dropdown label styling (`slash_dropdown.rs build_item_lines`): the
 * label is text_primary with fuzzy-matched chars in fuzzy_accent, bold on the
 * selected row only. Pi exposes no match indices, but its slash menu filters
 * by prefix, so the matched run is the query itself when the label starts
 * with it.
 */
function paintMenuLabel(
	theme: Theme,
	label: string,
	query: string,
	bold: boolean,
): string {
	const paint = (key: ThemeColor, s: string) =>
		s === "" ? "" : bold ? theme.fg(key, theme.bold(s)) : theme.fg(key, s);
	// Pi lists slash commands without their leading `/`, so match the token
	// both ways round.
	const match = [query, query.replace(/^\//, "")].find(
		(candidate) => candidate !== "" && label.startsWith(candidate),
	);
	if (match !== undefined) {
		return (
			paint("accent", label.slice(0, match.length)) +
			paint("text", label.slice(match.length))
		);
	}
	return paint("text", label);
}

/** Truecolor foreground for a computed hex, `fallback` key elsewhere. */
function hexFg(
	theme: Theme,
	hex: string,
	text: string,
	fallback: ThemeColor = "text",
): string {
	if (theme.getColorMode() !== "truecolor") return theme.fg(fallback, text);
	const [r, g, b] = hexToRgb(hex);
	return `\x1b[38;2;${r};${g};${b}m${text}\x1b[39m`;
}

function createAccentTheme(
	settings: PiGrokBuildUISettings,
	currentTheme: Theme,
): Theme {
	const maps = buildAccentThemeColors(
		THEME_TEMPLATE,
		resolveAccentPalette(settings),
	);
	return new Theme(
		maps.foregrounds as ConstructorParameters<typeof Theme>[0],
		maps.backgrounds as ConstructorParameters<typeof Theme>[1],
		currentTheme.getColorMode(),
		{ name: THEME_NAME, sourcePath: THEME_PATH },
	);
}

/**
 * grok's heading ramp, as far as Pi makes it reachable (spec §1, §10).
 * Pi reveals a heading's level only after it has already styled the text, so
 * h3-h6 fold onto h2's colour; h1 stays separable because Pi underlines it.
 * See lib/markdown.ts for the signal, markdown.integration.test.ts for proof.
 */
const HEADING_COLORS: readonly ThemeColor[] = [
	"text", // h1 TEXT
	"mdHeading", // h2 bright accent, carrying h3-h6 with it
];

function markdownPalette(fallbackTheme: Theme) {
	const current = () => activeTheme ?? fallbackTheme;
	return {
		headingLevel: (level: number, s: string) => {
			const theme = current();
			const color = HEADING_COLORS[level - 1] ?? "mdHeading";
			return theme.bold(theme.fg(color, s));
		},
		muted: (s: string) => current().fg("muted", s),
		codeBg: (s: string) => current().bg("toolPendingBg", s),
	};
}

/**
 * Pi builds each message component with its own MarkdownTheme and exposes no
 * setter, so the skin is applied on the instance the first time it renders.
 * Also pins outputPad: Pi only exposes 0|1 via settings, but grok's transcript
 * content starts at column 5 (OUTPUT_PAD).
 */
function skinMessageComponent(Component: { prototype: object }): void {
	const proto = Component.prototype as {
		__piGrokBuildUISkin?: boolean;
		setOutputPad?: (padding: number) => void;
		updateContent?: (this: object, ...args: unknown[]) => unknown;
		rebuild?: (this: object, ...args: unknown[]) => unknown;
	};
	if (proto.__piGrokBuildUISkin) return;
	proto.__piGrokBuildUISkin = true;

	const pin = (instance: {
		outputPad?: number;
		markdownTheme?: MarkdownThemeLike;
		__piGrokBuildUIMarkdown?: boolean;
	}) => {
		instance.outputPad = OUTPUT_PAD;
		if (
			instance.__piGrokBuildUIMarkdown ||
			!instance.markdownTheme ||
			!activeTheme
		)
			return;
		instance.__piGrokBuildUIMarkdown = true;
		instance.markdownTheme = grokMarkdownTheme(
			instance.markdownTheme,
			markdownPalette(activeTheme),
		);
	};

	if (typeof proto.setOutputPad === "function") {
		const original = proto.setOutputPad;
		proto.setOutputPad = function (this: object, _padding: number) {
			return original.call(this, OUTPUT_PAD);
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

function cursorColorEscape(hex: string): string {
	const [r, g, b] = hexToRgb(hex);
	const pair = (value: number) => value.toString(16).padStart(2, "0");
	return `\x1b]12;rgb:${pair(r)}/${pair(g)}/${pair(b)}\x07`;
}

function enableTerminalCanvas(cursorColor: string): void {
	if (
		!process.stdout.isTTY ||
		environmentValue(
			"PI_GROK_BUILD_UI_TERMINAL_CANVAS",
			"PI_OSCURA_TERMINAL_CANVAS",
		) === "0"
	) {
		return;
	}

	if (terminalCanvasActive) {
		process.stdout.write(cursorColorEscape(cursorColor));
		return;
	}
	process.stdout.write(SET_TERMINAL_CANVAS + cursorColorEscape(cursorColor));
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
	showModelCaption: () => boolean;
	model: () => string;
	effort: () => string;
}

/** Exported for the pty-free render harness; Pi only sees the default export. */
export class PiGrokBuildUIEditor extends CustomEditor {
	private readonly menuRenderState: { width: number; query: string };
	private readonly fullTheme: () => Theme;
	private readonly chrome: EditorChrome;

	constructor(
		tui: TUI,
		editorTheme: EditorTheme,
		keybindings: KeybindingsManager,
		fullTheme: () => Theme,
		chrome: EditorChrome,
	) {
		const menuRenderState = { width: 1, query: "" };
		super(
			tui,
			{
				...editorTheme,
				selectList: {
					...editorTheme.selectList,
					// grok `build_item_lines`: the selected row is text_primary
					// bold on bg_visual — the ❯ keeps the text colour rather than
					// the accent — with the description in gray, unbolded, and
					// fuzzy-matched label chars in fuzzy_accent.
					selectedText: (text: string) => {
						const theme = fullTheme();
						const row = text.replace(/^→ /, "❯ ");
						const clipped = truncateToWidth(row, menuRenderState.width, "");
						const columns = clipped.match(/^(❯ )(.+?)(\s{2,}\S.*)?$/);
						const styled = columns
							? theme.fg("text", theme.bold(columns[1] ?? "")) +
								paintMenuLabel(
									theme,
									columns[2] ?? "",
									menuRenderState.query,
									true,
								) +
								theme.fg("muted", columns[3] ?? "")
							: theme.fg("text", theme.bold(clipped));
						const padding = " ".repeat(
							Math.max(0, menuRenderState.width - visibleWidth(clipped)),
						);
						return theme.bg("selectedBg", styled + padding);
					},
				},
			},
			keybindings,
			// grok shows up to MAX_VISIBLE_SUGGESTIONS = 6 dropdown rows.
			{ paddingX: EDITOR_PADDING_X, autocompleteMaxVisible: 6 },
		);
		this.menuRenderState = menuRenderState;
		this.fullTheme = fullTheme;
		this.chrome = chrome;
	}

	override setPaddingX(_padding: number): void {
		super.setPaddingX(EDITOR_PADDING_X);
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

		// grok `render_dropdown_chrome`: the panel shares the prompt's outer
		// pad; borders are bg_highlight rules with the match count in gray one
		// cell in from the right; the body fills with bg_light.
		const menuMargin = " ".repeat(outerMargin);
		const panelWidth = Math.max(1, width - outerMargin * 2);
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

		const query = this.menuRenderState.query;
		// grok fills the panel body with bg_light; rows carry their own bg
		// resets (the selected row ends bg_visual with one), so every reset
		// inside a row falls back to the panel fill rather than the canvas.
		const panelBg = theme.getBgAnsi("customMessageBg");
		const body = rows.map((line) => {
			// grok insets item rows one extra column inside the panel
			// (`dropdown_content_inset` = 1 + hpad); with the editor's own
			// 2-col padding the ❯ gutter starts 3 cells in.
			const clipped = truncateToWidth(` ${line}`, panelWidth, "");
			// Non-selected rows arrive with a plain label (Pi styles only the
			// description); grok paints it text_primary with the matched run
			// in fuzzy_accent.
			const styled = clipped.replace(
				/^(\s*)([^\s\x1b]+)/,
				(_row, pad: string, label: string) =>
					pad + paintMenuLabel(theme, label, query, false),
			);
			const padded =
				styled + " ".repeat(Math.max(0, panelWidth - visibleWidth(clipped)));
			return (
				menuMargin +
				panelBg +
				padded.replaceAll("\x1b[49m", panelBg) +
				"\x1b[49m" +
				menuMargin
			);
		});

		return [
			menuMargin + top + menuMargin,
			...body,
			menuMargin + bottom + menuMargin,
		];
	}

	/**
	 * Spec §3: grok recolours a `/command` token in accent_skill while the
	 * slash menu is open or the token matches a registered command. Returns
	 * the painter for the first row, or undefined when nothing qualifies.
	 */
	private slashHighlighter(theme: Theme): ((body: string) => string) | undefined {
		const text = this.getText();
		if (!text.startsWith("/")) return undefined;
		const token = /^\/\S+/.exec(text)?.[0];
		if (!token) return undefined;
		const internals = this as unknown as {
			isShowingAutocomplete?: () => boolean;
			autocompleteProvider?: { commands?: unknown };
		};
		const open = internals.isShowingAutocomplete?.() === true;
		if (!open && !this.isSlashCommand(token)) return undefined;
		// Escapes (the caret) end the leading plain run, so a mid-token edit
		// colours only the part before the caret — transient, like grok.
		return (body) =>
			body.replace(/^\/[^\s\x1b]*/, (m) =>
				// customMessageLabel is the selected core accent (grok: PURPLE).
				theme.fg("customMessageLabel", m),
			);
	}

	private isSlashCommand(token: string): boolean {
		const name = token.slice(1);
		const provider = (
			this as unknown as { autocompleteProvider?: { commands?: unknown } }
		).autocompleteProvider;
		const commands = provider?.commands;
		if (!Array.isArray(commands)) return false;
		return commands.some((command) => {
			const entry = command as { name?: unknown; value?: unknown };
			return [entry.name, entry.value].some(
				(v) => typeof v === "string" && v.replace(/^\//, "") === name,
			);
		});
	}

	override render(width: number): string[] {
		if (width < 4) return super.render(width);

		const theme = this.fullTheme();
		// Spec §3: prompt_border idle, prompt_border_active while focused.
		const borderKey: ThemeColor = this.focused ? "borderAccent" : "border";
		const paintBorder = (text: string) => theme.fg(borderKey, text);
		this.borderColor = paintBorder;
		// Spec §3: session title and model share the focus-graded caption.
		const caption = (s: string) =>
			hexFg(
				theme,
				this.focused ? CAPTION_FOCUSED_HEX : CAPTION_UNFOCUSED_HEX,
				s,
				"muted",
			);

		const { outerMargin, contentWidth, promptInset } = editorLayout(width);
		// Symmetric 1-cell gaps inside both `│`. The editor wraps at
		// contentWidth - 2*EDITOR_PADDING_X so a resize reflows instead of
		// clipping into the right border or leaving a 2-col hole.
		const baseEditorWidth = editorRenderWidth(
			contentWidth,
			promptInset,
			EDITOR_PADDING_X,
		);
		this.menuRenderState.width = promptWrapWidth(
			contentWidth,
			promptInset,
			EDITOR_PADDING_X,
		);
		// The slash menu filters by the leading token, so it doubles as the
		// fuzzy-match run for dropdown labels (see paintMenuLabel).
		this.menuRenderState.query = /^\/\S*/.exec(this.getText())?.[0] ?? "";
		const lines = super.render(baseEditorWidth);
		const bottom = borderLineIndex(lines);
		if (bottom === undefined) return lines;

		const editorLines = lines.slice(0, bottom + 1);
		const autocompleteLines = lines.slice(bottom + 1);

		const promptIndent = " ".repeat(promptInset);
		const markerWidth = visibleWidth(PROMPT_MARKER);
		// Spec §3: ❯ is plain accent_user — grok never bolds it and never swaps
		// it for a spinner. Unfocused it is gray_dim under the 0.66 content dim.
		const marker = this.focused
			? theme.fg("accent", PROMPT_MARKER)
			: hexFg(theme, DIM_MARKER_HEX, PROMPT_MARKER, "dim");
		const showPlaceholder = this.getText() === "" && !this.focused;
		// Spec §3: unfocused content blends 0.66 toward the canvas. Pi's editor
		// emits plain text plus the inverse-video caret, so stripping escapes
		// and repainting the row is lossless (and hides the caret, like grok).
		const dimBody = (s: string) =>
			hexFg(theme, DIM_TEXT_HEX, stripAnsi(s), "dim");
		const slashPaint = this.focused ? this.slashHighlighter(theme) : undefined;
		for (let index = 1; index < bottom; index++) {
			const line = editorLines[index] ?? "";
			if (index === 1 && line.startsWith(" ".repeat(markerWidth))) {
				let body = line.slice(markerWidth);
				if (showPlaceholder) {
					body = placeholderRow(body, PLACEHOLDER, 0, (s) =>
						hexFg(theme, DIM_PLACEHOLDER_HEX, s, "muted"),
					);
				} else if (!this.focused) {
					body = dimBody(body);
				} else if (slashPaint) {
					body = slashPaint(body);
				}
				editorLines[index] = promptIndent + marker + body;
			} else {
				editorLines[index] =
					promptIndent + (this.focused ? line : dimBody(line));
			}
		}

		// Model • effort sits on the bottom border, right-aligned across the full
		// content span (grok's info rect is the box minus its 2-col pads).
		const info = this.chrome.showModelCaption()
			? infoLine(
					{
						model: this.chrome.model(),
						effort: this.chrome.effort(),
					},
					Math.max(1, contentWidth - 2),
					{
						model: caption,
						separator: (s) =>
							this.focused
								? theme.fg("dim", s)
								: hexFg(theme, SEPARATOR_UNFOCUSED_HEX, s, "dim"),
						flag: (s) =>
							this.focused
								? theme.fg("muted", s)
								: hexFg(theme, FLAG_UNFOCUSED_HEX, s, "muted"),
					},
				)
			: "";
		const cornerConnector = paintBorder("─");
		editorLines[bottom] = captionOnBottomBorder(
			editorLines[bottom] ?? "",
			info,
			contentWidth,
			cornerConnector,
		);

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
				// Spec §3: session title rides the top border, right-aligned, in
				// the same caption style as the model name below.
				const top = titleOnBorder(fitTopBorder(line), this.chrome.title(), caption);
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

function installTurnStatus(
	ctx: ExtensionContext,
	getSettings: () => PiGrokBuildUISettings,
): void {
	ctx.ui.setWidget(
		STATUS_KEY,
		(tui, _theme) => {
			const rerender = () => tui.requestRender();
			requestActivityRender = rerender;
			const timer = setInterval(() => {
				if (activity.active && getSettings().showTurnStatus) rerender();
			}, SPINNER_INTERVAL_MS);

			return {
				render(width: number): string[] {
					if (!getSettings().showTurnStatus || !activity.active || width <= 0)
						return [];
					const now = Date.now();
					const theme = ctx.ui.theme;
					// The status row shares the prompt's outer pad (spec §3).
					const margin = width >= 12 ? CHROME_MARGIN : 0;
					const row = statusRow(
						{
							phase: activity.phase,
							attempt: activity.attempt,
							turnMs: now - activity.turnStartedAt,
							phaseMs: now - activity.phaseStartedAt,
							// Spec §4 / glyphs.rs: ⇣ is the context-token count.
							tokens: contextTokens?.(),
							// Spec §4: grok's `· N queued` hint; Pi has no count.
							queued: ctx.hasPendingMessages(),
							now,
						},
						width - margin * 2,
						{
							spinner: (s) => theme.fg(spinnerColor(activity.phase), s),
							label: (s) => theme.fg("customMessageText", s),
							timer: (s) => theme.fg("muted", s),
							stop: (s) => theme.fg("muted", s),
						},
					);
					// Spec §4: one blank gap row between the status row and the box.
					return row === "" ? [] : [" ".repeat(margin) + row, ""];
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

function installFooter(
	ctx: ExtensionContext,
	getSettings: () => PiGrokBuildUISettings,
): void {
	ctx.ui.setFooter((tui, _theme, footerData) => {
		const unsubscribe = footerData.onBranchChange(() => tui.requestRender());
		return {
			dispose: unsubscribe,
			invalidate() {},
			render(width: number): string[] {
				const settings = getSettings();
				const theme = ctx.ui.theme;
				const branch = footerData.getGitBranch();
				const separator = theme.fg("dim", ` ${CONTEXT_SEPARATOR} `);

				// The footer shares the prompt's outer pad on both sides (spec §3).
				const margin = width >= 12 ? CHROME_MARGIN : 0;
				const available = width - margin * 2;
				// Spec §5: context chip `8.5K / 1.0M`, gradient over usage percent.
				const usage = settings.showContextUsage
					? ctx.getContextUsage()
					: undefined;
				const chip =
					usage && usage.tokens !== null
						? hexFg(
								theme,
								contextGradientHex(
									usage.percent ?? 0,
									resolveAccentPalette(settings).bright,
								),
								`${formatContextTokens(usage.tokens)} / ${formatContextTokens(usage.contextWindow)}`,
							)
						: undefined;
				const row = composeFooterRow(
					settings,
					{
						branch: branch
							? theme.fg("muted", `${BRANCH_ICON} ${branch}`)
							: undefined,
						cwd: theme.fg("dim", formatCwd(ctx.cwd, homedir())),
						context: chip,
					},
					available,
					separator,
				);
				if (row === "") return [];
				// grok keeps one blank row between the prompt box and the bottom
				// chrome (`shortcuts_gap`); mirror it above the footer.
				return ["", " ".repeat(margin) + row];
			},
		};
	});
}

async function openSettingsOverlay(
	ctx: ExtensionContext,
	getSettings: () => PiGrokBuildUISettings,
	setSettings: (settings: PiGrokBuildUISettings) => void,
): Promise<void> {
	await ctx.ui.custom<void>(
		(tui, _theme, _keybindings, done) => {
			let current = getSettings();
			const presetLabels = ACCENT_PRESETS.map(
				(preset) => ACCENT_PRESET_LABELS[preset],
			);
			const accentInput = (
				finish: (selectedValue?: string) => void,
			) => {
				const input = new Input();
				input.focused = true;
				input.handleInput(effectiveAccentHex(current));
				let validationError = "";
				input.onSubmit = (value) => {
					const normalized = normalizeHexColor(value);
					if (!normalized) {
						validationError = "Enter a six-digit color such as #88C0D0";
						tui.requestRender();
						return;
					}
					finish(normalized);
				};
				input.onEscape = () => finish(undefined);
				return {
					render(width: number) {
						const theme = ctx.ui.theme;
						const candidate = normalizeHexColor(input.getValue());
						const preview = candidate
							? `${hexFg(theme, candidate, "●")} ${candidate}  ❯ Heading ◆`
							: theme.fg("error", "● Invalid hex color");
						return [
							truncateToWidth(
								theme.fg("accent", theme.bold(" Custom Accent")),
								width,
							),
							"",
							...input.render(width),
							"",
							truncateToWidth(` ${preview}`, width),
							...(validationError
								? [truncateToWidth(theme.fg("error", ` ${validationError}`), width)]
								: []),
							truncateToWidth(
								theme.fg("dim", " Enter apply · Esc cancel"),
								width,
							),
						];
					},
					handleInput(data: string) {
						validationError = "";
						input.handleInput(data);
						tui.requestRender();
					},
					invalidate() {},
				};
			};

			const items: SettingItem[] = [
				{
					id: "accent-preset",
					label: "Color preset",
					description:
						"Recolor PiGrokBuild UI chrome while preserving the Oscura canvas, syntax, and semantic status colors.",
					currentValue: ACCENT_PRESET_LABELS[current.accentPreset],
					values: presetLabels,
				},
				{
					id: "accent-color",
					label: "Accent color",
					description:
						"Enter a custom #RRGGBB color. Core, dim, border, and highlight shades are derived automatically.",
					currentValue: `● ${effectiveAccentHex(current)}`,
					submenu: (_currentValue, finish) => accentInput(finish),
				},
				...VISIBILITY_SETTING_KEYS.map((key) => ({
					id: key,
					label: VISIBILITY_ITEMS[key].label,
					description: VISIBILITY_ITEMS[key].description,
					currentValue: current[key] ? "shown" : "hidden",
					values: ["shown", "hidden"],
				})),
				{
					id: "preset-default",
					label: "Reset visibility",
					description:
						"Show every configurable PiGrokBuild UI region without changing the accent.",
					currentValue: "apply",
					values: ["apply"],
				},
				{
					id: "preset-minimal",
					label: "Use Minimal visibility",
					description:
						"Hide configurable captions, footer fields, and turn status without changing the accent.",
					currentValue: "apply",
					values: ["apply"],
				},
			];

			const container = new Container();
			container.addChild(
				new DynamicBorder((text: string) =>
					ctx.ui.theme.fg("borderAccent", text),
				),
			);
			container.addChild({
				render(width: number) {
					const theme = ctx.ui.theme;
					return [
						truncateToWidth(
							theme.fg("accent", theme.bold(" PiGrokBuild UI Settings")),
							width,
						),
						truncateToWidth(
							theme.fg("dim", " Global · changes apply immediately"),
							width,
						),
					];
				},
				invalidate() {},
			});

			const baseListTheme = getSettingsListTheme();
			const listTheme = {
				...baseListTheme,
				value: (text: string, selected: boolean) => {
					const swatch = /^● (#[0-9A-F]{6})$/.exec(text);
					return swatch?.[1]
						? `${ctx.ui.theme.fg("accent", "●")} ${baseListTheme.value(swatch[1], selected)}`
						: baseListTheme.value(text, selected);
				},
			};
			let settingsList: SettingsList;
			const refreshValues = () => {
				listTheme.cursor = ctx.ui.theme.fg("accent", "→ ");
				settingsList.updateValue(
					"accent-preset",
					ACCENT_PRESET_LABELS[current.accentPreset],
				);
				settingsList.updateValue(
					"accent-color",
					`● ${effectiveAccentHex(current)}`,
				);
				for (const key of VISIBILITY_SETTING_KEYS) {
					settingsList.updateValue(key, current[key] ? "shown" : "hidden");
				}
			};
			const commit = (next: PiGrokBuildUISettings) => {
				try {
					setSettings(next);
					current = next;
				} catch (error) {
					ctx.ui.notify(
						`Could not save PiGrokBuild UI settings: ${error instanceof Error ? error.message : String(error)}`,
						"error",
					);
				}
				refreshValues();
				tui.requestRender();
			};

			settingsList = new SettingsList(
				items,
				items.length,
				listTheme,
				(id, newValue) => {
					if (id === "accent-preset") {
						const preset = accentPresetFromLabel(newValue);
						if (preset) commit(withAccentPreset(current, preset));
						return;
					}
					if (id === "accent-color") {
						const next = withCustomAccent(current, newValue);
						if (next) commit(next);
						return;
					}
					if (id === "preset-default") {
						commit(applyVisibilityPreset("default", current));
						return;
					}
					if (id === "preset-minimal") {
						commit(applyVisibilityPreset("minimal", current));
						return;
					}
					if (VISIBILITY_SETTING_KEYS.includes(id as VisibilitySettingKey)) {
						commit(
							withVisibilitySetting(
								current,
								id as VisibilitySettingKey,
								newValue === "shown",
							),
						);
					}
				},
				() => done(undefined),
			);
			container.addChild(settingsList);
			container.addChild(
				new DynamicBorder((text: string) =>
					ctx.ui.theme.fg("borderAccent", text),
				),
			);

			return {
				render: (width: number) => container.render(width),
				invalidate: () => container.invalidate(),
				handleInput: (data: string) => {
					settingsList.handleInput(data);
					tui.requestRender();
				},
			};
		},
		{
			overlay: true,
			overlayOptions: {
				anchor: "center",
				width: 68,
				minWidth: 36,
				maxHeight: "90%",
				margin: 1,
			},
		},
	);
}

export default function piGrokBuildUI(pi: ExtensionAPI) {
	let activeUi: ExtensionContext["ui"] | undefined;
	let settings = loadPiGrokBuildUISettings(
		SETTINGS_PATH,
		LEGACY_SETTINGS_PATH,
	);

	const applyTheme = (ctx: ExtensionContext) => {
		try {
			const palette = resolveAccentPalette(settings);
			const selected = ctx.ui.setTheme(createAccentTheme(settings, ctx.ui.theme));
			if (!selected.success) throw new Error(selected.error ?? THEME_NAME);
			activeTheme = ctx.ui.theme;
			enableTerminalCanvas(palette.bright);
			ctx.ui.setWorkingIndicator({
				frames: SPINNER_FRAMES.map((frame) =>
					ctx.ui.theme.fg("customMessageLabel", frame),
				),
				intervalMs: SPINNER_INTERVAL_MS,
			});
		} catch (error) {
			ctx.ui.notify(
				`Could not apply PiGrokBuild UI accent: ${error instanceof Error ? error.message : String(error)}`,
				"warning",
			);
		}
	};

	const configureAppearance = async (
		_args: string,
		ctx: ExtensionContext,
	) => {
		if (ctx.mode !== "tui") {
			ctx.ui.notify("/pi-grok-build-ui requires TUI mode", "error");
			return;
		}
		await openSettingsOverlay(ctx, () => settings, (next) => {
			savePiGrokBuildUISettings(SETTINGS_PATH, next);
			settings = next;
			applyTheme(ctx);
		});
	};

	pi.registerCommand("pi-grok-build-ui", {
		description: "Configure the PiGrokBuild UI",
		handler: configureAppearance,
	});
	pi.registerCommand("oscura", {
		description: "Alias for /pi-grok-build-ui",
		handler: configureAppearance,
	});

	// Pi exposes one footer area. Keep pi-powerbar installed, but suppress its
	// extra widget while this skin owns the terminal chrome.
	pi.events.on("powerbar:update", () => {
		if (!keepPowerbar()) {
			activeUi?.setWidget("powerbar", undefined);
		}
	});

	pi.on("resources_discover", (_event, ctx) => {
		if (ctx.mode === "tui") {
			setTimeout(() => {
				if (activeUi !== ctx.ui) return;
				applyTheme(ctx);
			}, 0);
		}
		return { themePaths: [THEME_PATH] };
	});

	pi.on("session_start", (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		activeUi = ctx.ui;
		contextTokens = () => ctx.getContextUsage()?.tokens ?? undefined;
		applyTheme(ctx);
		if (!keepPowerbar()) {
			ctx.ui.setWidget("powerbar", undefined);
		}

		ctx.ui.setTitle(`pi · ${basename(ctx.cwd) || ctx.cwd}`);
		ctx.ui.setHeader(() => ({ render: () => [], invalidate() {} }));
		ctx.ui.setWorkingVisible(false);
		// Spec §6: grok's collapsed thinking label is "Thought"; ◆ is the tool bullet.
		ctx.ui.setHiddenThinkingLabel("Thought");

		installTurnStatus(ctx, () => settings);
		installFooter(ctx, () => settings);

		ctx.ui.setEditorComponent(
			(tui, editorTheme, keybindings) =>
				new PiGrokBuildUIEditor(
					tui,
					editorTheme,
					keybindings,
					() => ctx.ui.theme,
					{
						title: () =>
							resolveSessionTitle(
								settings,
								pi.getSessionName(),
								basename(ctx.cwd),
							),
						showModelCaption: () => settings.showModelCaption,
						// Spec §3: grok's info line shows the model id, not its display name.
						model: () => ctx.model?.id || ctx.model?.name || "no model",
						effort: () => pi.getThinkingLevel(),
					},
				),
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
