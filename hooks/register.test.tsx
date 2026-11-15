import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type {
  ModelEffort,
  On,
  PromptChangeInput,
  PromptChangeResult,
  PromptEditInput,
  PromptEditResult,
} from 'claude-code'

const BAND = {
  plugin: 'effort-suggester',
  component: 'AbovePrompt',
  surface: 'desktop',
  props: {
    hasSurvey: false,
    isCollapsed: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 80,
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  },
} as const

// Scores high: "refactor".
const PROMPT = 'refactor the auth module to use the new session store'
// Scores low: "what is" and a short prompt.
const SMALL = 'what is a closure?'
const SUBMIT = { text: PROMPT, wait: false, origin: { kind: 'composer' } } as const
const STEP = { turnId: 't1', index: 0, model: 'test', messageCount: 1 } as const
const DONE = { answer: '', toolUses: [], stopReason: 'end_turn', usage: null } as const
const SESSION = { cwd: '/', surface: 'desktop', isInteractive: true } as const
const SUGGESTED = { type: 'Text', text: /Suggested effort/ } as const
const APPLIED = { type: 'Text', text: /Applied effort/ } as const

/** Lets a command the mod did not await finish. */
const settled = async () => {
  for (let i = 0; i < 20; i += 1) await Promise.resolve()
}

/**
 * Stands for the engine, beneath the mod: takes prompts, answers model
 * requests, runs commands. `sent` is the effort each request went out at,
 * `ran` each command the mod ran. With `isBusy` a turn is running: commands
 * wait, as in the real engine, until `idle()`. With `isRefusing` every
 * command fails.
 */
const engine = (on: On, { isBusy = false, isRefusing = false } = {}) => {
  const sent: unknown[] = []
  const ran: string[] = []
  let idle = () => {}
  const turnEnd = isBusy
    ? new Promise<void>(resolve => (idle = resolve))
    : Promise.resolve()

  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('ui.toast', () => ({ value: undefined }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('prompt.edit', (_, e) => ({
    text: e.text.slice(0, e.start) + e.inputText + e.text.slice(e.end),
    cursor: e.start + e.inputText.length,
  }))
  on('prompt.change', (_, e) => ({ text: e.text }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('command.run', async (_, e) => {
    await turnEnd
    if (isRefusing) throw new Error('refused')
    ran.push(`/${e.command} ${e.args}`)

    return { text: '' }
  })
  on('turn.step', async function* (_, e) {
    sent.push(e.effort)

    return { turnId: e.turnId, index: e.index, ...DONE }
  })

  return { sent, ran, idle }
}

/** One model request arriving at the session's own effort. */
const step = async (
  $: Engine,
  effort?: ModelEffort,
  more: { index?: number; agentId?: string } = {},
) => {
  // Left out, not undefined: a model without effort sends no such field.
  const input = { ...STEP, ...more, ...(effort === undefined ? {} : { effort }) }

  for await (const _ of $.turn.step(input)) void _
}

/** A slash command, as the person types it. */
const run = ($: Engine, command: string, args = '') =>
  $.command.run({
    command,
    args,
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 80 },
  })

/**
 * The prompt box's own events. The kit raises them like any other, but its
 * `Engine` type lists only the calls a mod can make, so they are typed here.
 */
const box = ($: Engine) =>
  $.prompt as Engine['prompt'] & {
    edit: (e: PromptEditInput) => Promise<PromptEditResult>
    change: (e: PromptChangeInput) => Promise<PromptChangeResult>
  }

/** The person replacing the draft `before` with `text` in the prompt box. */
const type = ($: Engine, text: string, before = '') =>
  box($).edit({
    origin: { kind: 'composer' },
    text: before,
    cursor: before.length,
    start: 0,
    end: before.length,
    inputText: text,
  })

/** A whole main-loop turn: its start, one request, its end with what it cost. */
const turn = async (
  $: Engine,
  one: {
    id: string
    text: string
    effort: ModelEffort
    output: number
    isAborted?: boolean
    agentId?: string
  },
) => {
  const agent = one.agentId === undefined ? {} : { agentId: one.agentId }

  await $.turn.start({ text: one.text, turnId: one.id, ...agent })
  for await (const _ of $.turn.step({
    ...STEP,
    ...agent,
    turnId: one.id,
    effort: one.effort,
  })) {
    void _
  }
  await $.turn.complete({
    ...agent,
    turnId: one.id,
    answer: '',
    durationMs: 1,
    isAborted: one.isAborted ?? false,
    reason: one.isAborted ? 'aborted' : 'answer',
    usage: {
      model: 'test',
      input_tokens: 10,
      output_tokens: one.output,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    },
  })
}

// --- The suggestion row ---------------------------------------------------

test('a suggestion shows after submit, and one click applies it', async ($, on) => {
  const { sent, ran, idle } = engine(on, { isBusy: true })

  await $.prompt.submit(SUBMIT)
  await step($, 'medium')

  const ui = await $.ui.mount(BAND)
  const row = await ui.find(SUGGESTED)
  expect(row?.text).toContain('high: refactor')
  expect(row?.text).toContain('(now medium)')

  await ui.press({ key: 'apply' })
  // The session's own setting has not moved yet: the mod sends the level.
  await step($, 'medium', { index: 1 })

  expect(sent).toEqual(['medium', 'high'])
  expect(await ui.find(SUGGESTED)).toBeUndefined()
  expect((await ui.find(APPLIED))?.text).toContain('high')

  // The turn ends and the queued /effort runs.
  idle()
  await settled()
  expect(ran).toEqual(['/effort high'])

  // Once /effort moved the setting, requests arrive at high. Undo stays.
  await step($, 'high', { index: 2 })
  expect((await ui.find(APPLIED))?.text).toContain('was medium')

  // From then on the session's own setting rules.
  await step($, 'low', { index: 3 })
  expect(sent).toEqual(['medium', 'high', 'high', 'low'])
  expect(await ui.find(APPLIED)).toBeUndefined()
  await ui.unmount()
})

test('nothing shows when the effort already matches', async ($, on) => {
  engine(on)

  await $.prompt.submit(SUBMIT)
  await step($, 'high')

  const ui = await $.ui.mount(BAND)
  expect(await ui.find(SUGGESTED)).toBeUndefined()
  await ui.unmount()
})

test('nothing shows before the session effort is known', async ($, on) => {
  engine(on)

  await $.prompt.submit(SUBMIT)

  const ui = await $.ui.mount(BAND)
  expect(await ui.find(SUGGESTED)).toBeUndefined()
  await ui.unmount()
})

test('a level the mod never suggests still gets a suggestion', async ($, on) => {
  engine(on)

  await $.prompt.submit(SUBMIT)
  await step($, 'xhigh')

  const ui = await $.ui.mount(BAND)
  expect((await ui.find(SUGGESTED))?.text).toContain('(now xhigh)')
  await ui.unmount()
})

test('Dismiss removes the suggestion and changes nothing', async ($, on) => {
  const { sent, ran } = engine(on)

  await $.prompt.submit(SUBMIT)
  await step($, 'medium')

  const ui = await $.ui.mount(BAND)
  await ui.press({ key: 'dismiss' })
  await step($, 'medium', { index: 1 })

  expect(await ui.find(SUGGESTED)).toBeUndefined()
  expect(await ui.find(APPLIED)).toBeUndefined()
  expect(sent).toEqual(['medium', 'medium'])
  expect(ran).toEqual([])
  await ui.unmount()
})

test('a prompt the person did not type is not scored', async ($, on) => {
  engine(on)

  await $.prompt.submit({ ...SUBMIT, isMeta: true })
  await step($, 'medium')

  const ui = await $.ui.mount(BAND)
  expect(await ui.find(SUGGESTED)).toBeUndefined()
  await ui.unmount()
})

test('the row stays out of the way of a survey', async ($, on) => {
  engine(on)

  await $.prompt.submit(SUBMIT)
  await step($, 'medium')

  const ui = await $.ui.mount({
    ...BAND,
    props: { ...BAND.props, hasSurvey: true },
  })
  expect(await ui.find(SUGGESTED)).toBeUndefined()
  await ui.unmount()
})

// --- Apply and Undo -------------------------------------------------------

test('Undo takes an applied level back', async ($, on) => {
  const { sent, ran } = engine(on)

  await $.prompt.submit(SUBMIT)
  await step($, 'medium')

  const ui = await $.ui.mount(BAND)
  await ui.press({ key: 'apply' })
  await ui.press({ key: 'undo' })
  await step($, 'medium', { index: 1 })

  // The second /effort follows the first in the queue and restores the level.
  expect(ran).toEqual(['/effort high', '/effort medium'])
  expect(sent).toEqual(['medium', 'medium'])
  expect(await ui.find(APPLIED)).toBeUndefined()
  await ui.unmount()
})

test('Undo goes back to the level before the click, even once it landed', async ($, on) => {
  const { ran } = engine(on)

  await step($, 'high')
  // The person moves to medium while idle: no request tells the mod.
  await run($, 'effort', 'medium')
  await run($, 'effort-check', SMALL)

  const ui = await $.ui.mount(BAND)
  await ui.press({ key: 'apply' })
  await ui.press({ key: 'undo' })

  expect(ran).toEqual(['/effort medium', '/effort low', '/effort medium'])
  expect(await ui.find(APPLIED)).toBeUndefined()
  await ui.unmount()
})

test('a second click before the first landed keeps the first starting level', async ($, on) => {
  engine(on, { isBusy: true })

  await $.prompt.submit(SUBMIT)
  await step($, 'medium')

  const ui = await $.ui.mount(BAND)
  await ui.press({ key: 'apply' })
  await run($, 'effort-check', SMALL)
  await ui.press({ key: 'apply' })

  expect((await ui.find(APPLIED))?.text).toContain('low (was medium)')
  await ui.unmount()
})

test('the next prompt closes the chance to undo', async ($, on) => {
  engine(on)

  await $.prompt.submit(SUBMIT)
  await step($, 'medium')

  const ui = await $.ui.mount(BAND)
  await ui.press({ key: 'apply' })
  await step($, 'high', { index: 1 })
  await $.prompt.submit(SUBMIT)

  expect(await ui.find(APPLIED)).toBeUndefined()
  await ui.unmount()
})

test('a level picked in the switcher wins over an applied one', async ($, on) => {
  const { sent } = engine(on)

  await $.prompt.submit(SUBMIT)
  await step($, 'medium')

  const ui = await $.ui.mount(BAND)
  await ui.press({ key: 'apply' })
  await settled()
  // The /effort high has landed; then the person picks low in the switcher.
  await step($, 'low', { index: 1 })

  expect(sent).toEqual(['medium', 'low'])
  expect(await ui.find(APPLIED)).toBeUndefined()
  await ui.unmount()
})

test('a refused /effort leaves the mod sending the level, with Undo', async ($, on) => {
  const { sent } = engine(on, { isRefusing: true })

  await $.prompt.submit(SUBMIT)
  await step($, 'medium')

  const ui = await $.ui.mount(BAND)
  await ui.press({ key: 'apply' })
  await settled()
  await step($, 'medium', { index: 1 })

  expect(sent).toEqual(['medium', 'high'])
  expect(await ui.find(APPLIED)).toBeDefined()
  await ui.unmount()
})

test('a subagent request is neither read nor rewritten', async ($, on) => {
  const { sent } = engine(on, { isBusy: true })

  await $.prompt.submit(SUBMIT)
  await step($, 'medium')

  const ui = await $.ui.mount(BAND)
  await ui.press({ key: 'apply' })
  await step($, 'low', { index: 1, agentId: 'a1' })
  await step($, 'medium', { index: 2 })

  // The subagent kept its own low; the main loop still got the applied high.
  expect(sent).toEqual(['medium', 'low', 'high'])
  expect((await ui.find(APPLIED))?.text).toContain('high (was medium)')
  await ui.unmount()
})

test('a request on a model without effort is left alone', async ($, on) => {
  const { sent } = engine(on, { isBusy: true })

  await $.prompt.submit(SUBMIT)
  await step($, 'medium')

  const ui = await $.ui.mount(BAND)
  await ui.press({ key: 'apply' })
  await step($, undefined, { index: 1 })

  expect(sent).toEqual(['medium', undefined])
  await ui.unmount()
})

test('a restart drops an apply that nothing waits on any more', async ($, on) => {
  const { sent } = engine(on, { isBusy: true })
  mock.store(on)

  await $.prompt.submit(SUBMIT)
  await step($, 'medium')

  const ui = await $.ui.mount(BAND)
  await ui.press({ key: 'apply' })
  await $.session.start(SESSION)
  await step($, 'medium', { index: 1 })

  expect(await ui.find(APPLIED)).toBeUndefined()
  expect(sent).toEqual(['medium', 'medium'])
  await ui.unmount()
})

// --- /effort, typed by the person -----------------------------------------

test('/effort tells the mod the new level at once', async ($, on) => {
  engine(on)

  await step($, 'high')
  await run($, 'effort', ' Medium ')

  const { text } = await run($, 'effort-check', PROMPT)
  expect(text).toContain('Effort at the last request: medium')
})

test('/effort with no level leaves the known one alone', async ($, on) => {
  engine(on)

  await step($, 'high')
  await run($, 'effort')
  await run($, 'effort', 'auto')

  const { text } = await run($, 'effort-check', SMALL)
  expect(text).toContain('Effort at the last request: high')
})

// --- /effort-check --------------------------------------------------------

test('/effort-check offers its result in the band too', async ($, on) => {
  engine(on)
  await step($, 'medium')

  const { text } = await run($, 'effort-check', PROMPT)
  expect(text).toBe(
    [
      'Suggested effort high: refactor',
      'Score 4 (refactor +2)',
      'Effort at the last request: medium',
    ].join('\n'),
  )

  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ key: 'apply' })).toBeDefined()
  await ui.unmount()
})

test('/effort-check shows negative signals and an unknown effort', async ($, on) => {
  engine(on)

  const { text } = await run($, 'effort-check', SMALL)
  expect(text).toContain('Score -2 (what is -3, short prompt -1)')
  expect(text).toContain('Effort at the last request: not known yet')
})

test('/effort-check reports the applied level while it is pending', async ($, on) => {
  engine(on, { isBusy: true })

  await $.prompt.submit(SUBMIT)
  await step($, 'medium')

  const ui = await $.ui.mount(BAND)
  await ui.press({ key: 'apply' })

  const { text } = await run($, 'effort-check', SMALL)
  expect(text).toContain('Effort at the last request: high')
  await ui.unmount()
})

test('/effort-check with no prompt explains itself', async ($, on) => {
  engine(on)

  expect((await run($, 'effort-check', '   ')).text).toBe(
    'Usage: /effort-check <prompt>',
  )
})

test('/effort-check still scores when the mod is off, with no button', async ($, on) => {
  engine(on)
  mock.store(on)
  await step($, 'medium')
  await run($, 'effort-suggest', 'off')

  const { text } = await run($, 'effort-check', PROMPT)
  expect(text).toContain('Suggested effort high: refactor')

  await run($, 'effort-suggest', 'on')
  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ key: 'apply' })).toBeUndefined()
  await ui.unmount()
})

// --- /effort-suggest ------------------------------------------------------

test('/effort-suggest off silences the mod, on brings it back', async ($, on) => {
  engine(on)
  mock.store(on)

  expect((await run($, 'effort-suggest', 'off')).text).toBe(
    'Effort suggester is off.',
  )

  await $.prompt.submit(SUBMIT)
  await step($, 'medium')

  const ui = await $.ui.mount(BAND)
  expect(await ui.find(SUGGESTED)).toBeUndefined()

  expect((await run($, 'effort-suggest', 'ON')).text).toBe(
    'Effort suggester is on.',
  )
  await $.prompt.submit(SUBMIT)
  expect((await ui.find(SUGGESTED))?.text).toContain('high: refactor')
  await ui.unmount()
})

test('/effort-suggest with no argument flips the toggle', async ($, on) => {
  engine(on)
  mock.store(on)

  expect((await run($, 'effort-suggest')).text).toBe('Effort suggester is off.')
  expect((await run($, 'effort-suggest')).text).toBe('Effort suggester is on.')
})

test('/effort-suggest refuses anything but its three modes', async ($, on) => {
  engine(on)
  mock.store(on)

  expect((await run($, 'effort-suggest', 'maybe')).text).toBe(
    'Usage: /effort-suggest on | save | off',
  )

  // Still on.
  await $.prompt.submit(SUBMIT)
  await step($, 'medium')
  const ui = await $.ui.mount(BAND)
  expect(await ui.find(SUGGESTED)).toBeDefined()
  await ui.unmount()
})

test('/effort-suggest off stops a level the mod was still sending', async ($, on) => {
  const { sent } = engine(on, { isBusy: true })
  mock.store(on)

  await $.prompt.submit(SUBMIT)
  await step($, 'medium')

  const ui = await $.ui.mount(BAND)
  await ui.press({ key: 'apply' })
  await run($, 'effort-suggest', 'off')
  await step($, 'medium', { index: 1 })

  expect(sent).toEqual(['medium', 'medium'])
  expect(await ui.find(APPLIED)).toBeUndefined()
  await ui.unmount()
})

test('the toggle is remembered by the next session', async ($, on) => {
  engine(on)
  // What an earlier session's /effort-suggest off stored.
  mock.store(on, { isOn: false })

  await $.session.start(SESSION)
  await $.prompt.submit(SUBMIT)
  await step($, 'medium')

  const ui = await $.ui.mount(BAND)
  expect(await ui.find(SUGGESTED)).toBeUndefined()
  await ui.unmount()
})

test('a session start reads back what /effort-suggest stored', async ($, on) => {
  engine(on)
  mock.store(on)

  await run($, 'effort-suggest', 'off')
  await $.session.start(SESSION)
  await $.prompt.submit(SUBMIT)
  await step($, 'medium')

  const ui = await $.ui.mount(BAND)
  expect(await ui.find(SUGGESTED)).toBeUndefined()
  await ui.unmount()
})

test('a session start registers the three commands', async ($, on) => {
  const names: string[] = []
  mock.store(on)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', (_, e) => {
    names.push(e.name)

    return { value: { command: e.name } }
  })

  await $.session.start(SESSION)

  expect(names).toEqual(['effort-check', 'effort-suggest', 'effort-stats'])
})

// --- Suggesting while the person types ------------------------------------

test('the suggestion is there while typing, before the prompt is sent', async ($, on) => {
  engine(on)
  await step($, 'medium')

  const ui = await $.ui.mount(BAND)
  expect(await ui.find(SUGGESTED)).toBeUndefined()

  await type($, PROMPT)
  expect((await ui.find(SUGGESTED))?.text).toContain('high: refactor')
  await ui.unmount()
})

test('a click before sending covers the whole turn', async ($, on) => {
  const { sent, ran } = engine(on)
  await step($, 'medium')
  await type($, SMALL)

  const ui = await $.ui.mount(BAND)
  await ui.press({ key: 'apply' })
  await settled()

  // Idle, so /effort ran at once: the session is on low before the send.
  expect(ran).toEqual(['/effort low'])
  expect((await ui.find(APPLIED))?.text).toContain('low (was medium)')

  await $.prompt.submit({ ...SUBMIT, text: SMALL })
  await step($, 'low', { index: 1 })

  expect(sent).toEqual(['medium', 'low'])
  expect(await ui.find(SUGGESTED)).toBeUndefined()
  expect(await ui.find(APPLIED)).toBeUndefined()
  await ui.unmount()
})

test('the suggestion follows the draft as it changes', async ($, on) => {
  engine(on)
  await step($, 'medium')
  await type($, PROMPT)

  const ui = await $.ui.mount(BAND)
  await type($, SMALL, PROMPT)
  expect((await ui.find(SUGGESTED))?.text).toContain('low: what is')

  // A draft that matches the running level says nothing.
  await type($, 'add a loading spinner to the login button', SMALL)
  expect(await ui.find(SUGGESTED)).toBeUndefined()
  await ui.unmount()
})

test('an emptied box and a slash command have no suggestion', async ($, on) => {
  engine(on)
  await step($, 'medium')
  await type($, PROMPT)

  const ui = await $.ui.mount(BAND)
  await type($, '', PROMPT)
  expect(await ui.find(SUGGESTED)).toBeUndefined()

  await type($, `/effort-check ${PROMPT}`)
  expect(await ui.find(SUGGESTED)).toBeUndefined()
  await ui.unmount()
})

test('a recalled prompt is scored; a box cleared by a send keeps its row', async ($, on) => {
  engine(on)
  await step($, 'medium')

  const ui = await $.ui.mount(BAND)
  await box($).change({ text: PROMPT, cursor: 0, origin: { kind: 'history' } })
  expect((await ui.find(SUGGESTED))?.text).toContain('high: refactor')

  await box($).change({ text: '', cursor: 0, origin: { kind: 'clear' } })
  expect(await ui.find(SUGGESTED)).toBeDefined()
  await ui.unmount()
})

test('typing is not scored while the mod is off', async ($, on) => {
  engine(on)
  mock.store(on)
  await step($, 'medium')
  await run($, 'effort-suggest', 'off')
  await type($, PROMPT)
  await run($, 'effort-suggest', 'on')

  const ui = await $.ui.mount(BAND)
  expect(await ui.find(SUGGESTED)).toBeUndefined()
  await ui.unmount()
})

// --- Save mode ------------------------------------------------------------

test('save mode suggests lower levels and never higher ones', async ($, on) => {
  engine(on)
  mock.store(on)
  await step($, 'medium')

  expect((await run($, 'effort-suggest', 'save')).text).toBe(
    'Effort suggester is on, to save only: it suggests lower levels, never higher.',
  )

  const ui = await $.ui.mount(BAND)
  await type($, PROMPT)
  expect(await ui.find(SUGGESTED)).toBeUndefined()

  await type($, SMALL, PROMPT)
  expect((await ui.find(SUGGESTED))?.text).toContain('low: what is')
  await ui.unmount()
})

test('save mode is remembered by the next session', async ($, on) => {
  engine(on)
  mock.store(on, { mode: 'save' })

  await $.session.start(SESSION)
  await $.prompt.submit(SUBMIT)
  await step($, 'medium')

  const ui = await $.ui.mount(BAND)
  expect(await ui.find(SUGGESTED)).toBeUndefined()
  await ui.unmount()
})

test('a stored mode that is no mode is ignored', async ($, on) => {
  engine(on)
  mock.store(on, { mode: 'loud' })

  await $.session.start(SESSION)
  await $.prompt.submit(SUBMIT)
  await step($, 'medium')

  const ui = await $.ui.mount(BAND)
  expect(await ui.find(SUGGESTED)).toBeDefined()
  await ui.unmount()
})

test('no argument turns save mode off, then back on in both directions', async ($, on) => {
  engine(on)
  mock.store(on)

  await run($, 'effort-suggest', 'save')
  expect((await run($, 'effort-suggest')).text).toBe('Effort suggester is off.')
  expect((await run($, 'effort-suggest')).text).toBe('Effort suggester is on.')
})

// --- The usage log and /effort-stats --------------------------------------

test('/effort-stats says so when nothing is logged', async ($, on) => {
  engine(on)
  mock.store(on)

  expect((await run($, 'effort-stats')).text).toBe(
    'No turns logged yet. Each finished turn adds one.',
  )
})

test('each finished turn is logged with its level and its cost', async ($, on) => {
  engine(on)
  mock.store(on)

  await turn($, { id: 'a', text: SMALL, effort: 'low', output: 200 })
  await turn($, { id: 'b', text: SMALL, effort: 'low', output: 300 })
  await turn($, { id: 'c', text: SMALL, effort: 'low', output: 400 })
  await turn($, { id: 'd', text: SMALL, effort: 'medium', output: 1300 })

  const { text } = await run($, 'effort-stats')
  expect(text).toContain('Effort stats: 4 turns, 2,200 output tokens')
  expect(text).toContain('Used the suggested level: 3 · above it: 1 · below it: 0')
  expect(text).toContain('Scored low: 300 at low (3) · 1,300 at medium (1)')
  expect(text).toContain(
    '1 turns run above their suggestion cost about 1,000 output tokens more',
  )
})

test('the logged level is the one the mod sent, not the one that arrived', async ($, on) => {
  engine(on, { isBusy: true })
  mock.store(on)
  await step($, 'medium')
  await type($, PROMPT)

  const ui = await $.ui.mount(BAND)
  await ui.press({ key: 'apply' })
  await turn($, { id: 'a', text: PROMPT, effort: 'medium', output: 900 })

  const { text } = await run($, 'effort-stats')
  expect(text).toContain('Scored high: 900 at high (1)')
  expect(text).toContain('Used the suggested level: 1')
  await ui.unmount()
})

test('interrupted turns, subagent turns and turns with no prompt are not logged', async ($, on) => {
  engine(on)
  mock.store(on)

  await turn($, { id: 'a', text: PROMPT, effort: 'high', output: 100, isAborted: true })
  await turn($, { id: 'b', text: PROMPT, effort: 'high', output: 100, agentId: 'a1' })
  await turn($, { id: 'c', text: '', effort: 'high', output: 100 })

  expect((await run($, 'effort-stats')).text).toContain('No turns logged yet')
})

test('nothing is logged while the mod is off', async ($, on) => {
  engine(on)
  mock.store(on)

  await run($, 'effort-suggest', 'off')
  await turn($, { id: 'a', text: PROMPT, effort: 'high', output: 100 })

  expect((await run($, 'effort-stats')).text).toContain('No turns logged yet')
})

test('/effort-stats reset clears the log', async ($, on) => {
  engine(on)
  mock.store(on)
  await turn($, { id: 'a', text: PROMPT, effort: 'high', output: 100 })

  expect((await run($, 'effort-stats', 'reset')).text).toBe('Effort stats cleared.')
  expect((await run($, 'effort-stats')).text).toContain('No turns logged yet')
})

test('/effort-stats refuses anything but reset', async ($, on) => {
  engine(on)
  mock.store(on)

  expect((await run($, 'effort-stats', 'all')).text).toBe(
    'Usage: /effort-stats [reset]',
  )
})
