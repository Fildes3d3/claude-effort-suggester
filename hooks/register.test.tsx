import { expect, mock, test } from 'claude-code/testing'
import type { ModelEffort, On } from 'claude-code'

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
const SUBMIT = { text: PROMPT, wait: false, origin: { kind: 'composer' } } as const
const STEP = { turnId: 't1', index: 0, model: 'test', messageCount: 1 } as const
const DONE = { answer: '', toolUses: [], stopReason: 'end_turn', usage: null } as const
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
 * wait, as in the real engine, until `idle()`.
 */
const engine = (on: On, isBusy = false) => {
  const sent: unknown[] = []
  const ran: string[] = []
  let idle = () => {}
  const turnEnd = isBusy
    ? new Promise<void>(resolve => (idle = resolve))
    : Promise.resolve()

  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('ui.toast', () => ({ value: undefined }))
  on('command.run', async (_, e) => {
    await turnEnd
    ran.push(`/${e.command} ${e.args}`)

    return { text: '' }
  })
  on('turn.step', async function* (_, e) {
    sent.push(e.effort)

    return { turnId: e.turnId, index: e.index, ...DONE }
  })

  return { sent, ran, idle }
}

test('a suggestion shows after submit, and one click applies it', async ($, on) => {
  const { sent, ran, idle } = engine(on, true)
  // One model request arriving at the session's own effort.
  const step = async (index: number, effort: ModelEffort) => {
    for await (const _ of $.turn.step({ ...STEP, index, effort })) void _
  }

  await $.prompt.submit(SUBMIT)
  await step(0, 'medium')

  const ui = await $.ui.mount(BAND)
  expect((await ui.find(SUGGESTED))?.text).toContain('high: refactor')

  await ui.press({ key: 'apply' })
  // The session's own setting has not moved yet: the mod sends the level.
  await step(1, 'medium')

  expect(sent).toEqual(['medium', 'high'])
  expect(await ui.find(SUGGESTED)).toBeUndefined()
  expect((await ui.find(APPLIED))?.text).toContain('high')

  // The turn ends and the queued /effort runs.
  idle()
  await settled()
  expect(ran).toEqual(['/effort high'])

  // Once /effort moved the setting, requests arrive at high. Undo stays.
  await step(2, 'high')
  expect((await ui.find(APPLIED))?.text).toContain('was medium')

  // From then on the session's own setting rules.
  await step(3, 'low')
  expect(sent).toEqual(['medium', 'high', 'high', 'low'])
  expect(await ui.find(APPLIED)).toBeUndefined()
  await ui.unmount()
})

test('Undo goes back to the level before the click, even once it landed', async ($, on) => {
  const { ran } = engine(on)

  for await (const _ of $.turn.step({ ...STEP, effort: 'high' })) void _
  // The person moves to medium while idle: no request tells the mod.
  await $.command.run({ command: 'effort', args: 'medium' } as never)
  await $.command.run({ command: 'effort-check', args: 'what is a closure?' } as never)

  const ui = await $.ui.mount(BAND)
  await ui.press({ key: 'apply' })
  await ui.press({ key: 'undo' })

  expect(ran).toEqual(['/effort medium', '/effort low', '/effort medium'])
  expect(await ui.find(APPLIED)).toBeUndefined()
  await ui.unmount()
})

test('the next prompt closes the chance to undo', async ($, on) => {
  engine(on)
  const step = async (index: number, effort: ModelEffort) => {
    for await (const _ of $.turn.step({ ...STEP, index, effort })) void _
  }

  await $.prompt.submit(SUBMIT)
  await step(0, 'medium')

  const ui = await $.ui.mount(BAND)
  await ui.press({ key: 'apply' })
  await step(1, 'high')
  await $.prompt.submit(SUBMIT)

  expect(await ui.find(APPLIED)).toBeUndefined()
  await ui.unmount()
})

test('Undo takes an applied level back', async ($, on) => {
  const { sent, ran } = engine(on)
  const step = async (index: number, effort: ModelEffort) => {
    for await (const _ of $.turn.step({ ...STEP, index, effort })) void _
  }

  await $.prompt.submit(SUBMIT)
  await step(0, 'medium')

  const ui = await $.ui.mount(BAND)
  await ui.press({ key: 'apply' })
  await ui.press({ key: 'undo' })
  await step(1, 'medium')

  // The second /effort follows the first in the queue and restores the level.
  expect(ran).toEqual(['/effort high', '/effort medium'])
  expect(sent).toEqual(['medium', 'medium'])
  expect(await ui.find(APPLIED)).toBeUndefined()
  await ui.unmount()
})

test('a level picked in the switcher wins over an applied one', async ($, on) => {
  const { sent } = engine(on)
  const step = async (index: number, effort: ModelEffort) => {
    for await (const _ of $.turn.step({ ...STEP, index, effort })) void _
  }

  await $.prompt.submit(SUBMIT)
  await step(0, 'medium')

  const ui = await $.ui.mount(BAND)
  await ui.press({ key: 'apply' })
  await settled()
  // The /effort high has landed; then the person picks low in the switcher.
  await step(1, 'low')

  expect(sent).toEqual(['medium', 'low'])
  expect(await ui.find(APPLIED)).toBeUndefined()
  await ui.unmount()
})

test('nothing shows when the effort already matches', async ($, on) => {
  engine(on)

  await $.prompt.submit(SUBMIT)
  for await (const _ of $.turn.step({ ...STEP, effort: 'high' })) void _

  const ui = await $.ui.mount(BAND)
  expect(await ui.find(SUGGESTED)).toBeUndefined()
  await ui.unmount()
})

test('/effort-check offers its result in the band too', async ($, on) => {
  engine(on)
  for await (const _ of $.turn.step({ ...STEP, effort: 'medium' })) void _

  const { text } = await $.command.run(
    // The engine fills in origin and presentation.
    { command: 'effort-check', args: PROMPT } as never,
  )
  expect(text).toContain('Suggested effort high: refactor')
  expect(text).toContain('Effort at the last request: medium')

  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ key: 'apply' })).toBeDefined()
  await ui.unmount()
})

test('/effort-suggest off silences the mod, on brings it back', async ($, on) => {
  engine(on)
  mock.store(on)

  const off = await $.command.run(
    { command: 'effort-suggest', args: 'off' } as never,
  )
  expect(off.text).toBe('Effort suggester is off.')

  await $.prompt.submit(SUBMIT)
  for await (const _ of $.turn.step({ ...STEP, effort: 'medium' })) void _

  const ui = await $.ui.mount(BAND)
  expect(await ui.find(SUGGESTED)).toBeUndefined()

  await $.command.run({ command: 'effort-suggest', args: 'on' } as never)
  await $.prompt.submit(SUBMIT)
  expect((await ui.find(SUGGESTED))?.text).toContain('high: refactor')
  await ui.unmount()
})

test('the toggle is remembered by the next session', async ($, on) => {
  engine(on)
  // What an earlier session's /effort-suggest off stored.
  mock.store(on, { isOn: false })
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.prompt.submit(SUBMIT)
  for await (const _ of $.turn.step({ ...STEP, effort: 'medium' })) void _

  const ui = await $.ui.mount(BAND)
  expect(await ui.find(SUGGESTED)).toBeUndefined()
  await ui.unmount()
})
