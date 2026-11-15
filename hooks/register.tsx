import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Level, Mode } from '../types'
import { classify } from './classify'
import { addRecord, parseLog, rank, report, usualAt } from './stats'
import { leanOf, learn, parseDictionary, wordReport, wordsOf } from './words'
import type { Dictionary } from './words'

const suggestion = atom(
  { plugin: 'effort-suggester', key: 'suggestion' } as const,
  null,
)
const sessionEffort = atom(
  { plugin: 'effort-suggester', key: 'sessionEffort' } as const,
  null,
)
const applied = atom(
  { plugin: 'effort-suggester', key: 'applied' } as const,
  null,
)
const mode = atom({ plugin: 'effort-suggester', key: 'mode' } as const, 'on')

/** Every level `/effort` takes, the ones the mod never suggests included. */
const LEVELS: readonly string[] = ['low', 'medium', 'high', 'xhigh', 'max']
const MODES: readonly string[] = ['on', 'save', 'off']

/**
 * Turns in flight on the main loop: what their prompt scored and the level
 * their first request went out at. Lost on a reload, with the turn's record.
 */
const turns = new Map<
  string,
  { suggested: Level; words: string[]; used?: string }
>()

/**
 * The learned dictionary, read from the store when the session starts and
 * kept here so that scoring a keystroke reads no store. Empty while
 * learning is off.
 */
let dictionary: Dictionary = {}
let isLearning = true

/** The classifier with what was learned: the one every hook scores with. */
const score = (prompt: string) => classify(prompt, undefined, dictionary)

/** The prose of a prompt: pasted code teaches no words. */
const proseOf = (prompt: string) => prompt.replace(/```[\s\S]*?(```|$)/g, ' ')

/** The level requests go out at: the applied one until its `/effort` lands. */
const runningEffort = async ($: EngineInterface) => {
  const last = await read($, applied)

  return last?.isPending ? last.level : read($, sessionEffort)
}

/**
 * The session's own effort is now `own`. If that is the applied level, its
 * `/effort` landed; anything else is the person's own choice, which wins.
 */
const settle = async ($: EngineInterface, own: string) => {
  const last = await read($, applied)
  await update($, sessionEffort, () => own)

  if (last === null) return
  await update($, applied, () =>
    last.level === own ? { ...last, isPending: false } : null,
  )
}

/**
 * Applies a level, only ever from the person's click.
 *
 * The built-in `/effort` command moves the session's own setting, so the
 * switcher follows, but it runs only once the session is idle. Until then
 * (`isPending`) the mod sends the level itself, so a click mid-turn counts
 * from the next request on. The level before the click is kept for Undo.
 */
const apply = async ($: EngineInterface, level: Level) => {
  const before = await read($, applied)
  const previous = before?.isPending
    ? before.previous
    : ((await read($, sessionEffort)) ?? level)

  await update($, applied, () => ({ level, previous, isPending: true }))
  await update($, suggestion, () => null)
  $.ui.toast(`Effort ${level} from the next request on`)

  // Not awaited: it resolves only once the running turn is over. The mod's
  // own hook on `/effort` does not see the mod's own run, hence the settle.
  void $.command
    .run({ command: 'effort', args: level })
    .then(() => settle($, level))
    .catch(() => undefined)
}

/** Goes back to the level before the click, a queued `/effort` included. */
const undo = async ($: EngineInterface) => {
  const last = await read($, applied)
  if (last === null) return

  await update($, applied, () => null)
  void $.command
    .run({ command: 'effort', args: last.previous })
    .then(() => settle($, last.previous))
    .catch(() => undefined)
}

/**
 * Scores the draft in the prompt box, so the suggestion is there before the
 * prompt is sent and one click covers the whole turn. An empty box or a
 * slash command has none.
 */
const scoreDraft = async ($: EngineInterface, text: string) => {
  if ((await read($, mode)) === 'off') return

  const draft = text.trim()
  const now = await read($, suggestion)

  if (draft === '' || draft.startsWith('/')) {
    if (now !== null) await update($, suggestion, () => null)

    return
  }

  const { level, reason } = score(draft)
  // Typing mostly leaves the result as it was: write, and redraw, on a change.
  if (now?.level === level && now.reason === reason) return

  await update($, suggestion, () => ({ level, reason }))
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'effort-check',
      description: 'Score a prompt for effort level without sending it',
      argumentHint: '<prompt>',
    })
    await $.command.register({
      name: 'effort-suggest',
      description: 'Suggest in both directions, only to save, or not at all',
      argumentHint: 'on | save | off',
    })
    await $.command.register({
      name: 'effort-stats',
      description: 'Show what turns cost at each effort level',
      argumentHint: '[reset]',
    })
    await $.command.register({
      name: 'effort-words',
      description: 'Show the words learned from your turns, or turn learning on or off',
      argumentHint: '[on | off | reset]',
    })

    // An apply left over from before a reload has nothing waiting on it.
    await update($, applied, () => null)

    // The mode is kept across sessions; `isOn` is what version 0.1.0 stored.
    const stored = await $.store.get('mode')
    if (typeof stored === 'string' && MODES.includes(stored)) {
      await update($, mode, () => stored as Mode)
    } else if ((await $.store.get('isOn')) === false) {
      await update($, mode, () => 'off')
    }

    // Learning is on unless it was turned off; the dictionary comes with it.
    isLearning = (await $.store.get('isLearning')) !== false
    dictionary = isLearning ? parseDictionary(await $.store.get('words')) : {}

    return next(e)
  })

  // The person typing: `next` answers the box as the edit leaves it.
  on('prompt.edit', async ($, e, next) => {
    const box = await next(e)
    await scoreDraft($, box.text).catch(() => undefined)

    return box
  })

  // The box changed some other way: a recalled prompt, an undo, a fill. A
  // box emptied this way keeps the suggestion: that is a prompt just sent.
  on('prompt.change', async ($, e, next) => {
    if (e.text.trim() !== '') await scoreDraft($, e.text).catch(() => undefined)

    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    const isTyped = e.command === undefined && e.isMeta !== true

    if (isTyped && (await read($, mode)) !== 'off') {
      // A new prompt closes the chance to undo the last apply.
      const last = await read($, applied)
      if (last !== null && !last.isPending) await update($, applied, () => null)

      const { level, reason } = score(e.text)
      await update($, suggestion, () => ({ level, reason }))
    }

    return next(e)
  })

  // Opens the turn's record with what its prompt scored.
  on('turn.start', async ($, e, next) => {
    const isLogged =
      e.agentId === undefined &&
      e.text.trim() !== '' &&
      (await read($, mode)) !== 'off'
    if (isLogged) {
      turns.set(e.turnId, {
        suggested: score(e.text).level,
        words: isLearning ? wordsOf(proseOf(e.text)) : [],
      })
    }

    return next(e)
  })

  // Learns the session's own effort from each main-loop request, and sends
  // the applied level while its `/effort` has not landed yet.
  on('turn.step', async function* ($, e, next) {
    if (e.agentId !== undefined || e.effort === undefined) {
      return yield* next(e)
    }

    const own = String(e.effort)
    if ((await read($, sessionEffort)) !== own) await settle($, own)

    const last = await read($, applied)
    const sent = last?.isPending ? last.level : own

    const turn = turns.get(e.turnId)
    if (turn && turn.used === undefined) turn.used = sent

    return yield* next(last?.isPending ? { ...e, effort: last.level } : e)
  })

  // Closes the turn's record with what it cost. An interrupted turn is left
  // out: its cost says nothing about the level.
  on('turn.complete', async ($, e, next) => {
    const turn = turns.get(e.turnId)
    turns.delete(e.turnId)

    if (turn?.used !== undefined && e.usage && !e.isAborted) {
      const record = {
        at: Date.now(),
        suggested: turn.suggested,
        used: turn.used,
        output: e.usage.output_tokens,
      }
      const { used, words } = turn
      await $.store
        .get('log')
        .then(async stored => {
          const log = parseLog(stored)
          // Taught against the turns before this one, then logged itself.
          const usual = usualAt(log, used)
          if (usual !== null && words.length > 0) {
            dictionary = learn(dictionary, words, leanOf(record.output, usual))
            await $.store.set('words', dictionary)
          }
          await $.store.set('log', addRecord(log, record))
        })
        .catch(() => undefined)
    }

    return next(e)
  })

  // Learns it sooner from `/effort` itself, whoever ran it.
  on('command.run', { command: 'effort' }, async ($, e, next) => {
    const result = await next(e)
    const own = e.args.trim().toLowerCase()
    // Learning the level must never cost the person their command's answer.
    if (LEVELS.includes(own)) await settle($, own).catch(() => undefined)

    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const current = await read($, mode)
    if (e.props.hasSurvey || current === 'off') return next(e)

    const pending = await read($, suggestion)
    const last = await read($, applied)
    const running = await runningEffort($)
    // Nothing to say when the effort already matches, or is not known yet;
    // in `save` mode, nor when the suggestion would spend more.
    const isShown =
      pending !== null &&
      running !== null &&
      pending.level !== running &&
      (current === 'on' || rank(pending.level) < rank(running))

    if (!isShown && last === null) return next(e)

    const { Box, Button, Text } = $.ui.resolve(e)

    return (
      <Box flexDirection="column">
        {isShown && (
          <Box>
            <Text>
              Suggested effort {pending.reason}{' '}
              <Text dimColor>(now {running}) </Text>
            </Text>
            <Button
              key="apply"
              label={`Use ${pending.level}`}
              onPress={() => apply($, pending.level)}
            />
            <Text> </Text>
            <Button
              key="dismiss"
              label="Dismiss"
              onPress={() => update($, suggestion, () => null)}
            />
          </Box>
        )}
        {last !== null && (
          <Box>
            <Text dimColor>
              Applied effort: {last.level} (was {last.previous}){' '}
            </Text>
            <Button key="undo" label="Undo" onPress={() => undo($)} />
          </Box>
        )}
      </Box>
    )
  })

  on('command.run', { command: 'effort-check' }, async ($, e) => {
    const prompt = e.args.trim()
    if (prompt === '') return { text: 'Usage: /effort-check <prompt>' }

    const { level, reason, score: total, signals } = score(prompt)
    // Also offer it in the band, so the level can be applied before sending.
    if ((await read($, mode)) !== 'off') {
      await update($, suggestion, () => ({ level, reason }))
    }

    const running = await runningEffort($)
    const detail = signals
      .map(one => `${one.label} ${one.score > 0 ? '+' : ''}${one.score}`)
      .join(', ')

    return {
      text: [
        `Suggested effort ${reason}`,
        `Score ${total}${detail ? ` (${detail})` : ''}`,
        // A switcher pick shows up here only after the next request.
        `Effort at the last request: ${running ?? 'not known yet'}`,
      ].join('\n'),
    }
  })

  on('command.run', { command: 'effort-suggest' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg !== '' && !MODES.includes(arg)) {
      return { text: 'Usage: /effort-suggest on | save | off' }
    }

    // No argument flips between suggesting and not.
    const flipped: Mode = (await read($, mode)) === 'off' ? 'on' : 'off'
    const next = arg === '' ? flipped : (arg as Mode)
    await $.store.set('mode', next)
    await update($, mode, () => next)

    if (next === 'off') {
      // Off means off: no suggestion left on screen, no level still sent.
      // A level already set through /effort stays; it is the session's own.
      await update($, suggestion, () => null)
      await update($, applied, () => null)
    }

    const said = {
      on: 'on.',
      save: 'on, to save only: it suggests lower levels, never higher.',
      off: 'off.',
    }

    return { text: `Effort suggester is ${said[next]}` }
  })

  on('command.run', { command: 'effort-stats' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()

    if (arg === 'reset') {
      await $.store.delete('log')

      return { text: 'Effort stats cleared.' }
    }
    if (arg !== '') return { text: 'Usage: /effort-stats [reset]' }

    return { text: report(parseLog(await $.store.get('log'))) }
  })

  on('command.run', { command: 'effort-words' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()

    if (arg === 'reset') {
      dictionary = {}
      await $.store.delete('words')

      return { text: 'Effort words cleared.' }
    }
    if (arg === 'on' || arg === 'off') {
      isLearning = arg === 'on'
      await $.store.set('isLearning', isLearning)
      // Off stops both the learning and its use; the words are kept for on.
      dictionary = isLearning ? parseDictionary(await $.store.get('words')) : {}

      return {
        text: isLearning
          ? 'Effort words are on: prompts teach their words, and learned words count in suggestions.'
          : 'Effort words are off: nothing is learned or used. /effort-words reset deletes what was learned.',
      }
    }
    if (arg !== '') return { text: 'Usage: /effort-words [on | off | reset]' }
    if (!isLearning) {
      return { text: 'Effort words are off. /effort-words on turns them back on.' }
    }

    return { text: wordReport(dictionary) }
  })
}
