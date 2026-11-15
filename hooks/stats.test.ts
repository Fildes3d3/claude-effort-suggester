import { expect, test } from 'claude-code/testing'

import type { Level } from '../types'
import { addRecord, MAX_RECORDS, parseLog, rank, report } from './stats'
import type { TurnRecord } from './stats'

const one = (suggested: Level, used: string, output: number): TurnRecord => ({
  at: 0,
  suggested,
  used,
  output,
})

test('levels rank lowest first, and a stranger ranks below them all', async () => {
  expect(rank('low')).toBeLessThan(rank('medium'))
  expect(rank('medium')).toBeLessThan(rank('high'))
  expect(rank('high')).toBeLessThan(rank('xhigh'))
  expect(rank('xhigh')).toBeLessThan(rank('max'))
  expect(rank('auto')).toBe(-1)
})

test('what the store gives back is kept only where it is a record', async () => {
  const good = one('low', 'medium', 5)

  expect(parseLog(undefined)).toEqual([])
  expect(parseLog('log')).toEqual([])
  expect(parseLog({ 0: good })).toEqual([])
  expect(
    parseLog([
      good,
      null,
      'text',
      { ...good, suggested: 'xhigh' },
      { ...good, output: '5' },
      { ...good, used: 3 },
      { suggested: 'low', used: 'low', output: 1 },
    ]),
  ).toEqual([good])
})

test('the log keeps the newest records only', async () => {
  let log: TurnRecord[] = []
  for (let i = 0; i < MAX_RECORDS + 5; i += 1) {
    log = addRecord(log, one('low', 'low', i))
  }

  expect(log).toHaveLength(MAX_RECORDS)
  expect(log[0]?.output).toBe(5)
  expect(log.at(-1)?.output).toBe(MAX_RECORDS + 4)
})

test('adding a record leaves the log it was given alone', async () => {
  const log = [one('low', 'low', 1)]
  addRecord(log, one('low', 'low', 2))

  expect(log).toHaveLength(1)
})

test('an empty log reports that there is nothing yet', async () => {
  expect(report([])).toBe('No turns logged yet. Each finished turn adds one.')
})

test('the report counts turns above, at and below their suggestion', async () => {
  const text = report([
    one('low', 'low', 100),
    one('low', 'medium', 100),
    one('low', 'max', 100),
    one('high', 'medium', 100),
    one('medium', 'xhigh', 100),
  ])

  expect(text).toContain('Effort stats: 5 turns, 500 output tokens')
  expect(text).toContain('Used the suggested level: 1 · above it: 3 · below it: 1')
})

test('there is a line per suggested level, naming each level used', async () => {
  const lines = report([
    one('low', 'low', 100),
    one('low', 'low', 300),
    one('low', 'xhigh', 350),
    one('high', 'max', 4000),
  ]).split('\n')

  expect(lines).toContain('Scored low: 200 at low (2) · 350 at xhigh (1)')
  expect(lines).toContain('Scored high: 4,000 at max (1)')
  expect(lines.some(line => line.startsWith('Scored medium'))).toBe(false)
})

test('no estimate is given from fewer than three turns at the suggestion', async () => {
  const text = report([
    one('low', 'low', 100),
    one('low', 'low', 100),
    one('low', 'high', 900),
  ])

  expect(text).toContain('No estimate yet: it needs 3 turns')
})

test('the estimate is the cost over the average at the suggested level', async () => {
  const text = report([
    one('low', 'low', 100),
    one('low', 'low', 200),
    one('low', 'low', 300),
    one('low', 'high', 1200),
    one('low', 'max', 2200),
    // No baseline for medium prompts: left out of the estimate.
    one('medium', 'max', 9000),
  ])

  expect(text).toContain(
    '2 turns run above their suggestion cost about 3,000 output tokens more than your average at the suggested level.',
  )
})

test('the estimate says so when running higher cost less', async () => {
  const text = report([
    one('low', 'low', 500),
    one('low', 'low', 500),
    one('low', 'low', 500),
    one('low', 'high', 100),
  ])

  expect(text).toContain('cost about 400 output tokens less')
})
