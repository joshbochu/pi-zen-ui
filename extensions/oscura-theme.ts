import { homedir } from "node:os";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AssistantMessageComponent,
  CustomEditor,
  UserMessageComponent,
  type ExtensionAPI,
  type ExtensionContext,
  type KeybindingsManager,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import {
  truncateToWidth,
  visibleWidth,
  type EditorTheme,
  type TUI,
} from "@earendil-works/pi-tui";

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
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/**
 * Pi only exposes outputPad 0|1 via settings. Pin user/assistant message padding
 * so body text lines up with the tip of ❯ in the composer (TEXT_ALIGN_PAD).
 */
function pinMessageTextAlign(Component: { prototype: object }): void {
  const proto = Component.prototype as {
    __oscuraTextAlignPad?: boolean;
    setOutputPad?: (padding: number) => void;
    updateContent?: (this: { outputPad: number }, ...args: unknown[]) => unknown;
    rebuild?: (this: { outputPad: number }, ...args: unknown[]) => unknown;
  };
  if (proto.__oscuraTextAlignPad) return;
  proto.__oscuraTextAlignPad = true;

  if (typeof proto.setOutputPad === "function") {
    const original = proto.setOutputPad;
    proto.setOutputPad = function (this: { outputPad: number }, _padding: number) {
      return original.call(this, TEXT_ALIGN_PAD);
    };
  }
  if (typeof proto.updateContent === "function") {
    const original = proto.updateContent;
    proto.updateContent = function (this: { outputPad: number }, ...args: unknown[]) {
      this.outputPad = TEXT_ALIGN_PAD;
      return original.apply(this, args);
    };
  }
  if (typeof proto.rebuild === "function") {
    const original = proto.rebuild;
    proto.rebuild = function (this: { outputPad: number }, ...args: unknown[]) {
      this.outputPad = TEXT_ALIGN_PAD;
      return original.apply(this, args);
    };
  }
}

pinMessageTextAlign(AssistantMessageComponent);
pinMessageTextAlign(UserMessageComponent);

let activityActive = false;
let activityStartedAt = 0;
let requestActivityRender: (() => void) | undefined;
let terminalCanvasActive = false;
let resetTerminalCanvasOnExit: (() => void) | undefined;

function enableTerminalCanvas(): void {
  if (
    terminalCanvasActive ||
    !process.stdout.isTTY ||
    process.env.PI_OSCURA_TERMINAL_CANVAS === "0"
  ) {
    return;
  }

  process.stdout.write(SET_TERMINAL_CANVAS);
  terminalCanvasActive = true;
  resetTerminalCanvasOnExit = () => {
    if (!terminalCanvasActive) return;
    process.stdout.write(RESET_TERMINAL_CANVAS);
    terminalCanvasActive = false;
  };
  process.once("exit", resetTerminalCanvasOnExit);
}

function disableTerminalCanvas(): void {
  if (terminalCanvasActive) {
    process.stdout.write(RESET_TERMINAL_CANVAS);
    terminalCanvasActive = false;
  }
  if (resetTerminalCanvasOnExit) {
    process.off("exit", resetTerminalCanvasOnExit);
    resetTerminalCanvasOnExit = undefined;
  }
}

function stripAnsi(value: string): string {
  return value
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b_[\s\S]*?\x1b\\/g, "");
}

function formatElapsed(ms: number): string {
  const seconds = Math.max(0, ms) / 1_000;
  if (seconds < 10) return `${seconds.toFixed(1)}s`;
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m${Math.floor(seconds % 60)}s`;
}

function formatCwd(cwd: string): string {
  const home = resolve(homedir());
  const absolute = resolve(cwd);
  const fromHome = relative(home, absolute);
  const insideHome =
    fromHome === "" ||
    (fromHome !== ".." && !fromHome.startsWith(`..${sep}`) && !isAbsolute(fromHome));
  if (!insideHome) return cwd;
  return fromHome === "" ? "~" : `~${sep}${fromHome}`;
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

function setActivity(active: boolean): void {
  if (active && !activityActive) activityStartedAt = Date.now();
  activityActive = active;
  if (!active) activityStartedAt = 0;
  requestActivityRender?.();
}

function borderLineIndex(lines: string[]): number | undefined {
  for (let i = lines.length - 1; i >= 2; i--) {
    const plain = stripAnsi(lines[i] ?? "");
    if (/^─+(?: [↑↓] \d+ more )?─*$/.test(plain)) return i;
  }
  return undefined;
}

class OscuraEditor extends CustomEditor {
  private readonly menuRenderState: { width: number };

  constructor(
    tui: TUI,
    editorTheme: EditorTheme,
    keybindings: KeybindingsManager,
    private readonly fullTheme: () => Theme,
    private readonly metadataLabel: () => string,
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
    const rows = lines.filter((line) => !/^\s*\(\d+\/\d+\)\s*$/.test(stripAnsi(line)));
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
      const padded = clipped + " ".repeat(Math.max(0, panelWidth - visibleWidth(clipped)));
      return menuMargin + theme.bg("customMessageBg", padded) + menuMargin;
    });

    return [menuMargin + top + menuMargin, ...body, menuMargin + bottom + menuMargin];
  }

  override render(width: number): string[] {
    if (width < 4) return super.render(width);

    const { outerMargin, contentWidth, promptInset } = editorLayout(width);
    const baseEditorWidth = Math.max(1, contentWidth - promptInset);
    this.menuRenderState.width = Math.max(1, baseEditorWidth - 4);
    const lines = super.render(baseEditorWidth);
    const theme = this.fullTheme();
    const bottom = borderLineIndex(lines);
    if (bottom === undefined) return lines;

    const editorLines = lines.slice(0, bottom + 1);
    const autocompleteLines = lines.slice(bottom + 1);

    const promptIndent = " ".repeat(promptInset);
    const frame = SPINNER_FRAMES[Math.floor(Date.now() / 120) % SPINNER_FRAMES.length] ?? "⠋";
    const promptMarker = activityActive ? `${frame} ` : PROMPT_MARKER;
    const markerWidth = visibleWidth(PROMPT_MARKER);
    for (let index = 1; index < bottom; index++) {
      const line = editorLines[index] ?? "";
      if (index === 1 && line.startsWith(" ".repeat(markerWidth))) {
        editorLines[index] =
          promptIndent +
          theme.fg("accent", theme.bold(promptMarker)) +
          line.slice(markerWidth);
      } else {
        editorLines[index] = promptIndent + line;
      }
    }

    const rawMetadata = ` ${this.metadataLabel()} `;
    const metadata = truncateToWidth(
      rawMetadata,
      Math.max(1, Math.floor(contentWidth * 0.55)),
      "…",
    );
    const cornerConnector = this.borderColor("─");
    const borderWidth = Math.max(
      0,
      contentWidth - visibleWidth(metadata) - visibleWidth(cornerConnector),
    );
    editorLines[bottom] =
      truncateToWidth(editorLines[bottom] ?? "", borderWidth, "") +
      theme.fg("dim", metadata) +
      cornerConnector;

    const editorBottom = editorLines.length - 1;
    const margin = " ".repeat(outerMargin);
    const side = this.borderColor("│");
    const fit = (line: string) => {
      const clipped = truncateToWidth(line, contentWidth, "");
      return clipped + " ".repeat(Math.max(0, contentWidth - visibleWidth(clipped)));
    };
    const fitTopBorder = (line: string) => {
      const clipped = truncateToWidth(line, contentWidth, "");
      return (
        clipped +
        this.borderColor("─".repeat(Math.max(0, contentWidth - visibleWidth(clipped))))
      );
    };
    const box = editorLines.map((line, index) => {
      if (index === 0) {
        return (
          margin +
          this.borderColor("╭") +
          fitTopBorder(line) +
          this.borderColor("╮") +
          margin
        );
      }
      if (index < editorBottom) {
        return margin + side + fit(line) + side + margin;
      }
      return margin + this.borderColor("╰") + fit(line) + this.borderColor("╯") + margin;
    });

    const menu = this.renderAutocompleteMenu(autocompleteLines, width, outerMargin, theme);
    return [...menu, ...box];
  }
}

function installCompactTurnStatus(ctx: ExtensionContext): void {
  ctx.ui.setWidget(
    STATUS_KEY,
    (tui, theme) => {
      const rerender = () => tui.requestRender();
      requestActivityRender = rerender;
      const timer = setInterval(() => {
        if (activityActive) rerender();
      }, 120);

      return {
        render(width: number): string[] {
          if (!activityActive || width <= 0) return [];
          const fullText = `${formatElapsed(Date.now() - activityStartedAt)}  Esc:stop`;
          const text = visibleWidth(fullText) <= width
            ? fullText
            : truncateToWidth("Esc:stop", width, "");
          return [" ".repeat(Math.max(0, width - visibleWidth(text))) + theme.fg("dim", text)];
        },
        invalidate() {},
        dispose() {
          clearInterval(timer);
          if (requestActivityRender === rerender) requestActivityRender = undefined;
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
        let left = formatCwd(ctx.cwd);
        const branch = footerData.getGitBranch();
        if (branch) left += ` (${branch})`;

        const margin = width >= CHROME_MARGIN + 1 ? CHROME_MARGIN : 0;
        return [
          " ".repeat(margin) +
            truncateToWidth(theme.fg("dim", left), width - margin, "…"),
        ];
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
          : { success: false, error: `Theme not found after discovery: ${THEME_NAME}` };
        if (!selected.success) {
          ctx.ui.notify(`Oscura theme unavailable: ${selected.error ?? THEME_NAME}`, "warning");
        }
      }, 0);
    }
    return { themePaths: [THEME_PATH] };
  });

  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    activeUi = ctx.ui;
    enableTerminalCanvas();
    if (process.env.PI_OSCURA_KEEP_POWERBAR !== "1") {
      ctx.ui.setWidget("powerbar", undefined);
    }

    ctx.ui.setTitle(`pi · ${basename(ctx.cwd) || ctx.cwd}`);
    ctx.ui.setHeader(() => ({ render: () => [], invalidate() {} }));
    ctx.ui.setWorkingVisible(false);
    ctx.ui.setHiddenThinkingLabel("◆ Thought");
    ctx.ui.setWorkingIndicator({
      frames: SPINNER_FRAMES.map((frame) => ctx.ui.theme.fg("customMessageLabel", frame)),
      intervalMs: 120,
    });

    installCompactTurnStatus(ctx);
    installFooter(ctx);

    ctx.ui.setEditorComponent((tui, editorTheme, keybindings) =>
      new OscuraEditor(
        tui,
        editorTheme,
        keybindings,
        () => ctx.ui.theme,
        () => {
          const model = ctx.model?.name || ctx.model?.id || "no model";
          const percent = ctx.getContextUsage()?.percent;
          const context = typeof percent === "number" && Number.isFinite(percent)
            ? `${Math.round(percent)}%`
            : "?%";
          return `${model} · ${pi.getThinkingLevel()} · ${context}`;
        },
      ),
    );
  });

  pi.on("agent_start", () => setActivity(true));
  pi.on("agent_settled", () => setActivity(false));
  pi.on("session_shutdown", () => {
    activeUi = undefined;
    disableTerminalCanvas();
    setActivity(false);
  });
}
