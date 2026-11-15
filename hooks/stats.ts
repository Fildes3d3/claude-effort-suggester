// The usage log: one record per finished turn, and the report read from it.
// Pure functions; the hooks module does the storing.

import type { Level } from '../types'

export type TurnRecord = {
  /** When the turn ended, in ms since the epoch. */
  at: number
  /** The level the classifier gave the turn's prompt. */
  suggested: Level
  /** The level the turn's first request went out at. */
  used: string
  /** Output tokens of the turn: the thinking and the answer. */
  output: number
}

/** The log keeps the newest records only. */
export const MAX_RECORDS = 500

/** An average needs this many turns before the report builds on it. */
const MIN_SAMPLE = 3

const ORDER = ['low', 'medium', 'high', 'xhigh', 'max']
const SUGGESTED: Level[] = ['low', 'medium', 'high', 'max']

/** Where a level stands, lowest first; -1 for one that is no level. */
export const rank = (level: string) => ORDER.indexOf(level)

const isRecord = (value: unknown): value is TurnRecord => {
  if (typeof value !== 'object' || value === null) return false
  const one = value as Record<string, unknown>

  return (
    typeof one.at === 'number' &&
    typeof one.suggested === 'string' &&
    SUGGESTED.includes(one.suggested as Level) &&
    typeof one.used === 'string' &&
    typeof one.output === 'number'
  )
}

/**
 * The usual output of a turn at `level`, from the log: its average there,
 * or null while fewer than three turns ran at that level.
 */
export const usualAt = (log: TurnRecord[], level: string): number | null => {
  const group = log.filter(one => one.used === level)

  return group.length < MIN_SAMPLE ? null : mean(group)
}

/** What the store gave back, as records; anything else is dropped. */
export const parseLog = (stored: unknown): TurnRecord[] =>
  Array.isArray(stored) ? stored.filter(isRecord) : []

export const addRecord = (log: TurnRecord[], record: TurnRecord) =>
  [...log, record].slice(-MAX_RECORDS)

const count = (value: number) => Math.round(value).toLocaleString('en-US')

const mean = (records: TurnRecord[]) =>
  records.reduce((sum, one) => sum + one.output, 0) / records.length

/**
 * The report `/effort-stats` prints: how often the suggested level was the
 * one used, what a turn cost at each level, and what the turns run above
 * their suggestion cost over the person's own average at that suggestion.
 */
export const report = (log: TurnRecord[]): string => {
  if (log.length === 0) {
    return 'No turns logged yet. Each finished turn adds one.'
  }

  const total = log.reduce((sum, one) => sum + one.output, 0)
  const above = log.filter(one => rank(one.used) > rank(one.suggested))
  const below = log.filter(one => rank(one.used) < rank(one.suggested))
  const same = log.length - above.length - below.length

  // One line per kind of prompt: what it cost at each level it ran at. No
  // columns: command output is not drawn in a fixed-width font everywhere.
  const rows = SUGGESTED.filter(level =>
    log.some(one => one.suggested === level),
  ).map(suggested => {
    const cells = ORDER.flatMap(level => {
      const group = log.filter(
        one => one.suggested === suggested && one.used === level,
      )

      return group.length
        ? [`${count(mean(group))} at ${level} (${group.length})`]
        : []
    })

    return `Scored ${suggested}: ${cells.join(' · ')}`
  })

  // What turns run above their suggestion cost, against the person's own
  // average for that kind of prompt at the suggested level.
  let extra = 0
  let compared = 0
  for (const one of above) {
    const baseline = log.filter(
      other => other.suggested === one.suggested && other.used === one.suggested,
    )
    if (baseline.length < MIN_SAMPLE) continue

    extra += one.output - mean(baseline)
    compared += 1
  }

  const lines = [
    `Effort stats: ${log.length} turns, ${count(total)} output tokens`,
    `Used the suggested level: ${same} · above it: ${above.length} · below it: ${below.length}`,
    '',
    'Average output tokens per turn, by what the prompt scored (turns):',
    ...rows,
    '',
  ]

  if (compared === 0) {
    lines.push(
      `No estimate yet: it needs ${MIN_SAMPLE} turns run at their suggested level to compare with.`,
    )
  } else {
    lines.push(
      `${compared} turns run above their suggestion cost about ${count(Math.abs(extra))} output tokens ${extra >= 0 ? 'more' : 'less'} than your average at the suggested level.`,
    )
  }

  return lines.join('\n')
}
