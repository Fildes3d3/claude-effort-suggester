import { expect, test } from 'claude-code/testing'

import { CONFIG } from './config'
import {
  leanOf,
  learn,
  learnedSignal,
  MAX_WORDS,
  parseDictionary,
  wordReport,
  wordsOf,
} from './words'
import type { Dictionary } from './words'

const RULES = CONFIG.learned

test('the words of a prompt are lower case, distinct and worth learning', async () => {
  expect(wordsOf('Deploy the Kubernetes cluster, then deploy it AGAIN')).toEqual([
    'deploy',
    'kubernetes',
    'cluster',
  ])
})

test('short words, numbers and stop words are left out', async () => {
  expect(wordsOf('we do it at 10 on v2 of the api with you')).toEqual(['api'])
})

test('words joined by a hyphen or an apostrophe stay whole', async () => {
  expect(wordsOf("the server-side cache won't warm")).toEqual([
    'server-side',
    'cache',
    "won't",
    'warm',
  ])
})

test('keywords the config already scores are left out', async () => {
  expect(wordsOf('refactor and compare the billing typo also')).toEqual(['billing'])
})

test('a turn at its usual cost leans nowhere; twice is 1, half is -1', async () => {
  expect(leanOf(1000, 1000)).toBe(0)
  expect(leanOf(2000, 1000)).toBe(1)
  expect(leanOf(500, 1000)).toBe(-1)
})

test('one turn moves a word by a bounded amount', async () => {
  expect(leanOf(1_000_000, 1)).toBe(3)
  expect(leanOf(1, 1_000_000)).toBe(-3)
})

test('a turn with no cost or no usual teaches nothing', async () => {
  expect(leanOf(0, 1000)).toBe(0)
  expect(leanOf(1000, 0)).toBe(0)
})

test('learning adds the turn to each of its words', async () => {
  const once = learn({}, ['deploy', 'cluster'], 1)
  const twice = learn(once, ['deploy'], 2)

  expect(once).toEqual({
    deploy: { turns: 1, lean: 1 },
    cluster: { turns: 1, lean: 1 },
  })
  expect(twice.deploy).toEqual({ turns: 2, lean: 3 })
  expect(twice.cluster).toEqual({ turns: 1, lean: 1 })
})

test('learning leaves the dictionary it was given alone', async () => {
  const before: Dictionary = { deploy: { turns: 1, lean: 1 } }
  learn(before, ['deploy'], 1)

  expect(before).toEqual({ deploy: { turns: 1, lean: 1 } })
})

test('a full dictionary drops its least used words', async () => {
  let dictionary: Dictionary = { keeper: { turns: 9, lean: 0 } }
  const many = Array.from({ length: MAX_WORDS + 10 }, (_, i) => `word${i}`)
  dictionary = learn(dictionary, many, 0)
  dictionary = learn(dictionary, ['word0'], 0)

  expect(Object.keys(dictionary)).toHaveLength(MAX_WORDS)
  expect(dictionary.keeper?.turns).toBe(9)
  expect(dictionary.word0?.turns).toBe(2)
})

test('what the store gives back is kept only where it is a word stat', async () => {
  expect(parseDictionary(undefined)).toEqual({})
  expect(parseDictionary('words')).toEqual({})
  expect(parseDictionary([{ turns: 1, lean: 1 }])).toEqual({})
  expect(
    parseDictionary({
      deploy: { turns: 2, lean: 1 },
      broken: { turns: '2', lean: 1 },
      missing: { turns: 2 },
      nothing: null,
    }),
  ).toEqual({ deploy: { turns: 2, lean: 1 } })
})

test('a word counts only after enough turns', async () => {
  const few: Dictionary = { deploy: { turns: RULES.minTurns - 1, lean: 10 } }
  const enough: Dictionary = { deploy: { turns: RULES.minTurns, lean: 10 } }

  expect(learnedSignal(['deploy'], few)).toBeNull()
  expect(learnedSignal(['deploy'], enough)).toEqual({
    label: 'learned: deploy',
    score: 2,
  })
})

test('a word counts only when its turns leaned far enough', async () => {
  const mild: Dictionary = { deploy: { turns: 10, lean: 4 } }

  expect(learnedSignal(['deploy'], mild)).toBeNull()
})

test('a word that is not in the prompt adds nothing', async () => {
  const dictionary: Dictionary = { deploy: { turns: 10, lean: 20 } }

  expect(learnedSignal(['cluster'], dictionary)).toBeNull()
})

test('learned words can pull a score down', async () => {
  const dictionary: Dictionary = { status: { turns: 10, lean: -12 } }

  expect(learnedSignal(['status'], dictionary)).toEqual({
    label: 'learned: status',
    score: -1,
  })
})

test('the learned score is capped either way', async () => {
  const dictionary: Dictionary = {
    deploy: { turns: 10, lean: 30 },
    cluster: { turns: 10, lean: 30 },
    status: { turns: 10, lean: -30 },
    ping: { turns: 10, lean: -30 },
  }

  expect(learnedSignal(['deploy', 'cluster'], dictionary)?.score).toBe(RULES.cap)
  expect(learnedSignal(['status', 'ping'], dictionary)?.score).toBe(-RULES.cap)
})

test('only the strongest few words of a prompt count', async () => {
  const dictionary: Dictionary = {
    one: { turns: 10, lean: 6 },
    two: { turns: 10, lean: 6 },
    three: { turns: 10, lean: 6 },
    four: { turns: 10, lean: 30 },
  }
  const rules = { ...RULES, cap: 99 }

  // four (3.0) and two of the 0.6 words: 4.2, rounded.
  expect(learnedSignal(['one', 'two', 'three', 'four'], dictionary, rules)?.score).toBe(4)
})

test('the label names the words that pull the way the total went', async () => {
  const dictionary: Dictionary = {
    deploy: { turns: 10, lean: 25 },
    status: { turns: 10, lean: -6 },
  }

  expect(learnedSignal(['deploy', 'status'], dictionary)).toEqual({
    label: 'learned: deploy',
    score: 2,
  })
})

test('words that cancel out add nothing', async () => {
  const dictionary: Dictionary = {
    deploy: { turns: 10, lean: 10 },
    status: { turns: 10, lean: -10 },
  }

  expect(learnedSignal(['deploy', 'status'], dictionary)).toBeNull()
})

test('an empty dictionary reports that nothing is learned yet', async () => {
  expect(wordReport({})).toContain('No words learned yet.')
})

test('the report lists the words that count, costlier and cheaper', async () => {
  const text = wordReport({
    deploy: { turns: 8, lean: 12 },
    status: { turns: 6, lean: -6 },
    rare: { turns: 1, lean: 3 },
  })

  expect(text).toContain('Effort words: 3 words seen, 2 counted in suggestions')
  expect(text).toContain('In costlier turns: deploy (8 turns, +1.5)')
  expect(text).toContain('In cheaper turns: status (6 turns, -1.0)')
  expect(text).not.toContain('rare')
})

test('the report says so when no word counts yet', async () => {
  const text = wordReport({ rare: { turns: 1, lean: 3 } })

  expect(text).toContain('In costlier turns: none yet')
  expect(text).toContain('In cheaper turns: none yet')
})
