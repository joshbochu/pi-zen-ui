# Repository guidance

## Validation

Run these from the repository root before considering a change complete:

```bash
npm test
npm run typecheck
npm pack --dry-run

git diff --check
```

## Manual source preview

Use this single-line command from anywhere inside the repository. Keep it on one
line when copying it so shell continuation whitespace cannot drop arguments:

```bash
ROOT="$(git rev-parse --show-toplevel)" && pi --no-extensions --no-themes --no-context-files --no-session --theme "$ROOT/themes/oscura-midnight.json" --extension "$ROOT/extensions/pi-zen-ui.ts"
```

This starts a fresh, non-persisted conversation with only the repository's theme
and extension loaded. It does not install or replace the published package.

Inside Pi, run `/pi-zen-ui` and verify:

1. The **Color preset** row cycles immediately between Oscura, Nord Frost, and Custom.
2. **Accent color** accepts a valid six-digit value such as `#A3BE8C`.
3. Invalid input such as `#123` remains open and shows the validation message.
4. The prompt arrow, terminal cursor, headings, active border, selection, and context gradient update together.
5. The near-black canvas, syntax colors, and semantic success/warning/error colors do not change.

If `/pi-zen-ui` is missing, first confirm that the command resolved this repository:

```bash
ROOT="$(git rev-parse --show-toplevel)" && test -f "$ROOT/extensions/pi-zen-ui.ts" && printf 'extension found: %s\n' "$ROOT/extensions/pi-zen-ui.ts"
```

For the isolated launcher instead, run:

```bash
./bin/pi-zen-ui-preview
```
