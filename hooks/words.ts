// The learned dictionary: which of the person's own words turn up in turns
// that cost more, or less, than their usual. Pure functions; the hooks
// module does the storing.
//
// Only single words are kept, never a prompt, and only on this machine.

import { CONFIG, type Config } from './config'

/** One word: the turns it appeared in, and how those turns leaned in total. */
export type WordStat = { turns: number; lean: number }

export type Dictionary = Record<string, WordStat>

/** The dictionary keeps its most used words only. */
export const MAX_WORDS = 2000

/** One turn moves a word by at most this much: 3 is eight times the usual. */
const MAX_LEAN = 3

const STOP = new Set(
  `the and for that this with from have has had are was were been will would
  can could should may might must not but you your our their its his her they
  them there here what when where which who whom whose why how all any some
  each every one two also just only than then into onto out off over under
  about after before again more most much many such very too does did doing
  done get got make made use used using want need like please thanks thank
  let lets its it's i'm i've don't doesn't can't isn't it is to of in on at
  as be by or an if so do we me my up no yes ok okay now new still`.split(/\s+/),
)

/** Words the config already scores: the dictionary has nothing to add there. */
const scored = (config: Config) =>
  new Set(
    [...config.lower.words, ...config.higher.words, ...config.research.words]
      .concat(config.askJoiners)
      .filter(word => !word.includes(' ')),
  )

/**
 * The distinct words of a prompt's prose worth learning from: lower case,
 * three letters or more, no stop words, no keyword the config scores.
 */
export const wordsOf = (prose: string, config: Config = CONFIG): string[] => {
  const known = scored(config)
  const found = prose.toLowerCase().match(/[a-z][a-z'-]*[a-z]/g) ?? []

  return [
    ...new Set(
      found.filter(word => word.length >= 3 && !STOP.has(word) && !known.has(word)),
    ),
  ]
}

/**
 * How a turn leaned: 0 for a turn that cost the usual for its effort level,
 * 1 for twice that, -1 for half. Comparing within one level keeps the level
 * itself, which alone moves the cost, out of what the words are taught.
 */
export const leanOf = (output: number, usual: number) => {
  if (output <= 0 || usual <= 0) return 0

  return Math.max(-MAX_LEAN, Math.min(MAX_LEAN, Math.log2(output / usual)))
}

/** The dictionary after one more turn, with the least used words dropped. */
export const learn = (
  dictionary: Dictionary,
  words: string[],
  lean: number,
): Dictionary => {
  const next: Dictionary = { ...dictionary }
  for (const word of words) {
    const now = next[word] ?? { turns: 0, lean: 0 }
    next[word] = { turns: now.turns + 1, lean: now.lean + lean }
  }

  const all = Object.entries(next)
  if (all.length <= MAX_WORDS) return next

  return Object.fromEntries(
    all.sort((a, b) => b[1].turns - a[1].turns).slice(0, MAX_WORDS),
  )
}

const isStat = (value: unknown): value is WordStat => {
  if (typeof value !== 'object' || value === null) return false
  const one = value as Record<string, unknown>

  return typeof one.turns === 'number' && typeof one.lean === 'number'
}

/** What the store gave back, as a dictionary; anything else is dropped. */
export const parseDictionary = (stored: unknown): Dictionary => {
  if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) {
    return {}
  }

  return Object.fromEntries(Object.entries(stored).filter(([, one]) => isStat(one)))
}

type Leaning = { word: string; turns: number; average: number }

/** The words seen often enough, and leaning far enough, to count. */
const leaning = (dictionary: Dictionary, rules: Config['learned']): Leaning[] =>
  Object.entries(dictionary)
    .map(([word, one]) => ({
      word,
      turns: one.turns,
      average: one.lean / one.turns,
    }))
    .filter(
      one => one.turns >= rules.minTurns && Math.abs(one.average) >= rules.minLean,
    )
    .sort((a, b) => Math.abs(b.average) - Math.abs(a.average))

/**
 * What the dictionary adds to a prompt's score: the strongest few of its
 * words that count, summed, rounded and capped. Null when it adds nothing.
 */
export const learnedSignal = (
  words: string[],
  dictionary: Dictionary,
  rules: Config['learned'] = CONFIG.learned,
): { label: string; score: number } | null => {
  const found = leaning(dictionary, rules)
    .filter(one => words.includes(one.word))
    .slice(0, rules.maxWords)
  const sum = found.reduce((total, one) => total + one.average, 0)
  const score = Math.max(-rules.cap, Math.min(rules.cap, Math.round(sum)))
  if (score === 0) return null

  // Name the words that pull the way the total went.
  const named = found.filter(one => Math.sign(one.average) === Math.sign(score))

  return { label: `learned: ${named.map(one => one.word).join(', ')}`, score }
}

const line = (one: Leaning) =>
  `${one.word} (${one.turns} turns, ${one.average > 0 ? '+' : ''}${one.average.toFixed(1)})`

/** The report `/effort-words` prints. */
export const wordReport = (
  dictionary: Dictionary,
  rules: Config['learned'] = CONFIG.learned,
): string => {
  const total = Object.keys(dictionary).length
  if (total === 0) {
    return 'No words learned yet. Each finished turn teaches its prompt\'s words, once three turns at its effort level give a usual cost to compare with.'
  }

  const counted = leaning(dictionary, rules)
  const costly = counted.filter(one => one.average > 0).slice(0, 10)
  const cheap = counted.filter(one => one.average < 0).slice(0, 10)

  return [
    `Effort words: ${total} words seen, ${counted.length} counted in suggestions`,
    `A word counts after ${rules.minTurns} turns, when those turns leaned at least ${rules.minLean} (1.0 is twice the usual cost, -1.0 half).`,
    '',
    `In costlier turns: ${costly.map(line).join(' · ') || 'none yet'}`,
    `In cheaper turns: ${cheap.map(line).join(' · ') || 'none yet'}`,
  ].join('\n')
}
