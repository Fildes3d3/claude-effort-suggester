import { expect, test } from 'claude-code/testing'

import type { Level } from '../types'
import { classify } from './classify'
import { CONFIG } from './config'

const STACK = `TypeError: Cannot read properties of undefined (reading 'id')
    at getUser (src/services/user.ts:42:17)
    at handler (src/routes/login.ts:18:9)`

const CASES: [Level, string][] = [
  // low
  ['low', 'what is a closure?'],
  ['low', 'fix the typo in README.md'],
  ['low', 'rename foo to bar in utils.ts'],
  ['low', 'quick question: is let or const better here?'],
  ['low', "what's the git command to undo the last commit"],

  // medium
  ['medium', 'add a loading spinner to the login button'],
  ['medium', 'write a function that reverses a string and add a test for it'],
  ['medium', 'explain how the event loop works in node'],
  ['medium', 'update the footer copyright year and link it to the about page'],
  ['medium', 'add a created_at column to the notes table in schema.sql'],

  // high
  ['high', 'refactor the auth module to use the new session store'],
  ['high', `why does this test fail?\n\n${STACK}`],
  ['high', 'debug the checkout flow, payments sometimes get charged twice'],
  [
    'high',
    'design a caching layer for the notes API in src/api/notes.ts and src/api/cache.ts',
  ],
  ['high', 'investigate the slow page load on /notes and fix it'],

  // max
  [
    'max',
    'design the architecture for multi-tenant billing, compare the approaches and plan the migration',
  ],
  [
    'max',
    `refactor error handling across the codebase. It starts in src/a.ts, src/b.ts and src/c.ts.\n\n${STACK}`,
  ],
  [
    'max',
    'investigate why does the worker leak memory, compare heap snapshots and find the root cause',
  ],
  [
    'max',
    `migrate the app from REST to GraphQL:
1. audit every endpoint
2. plan the schema
3. rewrite the resolvers
4. update the frontend calls
also keep the old routes working`,
  ],
  [
    'max',
    'debug the race condition in the job queue, then redesign the locking and evaluate the performance impact',
  ],
]

for (const [level, prompt] of CASES) {
  test(`${level}: ${prompt.replace(/\n[\s\S]*/, '').slice(0, 60)}`, async () => {
    expect(classify(prompt).level).toBe(level)
  })
}

test('the reason names the level and its strongest signals', async () => {
  const result = classify(`refactor src/a.ts\n\n${STACK}`)

  expect(result.reason).toBe('high: refactor + stack trace + 1 file')
})

test('keywords inside a pasted code block do not count', async () => {
  const result = classify('add a comment here\n```\n// refactor debug design\n```')

  expect(result.level).toBe('medium')
})

// --- Each signal on its own -----------------------------------------------

/** Six words that are no keyword: neither a short prompt nor a long one. */
const PLAIN = 'please update the footer link colour'

const labels = (prompt: string) => classify(prompt).signals.map(one => one.label)
const signal = (prompt: string, label: string) =>
  classify(prompt).signals.find(one => one.label === label)

test('a prompt with no signal sits at the base score', async () => {
  const result = classify(PLAIN)

  expect(result.signals).toEqual([])
  expect(result.score).toBe(CONFIG.base)
  expect(result.reason).toBe('medium: no strong signals')
})

test('the score is the base plus every signal', async () => {
  for (const [, prompt] of CASES) {
    const { score, signals } = classify(prompt)
    const sum = signals.reduce((total, one) => total + one.score, CONFIG.base)

    expect(score).toBe(sum)
  }
})

test('signals come strongest first', async () => {
  for (const [, prompt] of CASES) {
    const sizes = classify(prompt).signals.map(one => Math.abs(one.score))

    expect(sizes).toEqual([...sizes].sort((a, b) => b - a))
  }
})

test('the same prompt always gives the same result', async () => {
  const prompt = `refactor src/a.ts and also debug it\n\n${STACK}`

  expect(classify(prompt)).toEqual(classify(prompt))
})

test('an empty prompt is scored, not refused', async () => {
  expect(classify('').level).toBe('medium')
  expect(classify('   \n ').level).toBe('medium')
})

test('a short prompt counts down, up to the word limit', async () => {
  expect(signal('one two three four five', 'short prompt')?.score).toBe(-1)
  expect(signal('one two three four five six', 'short prompt')).toBeUndefined()
})

test('a long prompt counts up by its length row', async () => {
  const words = (count: number) => 'word '.repeat(count)

  expect(signal(words(39), 'long prompt')).toBeUndefined()
  expect(signal(words(40), 'long prompt')?.score).toBe(1)
  expect(signal(words(120), 'long prompt')?.score).toBe(2)
  expect(signal(words(300), 'long prompt')?.score).toBe(3)
})

test('questions, list items and joiners each count as an ask', async () => {
  expect(labels(`${PLAIN}?`)).toEqual([])
  expect(signal(`is it slow? ${PLAIN}?`, '2 asks')?.score).toBe(1)
  expect(signal(`${PLAIN} and also the header`, '2 asks')?.score).toBe(1)
  expect(signal(`${PLAIN}\n- one\n- two`, '2 asks')?.score).toBe(1)
  expect(signal(`${PLAIN}\n1. one\n2) two\n* three\n• four`, '4 asks')?.score).toBe(2)
})

test('keywords match whole words, in any case, with common endings', async () => {
  expect(labels(`${PLAIN} while REFACTORING`)).toContain('refactor')
  expect(labels(`${PLAIN} once debugged`)).toContain('debug')
  expect(labels(`${PLAIN} while debugging`)).toContain('debug')
  expect(labels(`${PLAIN} after migrating`)).toContain('migrate')
  expect(labels(`${PLAIN} it migrates`)).toContain('migrate')
  expect(labels(`${PLAIN} with planning`)).toContain('plan')
  expect(labels(`${PLAIN} after comparing`)).toContain('compare')
  expect(labels(`${PLAIN} with two redesigns`)).toContain('redesign')
})

test('keywords inside longer words do not match', async () => {
  const found = labels('pick the typography for the planet page, it is well-designed')

  expect(found).not.toContain('typo')
  expect(found).not.toContain('plan')
  expect(found).not.toContain('design')
})

test('a phrase keyword matches as a phrase', async () => {
  expect(labels(`${PLAIN} across the codebase`)).toContain('across the codebase')
  expect(labels('why does it fail on the second run')).toContain('why does')
})

test('each keyword group counts at most its cap', async () => {
  const higher = classify(`${PLAIN} refactor debug migrate design rewrite`)
  const lower = classify(`${PLAIN} quick typo rename simple`)

  expect(higher.signals.filter(one => one.score === CONFIG.higher.score)).toHaveLength(
    CONFIG.higher.cap,
  )
  expect(lower.signals.filter(one => one.score === CONFIG.lower.score)).toHaveLength(
    CONFIG.lower.cap,
  )
})

test('research words count as their own group', async () => {
  expect(signal(`${PLAIN} then compare both`, 'compare')?.score).toBe(
    CONFIG.research.score,
  )
})

test('a code block counts, closed or not', async () => {
  expect(signal(`${PLAIN}\n\`\`\`\nconst a = 1\n\`\`\``, 'code block')?.score).toBe(1)
  expect(signal(`${PLAIN}\n\`\`\`\nconst a = 1`, 'code block')?.score).toBe(1)
  expect(signal(PLAIN, 'code block')).toBeUndefined()
})

test('keywords inside an unclosed code block do not count either', async () => {
  expect(labels(`${PLAIN}\n\`\`\`\n// refactor debug`)).toEqual(['code block'])
})

test('stack traces are recognised across languages', async () => {
  const traces = [
    STACK,
    'Traceback (most recent call last):\n  File "app.py", line 3, in <module>',
    '  File "app.py", line 3, in main',
    'panic: runtime error: index out of range',
    'fatal error: all goroutines are asleep',
    'java.lang.NullPointerException: Cannot invoke "String.length()"',
    '    at com.example.Main.run(Main.java:12)',
  ]

  for (const trace of traces) {
    expect(signal(`${PLAIN}\n${trace}`, 'stack trace')?.score).toBe(
      CONFIG.stackTrace,
    )
  }
  expect(signal(`${PLAIN}, no error here`, 'stack trace')).toBeUndefined()
})

test('files count once each, by path or by name', async () => {
  expect(signal(`${PLAIN} in utils.ts`, '1 file')?.score).toBe(1)
  expect(signal(`${PLAIN} in src/lib/utils.ts`, '1 file')?.score).toBe(1)
  expect(signal(`${PLAIN} in a.ts, then a.ts again`, '1 file')?.score).toBe(1)
  expect(signal(`${PLAIN} in a.ts and b.py`, '2 files')?.score).toBe(1)
  expect(signal(`${PLAIN} in a.ts, b.py, c.go`, '3 files')?.score).toBe(2)
})

test('files named only in stack frames are not counted', async () => {
  const found = labels(`${PLAIN}\n${STACK}`)

  expect(found).toContain('stack trace')
  expect(found.some(label => label.endsWith('file') || label.endsWith('files'))).toBe(
    false,
  )
})

test('a version number or a sentence end is not a file', async () => {
  expect(labels('please bump the package to 2.1.3 today. Thanks a lot')).toEqual([])
})

// --- Thresholds and reasons -----------------------------------------------

test('each threshold is the lowest score for its level', async () => {
  const at = (base: number) => classify(PLAIN, { ...CONFIG, base }).level
  const { medium, high, max } = CONFIG.thresholds

  expect(at(medium - 1)).toBe('low')
  expect(at(medium)).toBe('medium')
  expect(at(high - 1)).toBe('medium')
  expect(at(high)).toBe('high')
  expect(at(max - 1)).toBe('high')
  expect(at(max)).toBe('max')
})

test('a config passed in replaces the default one', async () => {
  const config = {
    ...CONFIG,
    higher: { score: 9, cap: 1, words: ['banana'] },
  }

  expect(signal(`${PLAIN} banana`, 'banana')).toBeUndefined()
  expect(classify(`${PLAIN} banana`, config).reason).toBe('max: banana')
  expect(classify(`${PLAIN} refactor`, config).signals).toEqual([])
})

test('a low result is explained by what pulled it down', async () => {
  expect(classify('what is a closure?').reason).toBe('low: what is + short prompt')
})

test('a result is explained by what pushed it up, not what pulled down', async () => {
  const result = classify('quick: refactor, debug and migrate the design')

  expect(result.level).toBe('high')
  expect(result.reason).not.toContain('quick')
})

test('the reason names at most three signals', async () => {
  const { reason } = classify(
    `refactor, debug and migrate src/a.ts, then compare and plan\n\n${STACK}`,
  )

  expect(reason.split(' + ')).toHaveLength(3)
})

// --- Learned words --------------------------------------------------------

test('learned words add a signal of their own', async () => {
  const dictionary = { footer: { turns: 10, lean: 20 } }
  const result = classify(PLAIN, CONFIG, dictionary)

  expect(result.signals).toEqual([{ label: 'learned: footer', score: 2 }])
  expect(result.level).toBe('high')
  expect(result.reason).toBe('high: learned: footer')
})

test('learned words can lower a level too', async () => {
  const dictionary = { footer: { turns: 10, lean: -20 } }

  expect(classify(PLAIN, CONFIG, dictionary).level).toBe('low')
})

test('with no dictionary nothing is learned', async () => {
  expect(labels(PLAIN).some(label => label.startsWith('learned'))).toBe(false)
})

test('learned words inside pasted code do not count', async () => {
  const dictionary = { secretword: { turns: 10, lean: 20 } }
  const result = classify(`${PLAIN}\n\`\`\`\nsecretword\n\`\`\``, CONFIG, dictionary)

  expect(result.signals.map(one => one.label)).toEqual(['code block'])
})
