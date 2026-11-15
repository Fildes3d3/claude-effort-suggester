import { expect, test } from 'claude-code/testing'

import type { Level } from '../types'
import { classify } from './classify'

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
