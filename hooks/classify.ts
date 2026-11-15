// The rule-based classifier: a pure function of the prompt and the config.
// No model call, no I/O.

import type { Level } from '../types'
import { CONFIG, type Config } from './config'

export type Result = {
  level: Level
  score: number
  /** e.g. "high: refactor + stack trace" */
  reason: string
  /** Every signal that fired, strongest first. */
  signals: { label: string; score: number }[]
}

const STACK_TRACE = [
  /^\s+at .+:\d+(:\d+)?\)?\s*$/m, // JS / Java frames
  /Traceback \(most recent call last\)/, // Python
  /^\s*File ".+", line \d+/m,
  /^(panic|fatal error): /m, // Go
  /\b\w*(Error|Exception)\b: \S/,
]

const FILE =
  /(?:[\w.@-]+\/)+[\w.@-]+\.\w{1,5}\b|\b[\w-]+\.(?:tsx?|jsx?|mjs|py|go|rs|java|rb|php|css|scss|html|json|ya?ml|md|sql|sh|c|cpp|h|swift|kt|vue|twig|toml)\b/g

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const matcher = (word: string) =>
  new RegExp(`(?<![\\w-])${escape(word)}(?:s|ed|ing)?(?![\\w-])`, 'i')

/** The words of `group` found in `text`, at most `cap` of them. */
const hits = (text: string, group: { words: string[]; cap: number }) =>
  group.words.filter(word => matcher(word).test(text)).slice(0, group.cap)

const countAsks = (text: string, joiners: string[]) => {
  const questions = (text.match(/\?/g) ?? []).length
  const items = (text.match(/^\s*(?:[-*•]|\d+[.)])\s+\S/gm) ?? []).length
  const joined = joiners.filter(word => matcher(word).test(text)).length

  return Math.max(1, questions + items + joined)
}

const levelOf = (score: number, thresholds: Config['thresholds']): Level => {
  if (score >= thresholds.max) return 'max'
  if (score >= thresholds.high) return 'high'
  if (score >= thresholds.medium) return 'medium'

  return 'low'
}

export const classify = (prompt: string, config: Config = CONFIG): Result => {
  const signals: Result['signals'] = []
  const add = (label: string, score: number) => {
    if (score !== 0) signals.push({ label, score })
  }

  // Keywords are read from the prose, not from pasted code.
  const prose = prompt.replace(/```[\s\S]*?(```|$)/g, ' ')
  const words = prose.split(/\s+/).filter(Boolean).length

  const long = config.length.find(row => words >= row.minWords)
  if (long) add('long prompt', long.score)
  else if (words <= config.short.maxWords) add('short prompt', config.short.score)

  const asks = countAsks(prose, config.askJoiners)
  const many = config.asks.find(row => asks >= row.min)
  if (many) add(`${asks} asks`, many.score)

  for (const word of hits(prose, config.lower)) add(word, config.lower.score)
  for (const word of hits(prose, config.higher)) add(word, config.higher.score)
  for (const word of hits(prose, config.research)) add(word, config.research.score)

  if (prompt.includes('```')) add('code block', config.codeBlock)
  if (STACK_TRACE.some(pattern => pattern.test(prompt))) {
    add('stack trace', config.stackTrace)
  }

  // Files named in stack frames are the trace's, not asks of their own.
  const outsideTrace = prompt.replace(/^\s+at .+$|^\s*File ".+", line \d+.*$/gm, ' ')
  const files = new Set(outsideTrace.match(FILE) ?? []).size
  const fileRow = config.files.find(row => files >= row.min)
  if (fileRow) add(files === 1 ? '1 file' : `${files} files`, fileRow.score)

  const score = signals.reduce((sum, signal) => sum + signal.score, config.base)
  const level = levelOf(score, config.thresholds)

  // Name the signals that pushed toward the level picked.
  signals.sort((a, b) => Math.abs(b.score) - Math.abs(a.score))
  const toward = signals.filter(signal =>
    level === 'low' ? signal.score < 0 : signal.score > 0,
  )
  const named = (toward.length > 0 ? toward : signals).slice(0, 3)
  const why = named.map(signal => signal.label).join(' + ') || 'no strong signals'

  return { level, score, reason: `${level}: ${why}`, signals }
}
