# Changelog

## 0.2.0

- The suggestion now appears while you type, before the prompt is sent, so a
  click on `Use <level>` covers the whole turn.
- Every finished turn is logged, and `/effort-stats` reports what turns cost
  at each level. `/effort-stats reset` clears the log.
- `/effort-suggest save` only ever suggests a lower level. The command now
  takes `on | save | off`.
- `Undo` returns to the level in force before the click, and the applied row
  shows it: `Applied effort: low (was medium) [Undo]`.
- Keywords match more endings: "debugging", "planning", "migrating".
- A joiner such as "also" counts as one more ask.
- `/effort-check` reports `Effort at the last request`, since a level picked
  in the switcher is only seen on the next request.

## 0.1.0

- First version: a suggestion row after each submitted prompt, `Use` and
  `Dismiss`, `/effort-check`, and `/effort-suggest on | off`.
