# PiGrokBuild UI fidelity spec

Ground truth extracted from the upstream Grok Build repository at
`github.com/xai-org/grok-build` (Rust, `crates/codegen/`), last verified against
`SOURCE_REV 2a28b4a`. The `grok` binary ships this exact theme itself as
`ThemeKind::OscuraMidnight`, so nothing here is guesswork—every value below is a
literal from the reference implementation.

PiGrokBuild UI uses these values unchanged by default. Its optional
`/pi-grok-build-ui` accent presets deliberately replace only the purple chrome
ramp and purple-tinted highlights; the canvas, syntax palette, and semantic
status colors remain the reference values documented here.

Key source files:

| what | reference path |
| --- | --- |
| oscura palette | `xai-grok-pager-render/src/theme/oscura.rs` |
| `Theme` struct | `xai-grok-pager-render/src/theme/tokyonight.rs` |
| syntax theme | `xai-grok-pager-render/assets/grok-night.tmTheme` |
| glyphs | `xai-grok-pager-render/src/glyphs.rs` |
| prompt box | `xai-grok-pager/src/views/prompt_widget/mod.rs` |
| turn status | `xai-grok-pager/src/views/turn_status.rs` |
| context chip | `xai-grok-pager/src/views/context_bar.rs` |
| scrollback | `xai-grok-pager/src/scrollback/wrappers/entry_renderer.rs` |
| markdown | `xai-grok-markdown/src/parse.rs`, `xai-grok-pager-render/src/theme/md_style.rs` |

## 1. Palette (`oscura.rs`)

Chrome vars, byte-exact:

```
BASE #030304  SURFACE #040507  ELEVATED #0F1216  PANEL #040406
TEXT #E4E4E4  TEXT_DIM #BEBEBE  MUTED #81868F  SUBTLE #5E646C
GOLD #EBD96E  RED #DC5A64  TEAL #50B48C  AMBER #F1BD00
PURPLE #9B7ECE  PURPLE_DIM #6E5A9A  PURPLE_BRIGHT #C4A7E7  CYAN #7DCFDF
HIGHLIGHT_LOW #12101C  HIGHLIGHT_MED #242034  HIGHLIGHT_HIGH #343048
```

Semantic mapping that matters for a Pi theme:

| grok field | value | Pi key |
| --- | --- | --- |
| `bg_base` | BASE | `export.pageBg` |
| `bg_light` | ELEVATED | `userMessageBg`, autocomplete row bg |
| `bg_dark` | SURFACE | `toolPendingBg`, `toolSuccessBg`, `md_code_bg` |
| `bg_highlight` | ELEVATED | autocomplete panel rules |
| `bg_visual` | HIGHLIGHT_MED | `selectedBg` |
| `accent_user` | PURPLE_BRIGHT | `accent`, OSC 12 cursor |
| `accent_assistant` | PURPLE | `customMessageLabel` |
| `accent_thinking` | MUTED | `thinkingText` |
| `accent_tool` | SUBTLE | tool rail idle |
| `accent_success` | TEAL | `success` |
| `accent_error` | RED | `error` |
| `accent_running` | PURPLE_DIM | tool rail while running |
| `command` / `warning` | GOLD | `bashMode`, `warning` |
| `path` | AMBER | — |
| `gray` | MUTED | `muted`, `toolTitle` (collapsed) |
| `gray_dim` | SUBTLE | `dim` |
| `gray_bright` | TEXT_DIM | tool title when expanded |
| `prompt_border` | HIGHLIGHT_MED | `border` (idle) |
| `prompt_border_active` | HIGHLIGHT_HIGH | `borderAccent` (focused) |
| `md_muted` | MUTED | `mdQuote`, `mdListBullet`, `mdHr` |
| `md_text` | TEXT | `mdCodeBlock` |
| `md_code` / `link_fg` | CYAN | `mdCode`, `mdLink` |
| `diff_delete_bg` | `#2D0F19` | `toolErrorBg` |
| `diff_insert_bg` | `#0A231E` | (no Pi slot) |

Markdown heading ramp (Pi has one `mdHeading` key, so H2 is the representative pick):

```
h1 TEXT bold | h2 PURPLE_BRIGHT bold | h3 PURPLE bold
h4 TEAL bold+italic | h5 GOLD bold | h6 CYAN bold
```

## 2. Syntax colors — NOT from the chrome palette

`syntax.rs:146` loads `grok-night.tmTheme` for OscuraMidnight. That theme is
TokyoNight-derived; deriving syntax colors from the purple chrome palette is wrong.

| Pi key | tmTheme scope | value |
| --- | --- | --- |
| `syntaxComment` | `comment` | `#51597d` |
| `syntaxKeyword` | `keyword` | `#bb9af7` |
| `syntaxFunction` | `entity.name.function` | `#7aa2f7` |
| `syntaxVariable` | `variable` | `#c8c8c8` |
| `syntaxString` | `string` | `#9ece6a` |
| `syntaxNumber` | `constant.numeric` | `#ff9e64` |
| `syntaxType` | `support.class`, `support.type` | `#0db9d7` |
| `syntaxOperator` | `keyword.operator` | `#89ddff` |
| `syntaxPunctuation` | `meta.block`, `meta.brace` | `#9abdf5` |

## 3. Prompt box (`prompt_widget/mod.rs`)

- The whole UI sits inside an outer pad: 2 columns each side, 1 row top/bottom
  (`LayoutConfig`: `outer_hpad_left/right = 2`, `outer_vpad = 1`). The prompt box,
  the turn-status row and the top status bar all share the horizontal pad.
- Rounded 4-side box: `╭` U+256D `─` U+2500 `╮` U+256E / `│` U+2502 / `╰` U+2570 `╯` U+256F.
- Border color `prompt_border` idle, `prompt_border_active` when focused (`mod.rs:2902`).
- Content inset: `chrome_pad_left = 2` measured **from the border cell**, so exactly
  one blank cell separates `│` from the prefix. Prefix `"❯ "` U+276F + space, always
  2 cols (`glyphs.rs:23`, `PROMPT_ARROW_WIDTH = 2`), color `accent_user` focused /
  `gray_dim` unfocused, **no bold** (`mod.rs:3008`). Never replaced by a spinner.
- Prefix overrides: `"! "` `command`, `"~ "` `accent_feedback`, `"# "` `accent_remember`,
  `"? "` `accent_user`.
- Placeholder `"Build anything"` in `gray`, shown only when the buffer is empty
  **and** the editor is unfocused (`mod.rs:3183`).
- **Unfocused dimming** (`mod.rs:3250`): everything between the side borders is
  blended 0.66 toward the canvas (`blend_area`, `fg' = bg + (fg-bg)*0.66`), on top
  of the already-dim prefix and placeholder colours. Text `#E4E4E4` reads `#989898`,
  the `❯` `#3F4349`, the placeholder `#565960`. The caret is hidden while unfocused.
- **Chrome captions** (`chrome_caption_style`, `mod.rs:3351`): the session title and
  the model name share one style — `text_secondary` blended toward the canvas at
  0.6 alpha focused (`#737374`) / 0.4 unfocused (`#4E4E4E`).
- Top border carries the session title: `" {title} "`, right-aligned, leaving 2 `─`
  before `╮`; the padded label may take up to `box width - 6` and is skipped
  entirely when that budget is under 6 (`mod.rs:2977`).
- A recognised `/command` token is recoloured in `accent_skill` (PURPLE) while the
  slash menu is open or the command is registered (`mod.rs:3051`); expected-args
  ghost text renders in `gray` (not portable — Pi owns completion internals).
- Info line sits **on** the bottom border row, right-aligned inside the box's
  content span (its trailing pad space lands 2 cells before `╯`, `mod.rs:3363`):
  `" " + model + (" · " + flag)* + " "`.
  - grok's model text is `"{model_id} ({reasoning_effort})"`; PiGrokBuild UI
    intentionally renders `"{model_id} • {reasoning_effort}"` with U+2022 instead.
  - separator `" · "` U+00B7 in `gray_dim` focused, blended 0.6 toward the canvas
    unfocused; flags in `gray` focused, blended 0.5 unfocused; `plan` in
    `accent_plan`, `auto` in `accent_system` (no Pi state maps to these).
  - grok can prepend a **credit-balance** warning (`credit_bar::usage_warning_for_session`,
    e.g. `"5% usage left"`) — a billing concept with no Pi counterpart.
  - a right-aligned `multiline` indicator reflects grok's multiline_mode toggle,
    which Pi does not have.
  - There is **no** context percentage on the prompt border.

### Completion dropdown (`render_dropdown_chrome`, `slash_dropdown.rs`)

The slash / file-search dropdown is a panel anchored to the prompt:

- Panel spans the prompt's outer pad (`panel_x = hpad`, width minus both pads).
- Top and bottom borders are plain `─` rules in `bg_highlight` (ELEVATED for
  oscura) on the canvas; the match count sits **on** the top rule in `gray`,
  one cell in from the right corner.
- Panel body fills with `bg_light`; item rows are inset one extra column
  (`dropdown_content_inset = 1 + hpad`), putting the selection gutter 3 cells
  inside the panel.
- Row layout: 2-col gutter (`❯ ` on the selected row, blanks elsewhere) +
  aligned label column (≤ 60% of the width, hard cap 40) + 2-col gap +
  description.
- Colors: label `text_primary`, fuzzy-matched label chars `fuzzy_accent`
  (PURPLE_BRIGHT), description `gray`, optional `[tag]` suffix
  `accent_system`. The selected row sits on `bg_visual` with label and ❯
  **bold** — grok does not switch the selected label to the accent colour.
- At most `MAX_VISIBLE_SUGGESTIONS = 6` items; overflow adds a 2-col
  scrollbar gutter (`gray_dim` thumb on `bg_dark`).
- Pi funnels every provider through one `SelectList` with no match indices,
  so the port highlights the query prefix instead of true fuzzy runs, and
  the wrapped-description continuation rows, `[tag]` suffixes, scrollbar and
  hover states stay grok-only (§10).

## 4. Turn status row (`turn_status.rs`)

One row above the prompt, with **one blank gap row** between it and the box
(`TurnStatusConfig.gap = true`, suppressed in compact mode).

```
⠙ Thinking… 5.2s                        1m2s ⇣8.42k [stop]
└ spinner+label+phase timer (left)      └ turn timer, tokens, buttons (right)
```

- Spinner: 8 braille frames `⠋⠙⠹⠸⠼⠴⠦⠧` (U+280B 2819 2839 2838 283C 2834 2826 2827),
  `SPINNER_DIVISOR = 4` at `fps = 30` ⇒ **133 ms** per frame.
- Spinner color by phase: `accent_success` running tools, `text_secondary`
  thinking/responding/waiting, `warning` retrying, `accent_error` cancelling.
- Labels: `"Thinking…"` `"Responding…"` `"Verifying…"` `"Compacting…"`
  `"Retrying (attempt N)…"` `"Running…"` `"Waiting…"` `"Cancelling…"`.
  Pi surfaces events for thinking / responding / running / compacting; the rest are
  modelled in `extensions/lib/phase.ts` but have no Pi event to fire them yet.
- Timers in `gray`. Token glyph `⇣` U+21E3.
- Queued hint `" · {n} queued"` in `gray` after the phase timer when held queued
  input exists (`turn_status.rs:562`; grok adds `" — Enter to send now"` for
  sendable waits). Pi's `hasPendingMessages()` is a boolean, so the port renders
  `· queued` without the count.
- Stop button literal is `"[stop]"`, `gray` at rest, `accent_error` on hover.
  It is **not** `"Esc:stop"`.
- When a tool is parked on the user ("waiting on you"), the braille spinner is
  swapped for a `◆` pulsing at `MONITOR_PULSE_DIVISOR = 8` (≈267 ms per frame);
  Pi emits no waiting-on-input event, so this stays grok-only (§10).
- Startup row: `"⠋ Starting session… 1.0s"` all in `gray_dim`.

### Duration format (`xai-grok-pager-render/src/util.rs:81`)

```
< 10s   → "{:.1}s"      e.g. 5.2s
< 60s   → "{}s"         e.g. 32s
< 60m   → "{m}m{s}s"    e.g. 2m5s
else    → "{h}h{m}m"    e.g. 1h2m
```

### Turn-status token format (`turn_status.rs:837`)

```
< 1000       → "{n}"        842
< 10_000     → "{:.2}k"     1.23k
< 100_000    → "{:.1}k"     10.1k
< 1_000_000  → "{n/1000}k"  123k
< 10_000_000 → "{:.2}m"     1.23m
else         → "{:.1}m"     10.1m
```

## 5. Context chip (`context_bar.rs`)

Rendered as `8.5K / 1.0M` — used / total, uppercase suffix, distinct from the
turn-status token format.

```
fmt_tokens(n):
  < 1_000       → "{n}"
  < 10_000      → "{:.1}K"   1.2K
  < 1_000_000   → "{n/1000}K"  12K, 999K
  < 10_000_000  → "{:.1}M"   1.2M
  else          → "{n/1e6}M"  12M
```

Color is a gradient blend over usage percent (`default_breakpoints`, `blend_color`):

```
0%  text_primary  (#E4E4E4)
50% accent_user   (#C4A7E7)
65% accent_user   (#C4A7E7)
75% warning       (#EBD96E)
85% warning       (#EBD96E)
95% accent_error  (#DC5A64)
```

Linear interpolation per channel between adjacent breakpoints, clamped at both ends.
Status-bar item separator is `"│"` (`SEPARATOR`).

Percent formatting (`fmt_pct5`, always 5 chars): `< 10 → "5.12%"`, `< 100 → "20.2%"`,
`>= 100 → "MAX %"`.

## 6. Scrollback blocks (`entry_renderer.rs:670`)

Row layout: `[accent 1 col][pad 2][content][pad 2]`, viewport outer hpad 2.
With Pi's `outputPad` pinned to 5, grok's accent column lands at index 2.

- accent glyph `┃` U+2503; collapsed-groupable variant `❙` U+2759 blended 0.5 to bg.
- **user** — no rail, `bg_light` band, one filled blank row above and below,
  prefix `"❯ "` in `accent_user`.
- **assistant** — no rail, no band.
- **thinking** — rail `gray_dim`, animated while running; label `"Thinking…"` running,
  `"Thought for 3.2s"` when done (bold).
- **tool** — bullet `"◆ "` U+25C6 (`gray` collapsed, `gray_bright` expanded);
  rail `accent_error` on error, animated `accent_running` while running,
  else `accent_success`.
- group header `"◈ "` U+25C8 in `gray` + `"{n} tool calls & thoughts"` in
  `gray_bright` bold (`"{n} more"` for plain truncation headers; aggregated
  verb labels like `"Ran 6 commands"` when the render loop supplies them).
- hook status markers `"✓ "` U+2713 / `"✗ "` U+2717.
- bash-origin user rows swap the `❯ ` prefix for `"$ "`; cron rows use `"↻  "`.
- timestamps right-aligned, `gray`, 10 cols, `"  %-I:%M %p"`; hovering shows an
  extended `HH:mm:ss | MMM DD` variant (mouse — grok-only).

## 7. Markdown (`parse.rs`, `md_style.rs`)

- `#` heading markers are dimmed and **hidden** at every level (`parse.rs:869`).
- unordered list markers `-` / `*` become `•` U+2022 in `md_muted`; ordered markers
  keep their digits.
- blockquote `>` becomes `│` U+2502 in `md_muted`, dimmed.
- horizontal rule renders as exactly `───` (3× U+2500) in `md_muted` (`parse.rs:818`).
- inline code: `md_code` + bold, backticks hidden, **no background**.
- fenced code: fence lines and the language tag are **hidden**; every code line gets a
  `md_code_bg` background with syntect foreground on top; **no border** (`render.rs:543`).
- links: text `link_fg` + underline, URL and brackets `md_muted`.
- tasks: checked `md_task_checked`, unchecked `md_task_unchecked` dimmed.

## 8. Animation

```
wave_brightness(tick, row, wave_rows, speed) = sin²(tick*speed + 2π*row/wave_rows)
pulse_brightness(tick, speed)                = sin²(tick*speed)
```

`WAVE_SPEED = 0.15`, `wave_rows = 32`, `fps = 30` — used on running block rails,
colour = `blend(block_bg, accent, brightness)`.
`USER_WAITING_PULSE_SPEED = 0.08` ⇒ ~1.31 s period, brightness `0.3 + 0.7 * pulse`,
used on the "waiting on you" `◆`.

**Not ported.** Both animations paint per row of a transcript block, and every surface
they touch belongs to Pi's transcript renderer — see §10. Ported-but-uncallable helpers
would be dead weight, so they are left out until Pi exposes a render clock.

## 9. Terminal escapes

- OSC 11 sets the canvas to `bg_base`; OSC 111 restores on exit.
- OSC 12 sets the cursor to `accent_user` (`#C4A7E7`); OSC 112 resets
  (`theme/mod.rs:apply_cursor_color`).

## 10. Pi ceiling — deliberately not matched

| grok feature | why not |
| --- | --- |
| sticky top status bar | Pi's `setHeader` is a startup header that scrolls away; the footer is the only persistent top-level region. Branch / cwd / context live in the footer instead. |
| paste / image chips | `[Pasted: 12 lines]` badges on `paste_bg`, image chips and the preview overlay are textarea elements; Pi's editor owns paste handling. |
| ghost text | shell-completion / predicted-prompt suffixes and slash arg placeholders paint at the caret inside the textarea; Pi exposes no per-cell hook. |
| prefix overrides | `"! "` bash / `"~ "` feedback / `"# "` remember / `"? "` history search are grok input modes without Pi equivalents in the editor wrapper. |
| shortcuts bar | grok's hint row below the prompt is driven by its action registry; only its gap row is mirrored (blank row above the footer). |
| `multiline` indicator / credit warning | grok's multiline_mode toggle and credit-balance warnings have no Pi counterpart. |
| queue pane / queued count | grok lists queued prompts in a pane; Pi only exposes `hasPendingMessages()` — a boolean — so the turn-status hint drops the count. |
| vertical outer padding | grok pads the whole viewport 1 row top/bottom; Pi owns the vertical layout of transcript, widgets and footer. |
| dropdown fuzzy runs / scrollbar / hover / tags | Pi's `SelectList` exposes no match indices, mouse state, or per-item tags, and renders line-by-line (no scrollbar); the port highlights the query prefix and shows the match count on the top rule instead. |
| "waiting on you" pulse | grok swaps the status spinner for a `◆` pulsing at 267 ms when a tool is parked on the user; Pi emits no waiting-on-input event. |
| h3-h6 heading colours | Pi renders a heading's text **before** its `#` marker (proved in `markdown.integration.test.ts`), so the level is known only after the text has been styled. h1 is still separable — Pi styles it as `heading(bold(underline(text)))` while every other level is `heading(bold(text))`, so the underline SGR identifies it — which gives grok's h1/h2 split for free and folds h3-h6 onto h2. |
| per-row rail wave animation | Pi message components own their own render; per-row repaint at 30fps is not reachable without forking the renderer. |
| per-entry timestamps | no render hook on the transcript entry. |
| full-width code band | the band is emitted at the block width, but Pi's markdown wrapper trims trailing whitespace, so it ends up hugging the code text. Harmless here: oscura's `md_code_bg` (`#040507`) sits 2 RGB units off `bg_base`, so the difference is imperceptible. |
| live context tokens on turn 1 | `ctx.getContextUsage()` estimates only trailing messages until the first assistant usage lands, so `⇣` reads low during the very first turn and is exact from then on. |

The accent rails (`┃` / `❙`) and their running-wave animation are the one deliberate omission with
no technical blocker: Pi's transcript components own their own render and repaint on content
change, not on a 30fps clock, so a per-row wave would mean re-implementing the transcript
renderer. `waveBrightness` / `pulseBrightness` are ported and tested in `extensions/lib/format.ts`
so the work is one render hook away if Pi ever exposes one.
