# TUI Blessed Rewrite + Add-Task Modal

## Problem

The current TUI in `src/tui.ts` uses raw ANSI escape codes for rendering and
keyboard handling. This makes it harder to maintain, extend, and keep
cross-terminal consistent. There is no way to add a task from within the TUI.

## Solution

Replace raw ANSI rendering with the `blessed` npm package (the same library
Claude Code uses), and add an `a` keybinding that opens an add-task modal.

## Architecture

### Layout (blessed screen)

```
┌─ anti-delay ────────────────── Pending: 5 ─┐   ← header (Box, row 0)
│ [pending] Buy groceries           Due: ...  │
│ [pending] File taxes              Due: ...  │   ← task List (keys/vi/mouse)
│ [pending] Call dentist            Due: ...  │
│                                              │
├── a:add  d:delay  space:done  ↑↓  q:quit ──┤   ← footer (Box, last row)
```

- `Screen` with `smartCSR: true`
- `Box` header (top 0, height 1, bold cyan)
- `List<string>` (top 1, height `100%-2`, keys/vi/mouse, selected invert)
- `Box` footer (bottom 0, height 1, dim)

### Keybindings

| Key | Action | Guard |
|---|---|---|
| `q`, `C-c` | Quit | `!modalActive` |
| `space` | Mark selected done | `!modalActive` |
| `d` | Delay modal | `!modalActive` |
| `a` | Add-task modal | `!modalActive` |
| `r` | Refresh list | `!modalActive` |
| `escape` | Close active modal | `closeModal` callback |
| `↑↓`, `j/k`, mouse | List navigation | built-in List widget |

### Modals

Both modals use `blessed.box` with `border: line` and a `label`. Fields are
`textbox` widgets with `inputOnFocus: true`. Buttons use `blessed.button`
with `keys: true` (Enter/Space activates them when focused).

**Add-task modal** (52×11):
- Title (textbox, required)
- Description (textbox, optional)
- Due date (textbox, required)
- Priority (textbox, defaults to "medium")
- Submit / Cancel buttons

**Delay modal** (40×7):
- Hours (1-168) (textbox)
- Submit / Cancel buttons

### Modal guard pattern

A `modalActive` boolean prevents screen-level key handlers from firing while
a modal is open. A `closeModal: (() => void) | null` callback provides a
single escape-key handler registered once in the constructor; each modal sets
it to its own cleanup closure.

### Task data

A `Task[]` array is kept separate from the `List` items. The `List.selected`
index maps back into the `tasks` array for markDone/delay lookups.

## Dependencies

Add `blessed` (runtime) and `@types/blessed` (dev).

## Files changed

- `src/tui.ts` — full rewrite
- `package.json` — add `blessed` dependency

## Out of scope

- Status-bar messages (the original showed brief feedback after actions)
- Description in add modal was included per user request
