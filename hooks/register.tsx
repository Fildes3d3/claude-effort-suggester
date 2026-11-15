import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Level } from '../types'
import { classify } from './classify'

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
const isOn = atom({ plugin: 'effort-suggester', key: 'isOn' } as const, true)

const LEVELS = ['low', 'medium', 'high', 'xhigh', 'max']

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

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'effort-check',
      description: 'Score a prompt for effort level without sending it',
      argumentHint: '<prompt>',
    })
    await $.command.register({
      name: 'effort-suggest',
      description: 'Turn the effort suggester on or off',
      argumentHint: 'on | off',
    })

    // An apply left over from before a reload has nothing waiting on it.
    await update($, applied, () => null)

    // The toggle is kept across sessions.
    const stored = await $.store.get('isOn')
    if (typeof stored === 'boolean') await update($, isOn, () => stored)

    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    const isTyped = e.command === undefined && e.isMeta !== true

    if (isTyped && (await read($, isOn))) {
      // A new prompt closes the chance to undo the last apply.
      const last = await read($, applied)
      if (last !== null && !last.isPending) await update($, applied, () => null)

      const { level, reason } = classify(e.text)
      await update($, suggestion, () => ({ level, reason }))
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

    return yield* next(last?.isPending ? { ...e, effort: last.level } : e)
  })

  // Learns it sooner from `/effort` itself, whoever ran it.
  on('command.run', { command: 'effort' }, async ($, e, next) => {
    const result = await next(e)
    const own = e.args.trim().toLowerCase()
    if (LEVELS.includes(own)) await settle($, own)

    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || !(await read($, isOn))) return next(e)

    const pending = await read($, suggestion)
    const last = await read($, applied)
    const running = last?.isPending
      ? last.level
      : await read($, sessionEffort)
    // Nothing to say when the effort already matches, or is not known yet.
    const isShown =
      pending !== null && running !== null && pending.level !== running

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

    const { level, reason, score, signals } = classify(prompt)
    // Also offer it in the band, so the level can be applied before sending.
    if (await read($, isOn)) {
      await update($, suggestion, () => ({ level, reason }))
    }

    const last = await read($, applied)
    const running = last?.isPending
      ? last.level
      : await read($, sessionEffort)
    const detail = signals
      .map(one => `${one.label} ${one.score > 0 ? '+' : ''}${one.score}`)
      .join(', ')

    return {
      text: [
        `Suggested effort ${reason}`,
        `Score ${score}${detail ? ` (${detail})` : ''}`,
        // A switcher pick shows up here only after the next request.
        `Effort at the last request: ${running ?? 'not known yet'}`,
      ].join('\n'),
    }
  })

  on('command.run', { command: 'effort-suggest' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg !== '' && arg !== 'on' && arg !== 'off') {
      return { text: 'Usage: /effort-suggest on | off' }
    }

    const next = arg === '' ? !(await read($, isOn)) : arg === 'on'
    await $.store.set('isOn', next)
    await update($, isOn, () => next)

    if (!next) {
      // Off means off: no suggestion left on screen, no level still sent.
      // A level already set through /effort stays; it is the session's own.
      await update($, suggestion, () => null)
      await update($, applied, () => null)
    }

    return { text: `Effort suggester is ${next ? 'on' : 'off'}.` }
  })
}
