# effort-suggester

A Claude Code mod that suggests an effort level (low / medium / high / max)
for each prompt you submit, with one click to apply it.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install effort-suggester --marketplace Fildes3d3/claude-effort-suggester
```

Answer `y` to add the marketplace, then pick a scope.

From a shell:

```bash
claude plugin install effort-suggester --marketplace Fildes3d3/claude-effort-suggester
```

In the desktop app, where `/plugin` does not run: click + next to the prompt
box, then Plugins, Add marketplace with `Fildes3d3/claude-effort-suggester`,
then Add plugin.

Needs a Claude Code build with mods (hooks modules); built and tested on
2.1.325.

## What it does

- On submit, a rule-based classifier scores the prompt (no model call).
- If the suggestion differs from the effort the turn is running at, a row
  appears in the band above the prompt:
  `Suggested effort high: refactor + stack trace (now medium) [Use high] [Dismiss]`
- If it matches, nothing is shown.
- `Use <level>` applies it. Nothing changes without that click.
- `/effort-check <prompt>` scores a prompt without sending it, and offers
  the same `Use <level>` button.
- `/effort-suggest on | off` turns the mod on or off (kept across sessions).

## Files

| File | What |
| --- | --- |
| `hooks/config.ts` | Every weight, threshold and keyword. Edit this to tune. |
| `hooks/classify.ts` | The classifier, a pure function. |
| `hooks/register.tsx` | The hooks: submit, the band, apply, the commands. |
| `hooks/*.test.ts(x)` | Tests: 20 sample prompts, plus the band, apply, undo and the toggle. |
| `types/index.d.ts` | The mod's state contract. |

## Check and test

```bash
claude plugin validate .
```

```bash
claude plugin test .
```

## Run it from a folder while changing it

```bash
claude --plugin-dir /path/to/effort-suggester
```

## Limits

- A mod cannot draw inside the built-in model/effort switcher; the band
  above the prompt is the nearest place.
- Apply does two things. It runs the built-in `/effort <level>`, so the
  session's own setting and the switcher follow. `/effort` only runs once
  the session is idle, so until then the mod sends the level itself. The
  row `Applied effort: <level> (was <previous>) [Undo]` stays until your
  next prompt, or until you pick another level yourself, which always
  wins. `Undo` runs `/effort <previous>`.
- A level picked in the switcher is not announced to mods. The mod only
  sees it on the next model request, so the `Applied effort` row stays
  until you send your next message, and `/effort-check` and `(now …)`
  report the level of the last request until then.
- `/effort` set this way lasts for the session, as when typed.
- The suggestion arrives as the turn starts, so a click applies from the
  next model request on, not to the request already in flight.

## Licence

MIT, see [LICENSE](LICENSE).
