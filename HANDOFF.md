# Handoff: Pi Oscura Theme

## Current state

Working no-fork Oscura Midnight theme and terminal skin for Pi `0.80.6`.

- Local package: `/Users/jb/pi-oscura-theme`
- Public repository: `https://github.com/joshbochu/pi-oscura-theme`
- Global package entry: `../../pi-oscura-theme`
- Base Pi theme remains `dark`; extension applies `oscura-midnight` in memory.
- Terminal canvas switches to `#030304` while Pi runs, then restores on shutdown.
- Repository uses `main`; push future work with `git push`.

## Quick start

1. `cd /Users/jb/pi-oscura-theme`
2. Read `extensions/oscura-theme.ts` before editing.
3. Run `/reload`, or launch `bin/gpi-preview` for isolation.
4. Type `/` without Enter to inspect autocomplete.
5. Run checks before each commit.

## Visual invariants

- Oscura Midnight identifier and palette
- Rounded composer: `╭ ╮ ╰ ╯`
- No extra skin margin; terminal application supplies edge padding
- Prompt rows: `│ ❯ text`; continuation rows: `│   text`
- Lower metadata ends `· 0% ─╯`
- Compact empty composer: 3 rows
- Inline model · thinking · context percentage
- Autocomplete panel above composer
- CWD/branch-only footer
- Hidden shortcut row and suppressed powerbar widget

## Runtime architecture

### Theme loading

`extensions/oscura-theme.ts` computes `THEME_PATH` relative to `import.meta.url`.

1. `resources_discover` returns the theme path.
2. Deferred callback reads `ctx.ui.getTheme("oscura-midnight")`.
3. Callback passes the returned `Theme` object to `ctx.ui.setTheme()`.

Pass the `Theme` object, not its name, to avoid persisting the global theme setting.

### Terminal canvas

- `session_start` emits OSC 11 with `#030304`.
- `session_shutdown` emits OSC 111 to restore the terminal default.
- `PI_OSCURA_TERMINAL_CANVAS=0` disables both sequences.
- If cleanup is skipped, reset manually with `printf '\e]111\a'`.

### Composer geometry

`OscuraEditor extends CustomEditor`.

```ts
const CHROME_MARGIN = 0;
const PROMPT_INSET = 1;
const outerMargin = width >= 12 ? CHROME_MARGIN : 0;
const contentWidth = Math.max(1, width - outerMargin * 2 - 2);
const baseEditorWidth = Math.max(1, contentWidth - PROMPT_INSET);
```

- `setPaddingX()` forces 2 columns after Pi reapplies editor padding.
- `PROMPT_INSET` reserves 1 cell before `❯` and reduces base editor width equally.
- `fitTopBorder()` fills the reduced top border with `─`.
- `cornerConnector` adds `─` before lower-right `╯`.
- Keep every line at or below `width`; use `visibleWidth()` and `truncateToWidth()`.

### Autocomplete

Pi owns filtering, navigation, acceptance, and cancellation. The extension only moves its rendered rows above the composer and adds theme chrome. Re-test slash completion after Pi upgrades because `borderLineIndex()` and the private filtered-item count are upgrade-sensitive.

### Powerbar

The skin suppresses pi-powerbar's widget. Override once with:

```bash
PI_OSCURA_KEEP_POWERBAR=1 pi
```

## Validation

```bash
python3 -m json.tool themes/oscura-midnight.json >/dev/null
bash -n bin/gpi-preview
```

Strict TypeScript check uses temporary symlinks to the installed Pi `0.80.6` packages. The last approved validation also covered a 120×36 tmux preview: composer lines stayed within width, prompt inset and multiline alignment held, and the lower border ended `· 0% ─╯`.

## Next priorities

1. Run `/reload` in normal Pi to inspect current colors and spacing.
2. Compare slash autocomplete at normal terminal width.
3. Re-run strict TypeScript, theme JSON, preview shell, and fixed-width TUI checks after visual edits.
