// Every weight and keyword the classifier uses. Edit here, nowhere else.
//
// A prompt starts at `base`, each signal adds or subtracts, and the total
// maps to a level through `thresholds` (the lowest score for each level;
// anything under `medium` is low).
//
// Keywords match whole words or phrases, case-insensitive, with their common
// endings: "refactor" also matches refactoring, "debug" debugging, "migrate"
// migrated and migrating. Each group counts at most `cap` distinct hits.

export const CONFIG = {
  base: 2,

  thresholds: { medium: 1, high: 4, max: 8 },

  // Word count: the first row whose `minWords` the prompt reaches applies.
  length: [
    { minWords: 300, score: 3 },
    { minWords: 120, score: 2 },
    { minWords: 40, score: 1 },
  ],
  // At most this many words counts as a short prompt.
  short: { maxWords: 5, score: -1 },

  // Distinct asks: question marks, list items, "also" / "and then" / ...
  asks: [
    { min: 4, score: 2 },
    { min: 2, score: 1 },
  ],
  askJoiners: ['also', 'and then', 'after that', 'additionally', 'as well as'],

  lower: {
    score: -3,
    cap: 2,
    words: [
      'quick',
      'quickly',
      'typo',
      'rename',
      'what is',
      "what's",
      'one-liner',
      'simple',
      'trivial',
      'reformat',
      'spelling',
    ],
  },

  higher: {
    score: 2,
    cap: 3,
    words: [
      'refactor',
      'architecture',
      'debug',
      'migrate',
      'migration',
      'design',
      'redesign',
      'across the codebase',
      'why does',
      'why is',
      'root cause',
      'race condition',
      'deadlock',
      'memory leak',
      'rewrite',
      'optimize',
      'performance',
      'security',
      'concurrency',
    ],
  },

  research: {
    score: 2,
    cap: 2,
    words: [
      'compare',
      'plan',
      'investigate',
      'research',
      'evaluate',
      'audit',
      'trade-off',
      'tradeoff',
      'pros and cons',
      'step by step',
      'end to end',
    ],
  },

  codeBlock: 1,
  stackTrace: 2,

  // Distinct file paths or file names mentioned.
  files: [
    { min: 3, score: 2 },
    { min: 1, score: 1 },
  ],

  // Words learned from your own turns (see hooks/words.ts). A word counts
  // once it was in `minTurns` turns that leaned at least `minLean` from the
  // usual cost (1 is twice the usual, -1 half). The strongest `maxWords` of
  // a prompt add up to at most `cap`, either way.
  learned: { minTurns: 5, minLean: 0.5, maxWords: 3, cap: 2 },
}

export type Config = typeof CONFIG
