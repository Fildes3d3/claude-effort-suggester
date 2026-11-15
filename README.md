# effort-suggester

A Claude Code mod that suggests an effort level (low / medium / high / max)
while you type a prompt, applies it in one click, and logs what each level
costs you in tokens.

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

To update an installed copy to the newest version, from a shell, then
restart Claude Code:

```bash
claude plugin marketplace update claude-effort-suggester
```

```bash
claude plugin update effort-suggester@claude-effort-suggester
```

## What it does

- While you type, a rule-based classifier scores the draft (no model call,
  no tokens spent).
- If its level differs from the effort the session is running at, a row
  appears above the prompt, before you send:
  `Suggested effort low: what is + short prompt (now high) [Use low] [Dismiss]`
- `Use <level>` applies it. Clicked before sending, the whole turn runs at
  that level. Nothing changes without that click.
- If the level already matches, nothing is shown.
- Every finished turn is logged with the level it was suggested, the level
  it ran at and its output tokens, so you can see what the levels cost you.
- It learns from your own turns: words that keep turning up in turns that
  cost more, or less, than your usual start to count in the suggestion.

## Commands

| Command | What |
| --- | --- |
| `/effort-check <prompt>` | Scores a prompt without sending it, with the signals behind the score. |
| `/effort-suggest on` | Suggests in both directions (the default). |
| `/effort-suggest save` | Only ever suggests a lower level: the mode for cutting token use. |
| `/effort-suggest off` | Suggests nothing and logs nothing. No argument flips on and off. |
| `/effort-stats` | What your turns cost at each level, and what running above the suggestion cost. |
| `/effort-stats reset` | Clears the log. |
| `/effort-words` | The words learned from your turns, and which way each leans. |
| `/effort-words off` | Stops learning and stops using what was learned. `on` brings both back. |
| `/effort-words reset` | Deletes every learned word. |

The mode, the log and the learned words are kept across sessions.

## Learning from your prompts

The built-in keywords are generic. Your work has its own vocabulary, so the
mod builds a dictionary from it:

- When a turn ends, each distinct word of its prompt is noted with how the
  turn's output tokens compared with your usual at that effort level: twice
  the usual is +1, half is -1. Comparing within one level keeps the level
  itself out of what the words are taught.
- A word starts to count once it was in 5 turns that leaned at least 0.5 on
  average. The strongest three of a prompt add at most 2 to the score, or
  take 2 off.
- The reason says so when it happens: `high: learned: kubernetes, cluster`.

What is kept: single words and two numbers each, in the mod's own store on
your machine. No prompt is stored, nothing leaves the machine, and words
inside pasted code blocks are skipped. Common words and the built-in
keywords are left out. The dictionary holds its 2,000 most used words.

Learning needs data: nothing is learned until three turns have run at an
effort level, and a word needs five turns of its own. The rules are in
`hooks/config.ts` under `learned`.

## Does it save tokens?

Only your own numbers can say. `/effort-stats` prints them. An example, with
made-up figures:

```
Effort stats: 42 turns, 310,400 output tokens
Used the suggested level: 30 · above it: 9 · below it: 3

Average output tokens per turn, by what the prompt scored (turns):
Scored low: 640 at low (11) · 2,150 at medium (6)
Scored medium: 4,900 at medium (14) · 9,300 at high (3)
Scored high: 5,200 at medium (3) · 14,800 at high (5)

9 turns run above their suggestion cost about 21,000 output tokens more than your average at the suggested level.
```

Read a line across: the same kind of prompt at different levels. The last
line compares the turns you ran above their suggestion with your own average
at the suggested level, once there are three such turns to average.

## Files

| File | What |
| --- | --- |
| `hooks/config.ts` | Every weight, threshold and keyword. Edit this to tune. |
| `hooks/classify.ts` | The classifier, a pure function. |
| `hooks/stats.ts` | The usage log and the `/effort-stats` report, pure functions. |
| `hooks/words.ts` | The learned dictionary and the `/effort-words` report, pure functions. |
| `hooks/register.tsx` | The hooks: typing, submit, the band, apply, the log, the commands. |
| `hooks/*.test.ts(x)` | Tests for all of the above. |
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
- The log counts output tokens (thinking and answer) of main-loop turns.
  Subagent turns and interrupted turns are left out, and input tokens are
  not counted. It holds the newest 500 turns.
- The estimate compares turns of different prompts, so it is a rough guide,
  not a controlled measurement.
- The classifier reads wording, not difficulty: a hard problem phrased
  plainly scores medium. Learned words narrow that gap only as far as your
  costly work has words of its own.
- A learned word shows that it kept company with costly turns, not that it
  caused them. One long session on one topic can teach its words too
  strongly; `/effort-words` shows what was learned and `reset` clears it.
- A click while a turn is running applies from the next model request on,
  not to the request already in flight. Click before sending to cover the
  whole turn.

## Changes

See [CHANGELOG.md](CHANGELOG.md).

## Licence

MIT, see [LICENSE](LICENSE).
