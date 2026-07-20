import { homedir } from "node:os";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CustomEditor,
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
const STATUS_KEY = "grok-build-turn-status";
const TERMINAL_CANVAS_COLOR = "#030304";
const SET_TERMINAL_CANVAS = `\x1b]11;${TERMINAL_CANVAS_COLOR}\x07`;
const RESET_TERMINAL_CANVAS = "\x1b]111\x07";
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

type ActivityKind = "thinking" | "responding" | "tool" | "waiting";

type ActivityState = {
  active: boolean;
  kind: ActivityKind;
  label: string;
  turnStartedAt: number;
  phaseStartedAt: number;
};

const activity: ActivityState = {
  active: false,
  kind: "waiting",
  label: "Waiting…",
  turnStartedAt: 0,
  phaseStartedAt: 0,
};

let requestStatusRender: (() => void) | undefined;
let terminalCanvasActive = false;
let resetTerminalCanvasOnExit: (() => void) | undefined;

function enableTerminalCanvas(): void {
  if (
    terminalCanvasActive ||
    !process.stdout.isTTY ||
    process.env.PI_GROK_TERMINAL_CANVAS === "0"
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

function alignSides(left: string, right: string, width: number): string {
  if (width <= 0) return "";
  const leftWidth = visibleWidth(left);
  const rightWidth = visibleWidth(right);
  if (leftWidth + rightWidth + 1 <= width) {
    return left + " ".repeat(width - leftWidth - rightWidth) + right;
  }
  return truncateToWidth(left, width, "…");
}

function setActivity(kind: ActivityKind, label: string, resetPhase = true): void {
  const now = Date.now();
  activity.active = true;
  activity.kind = kind;
  activity.label = label;
  if (!activity.turnStartedAt) activity.turnStartedAt = now;
  if (resetPhase) activity.phaseStartedAt = now;
  requestStatusRender?.();
}

function stopActivity(): void {
  activity.active = false;
  activity.turnStartedAt = 0;
  activity.phaseStartedAt = 0;
  requestStatusRender?.();
}

function firstLine(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const line = value.trim().split(/\r?\n/, 1)[0]?.trim();
  return line || undefined;
}

function toolActivity(toolName: string, args: Record<string, unknown> | undefined): string {
  const input = args ?? {};
  switch (toolName) {
    case "bash":
      return `Run ${firstLine(input.command) ?? "command"}`;
    case "read":
      return `Read ${firstLine(input.path) ?? "file"}`;
    case "write":
      return `Write ${firstLine(input.path) ?? "file"}`;
    case "edit":
      return `Edit ${firstLine(input.path) ?? "file"}`;
    case "grep":
      return `Search ${firstLine(input.pattern) ?? "project"}`;
    case "find":
      return `Find ${firstLine(input.pattern) ?? "files"}`;
    case "ls":
      return `List ${firstLine(input.path) ?? "."}`;
    default:
      return `Run ${toolName}`;
  }
}

function borderLineIndex(lines: string[]): number | undefined {
  for (let i = lines.length - 1; i >= 2; i--) {
    const plain = stripAnsi(lines[i] ?? "");
    if (/^─+(?: [↑↓] \d+ more )?─*$/.test(plain)) return i;
  }
  return undefined;
}

class GrokEditor extends CustomEditor {
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

    const outerMargin = width >= 12 ? 2 : 0;
    const contentWidth = Math.max(1, width - outerMargin * 2 - 2);
    this.menuRenderState.width = Math.max(1, contentWidth - 4);
    const lines = super.render(contentWidth);
    const theme = this.fullTheme();
    const bottom = borderLineIndex(lines);
    if (bottom === undefined) return lines;

    const editorLines = lines.slice(0, bottom + 1);
    const autocompleteLines = lines.slice(bottom + 1);

    if (editorLines[1]?.startsWith("  ")) {
      editorLines[1] = theme.fg("accent", theme.bold("❯ ")) + editorLines[1].slice(2);
    }

    const rawMetadata = ` ${this.metadataLabel()} `;
    const metadata = truncateToWidth(
      rawMetadata,
      Math.max(1, Math.floor(contentWidth * 0.55)),
      "…",
    );
    const borderWidth = Math.max(0, contentWidth - visibleWidth(metadata));
    editorLines[bottom] =
      truncateToWidth(editorLines[bottom] ?? "", borderWidth, "") +
      theme.fg("dim", metadata);

    const editorBottom = editorLines.length - 1;
    const margin = " ".repeat(outerMargin);
    const side = this.borderColor("│");
    const fit = (line: string) => {
      const clipped = truncateToWidth(line, contentWidth, "");
      return clipped + " ".repeat(Math.max(0, contentWidth - visibleWidth(clipped)));
    };
    const box = editorLines.map((line, index) => {
      if (index === 0) {
        return margin + this.borderColor("┌") + fit(line) + this.borderColor("┐") + margin;
      }
      if (index < editorBottom) {
        return margin + side + fit(line) + side + margin;
      }
      return margin + this.borderColor("└") + fit(line) + this.borderColor("┘") + margin;
    });

    const menu = this.renderAutocompleteMenu(autocompleteLines, width, outerMargin, theme);
    return [...menu, ...box];
  }
}

function installTurnStatus(ctx: ExtensionContext): void {
  ctx.ui.setWorkingVisible(false);
  ctx.ui.setWidget(
    STATUS_KEY,
    (tui, theme) => {
      const rerender = () => tui.requestRender();
      requestStatusRender = rerender;
      const timer = setInterval(() => {
        if (activity.active) rerender();
      }, 120);

      return {
        render(width: number): string[] {
          if (!activity.active || width <= 0) return [];
          const now = Date.now();
          const frame = SPINNER_FRAMES[Math.floor(now / 120) % SPINNER_FRAMES.length] ?? "⠋";
          const color = activity.kind === "tool" ? "success" : activity.kind === "responding" ? "text" : "muted";
          const left =
            theme.fg(color, `${frame} ${activity.label}`) +
            theme.fg("dim", ` ${formatElapsed(now - activity.phaseStartedAt)}`);
          const right = theme.fg(
            "dim",
            `${formatElapsed(now - activity.turnStartedAt)}  Esc:stop`,
          );
          return [alignSides(left, right, width)];
        },
        invalidate() {},
        dispose() {
          clearInterval(timer);
          if (requestStatusRender === rerender) requestStatusRender = undefined;
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

        return [truncateToWidth(theme.fg("dim", left), width, "…")];
      },
    };
  });
}

export default function grokBuildSkin(pi: ExtensionAPI) {
  let activeUi: ExtensionContext["ui"] | undefined;

  // Pi exposes one footer area. Keep pi-powerbar installed, but suppress its
  // extra widget while this skin owns the terminal chrome.
  pi.events.on("powerbar:update", () => {
    if (process.env.PI_GROK_KEEP_POWERBAR !== "1") {
      activeUi?.setWidget("powerbar", undefined);
    }
  });

  pi.on("resources_discover", (_event, ctx) => {
    if (ctx.mode === "tui") {
      setTimeout(() => {
        if (activeUi !== ctx.ui) return;
        const grokTheme = ctx.ui.getTheme(THEME_NAME);
        const selected = grokTheme
          ? ctx.ui.setTheme(grokTheme)
          : { success: false, error: `Theme not found after discovery: ${THEME_NAME}` };
        if (!selected.success) {
          ctx.ui.notify(`Grok skin theme unavailable: ${selected.error ?? THEME_NAME}`, "warning");
        }
      }, 0);
    }
    return { themePaths: [THEME_PATH] };
  });

  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    activeUi = ctx.ui;
    enableTerminalCanvas();
    if (process.env.PI_GROK_KEEP_POWERBAR !== "1") {
      ctx.ui.setWidget("powerbar", undefined);
    }

    ctx.ui.setTitle(`pi · ${basename(ctx.cwd) || ctx.cwd}`);
    ctx.ui.setHeader(() => ({ render: () => [], invalidate() {} }));
    ctx.ui.setHiddenThinkingLabel("◆ Thought");
    ctx.ui.setWorkingIndicator({
      frames: SPINNER_FRAMES.map((frame) => ctx.ui.theme.fg("customMessageLabel", frame)),
      intervalMs: 120,
    });

    installTurnStatus(ctx);
    installFooter(ctx);

    ctx.ui.setEditorComponent((tui, editorTheme, keybindings) =>
      new GrokEditor(
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

  pi.on("agent_start", () => {
    const now = Date.now();
    activity.turnStartedAt = now;
    activity.phaseStartedAt = now;
    setActivity("thinking", "Thinking…", false);
  });

  pi.on("turn_start", () => setActivity("waiting", "Waiting for response…"));

  pi.on("message_update", (event) => {
    switch (event.assistantMessageEvent.type) {
      case "thinking_start":
      case "thinking_delta":
        setActivity("thinking", "Thinking…");
        break;
      case "text_start":
      case "text_delta":
        setActivity("responding", "Responding…");
        break;
      case "toolcall_start":
      case "toolcall_delta":
        setActivity("waiting", "Preparing tool…");
        break;
    }
  });

  pi.on("tool_execution_start", (event) => {
    setActivity("tool", toolActivity(event.toolName, event.args));
  });

  pi.on("tool_execution_end", () => {
    setActivity("waiting", "Waiting for response…");
  });

  pi.on("agent_end", () => setActivity("waiting", "Finishing…"));
  pi.on("agent_settled", stopActivity);
  pi.on("session_shutdown", () => {
    activeUi = undefined;
    disableTerminalCanvas();
    stopActivity();
  });
}
