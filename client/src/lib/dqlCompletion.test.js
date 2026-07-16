/*
 * SPDX-FileCopyrightText: © 2017-2026 Istari Digital, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  analyzeCompletionContext,
  completionsForContext,
} from './dqlCompletion'

const PREDICATES = [
  // Unindexed. Legal to traverse and to has(), illegal to eq() on.
  { predicate: 'name', type: 'string' },
  { predicate: 'title', type: 'string', index: true, tokenizer: ['exact'] },
  { predicate: 'bio', type: 'string', index: true, tokenizer: ['fulltext'] },
  { predicate: 'tags', type: 'string', index: true, tokenizer: ['term'] },
  { predicate: 'code', type: 'string', index: true, tokenizer: ['hash'] },
  { predicate: 'pattern', type: 'string', index: true, tokenizer: ['trigram'] },
  { predicate: 'age', type: 'int', index: true, tokenizer: ['int'] },
  { predicate: 'loc', type: 'geo', index: true, tokenizer: ['geo'] },
  { predicate: 'friend', type: 'uid', list: true },
]
const TYPES = [{ name: 'Person' }, { name: 'Animal' }]

const ctx = (textWithCursor) =>
  analyzeCompletionContext(textWithCursor.replace('|', ''), {
    // cursor offset is the marker position
    cursor: textWithCursor.indexOf('|'),
  })

const complete = (textWithCursor, extra = {}) =>
  completionsForContext(ctx(textWithCursor), {
    predicates: PREDICATES,
    types: TYPES,
    words: [],
    ...extra,
  }).map((c) => c.text)

describe('analyzeCompletionContext', () => {
  it('knows the position right after func: is a root-function position', () => {
    expect(ctx('{ q(func: |').kind).toBe('rootFunction')
    expect(ctx('{ q(func: e|').kind).toBe('rootFunction')
    expect(ctx('{ q(func:|').kind).toBe('rootFunction')
  })

  it('knows the first argument of a function is an argument position', () => {
    expect(ctx('{ q(func: eq(|')).toMatchObject({
      kind: 'functionArg',
      fn: 'eq',
      argIndex: 0,
    })
    expect(ctx('{ q(func: eq(ti|')).toMatchObject({
      kind: 'functionArg',
      fn: 'eq',
      argIndex: 0,
    })
  })

  it('counts arguments so the value slot is not mistaken for a predicate slot', () => {
    expect(ctx('{ q(func: eq(name, |')).toMatchObject({
      kind: 'functionArg',
      fn: 'eq',
      argIndex: 1,
    })
  })

  it('does not count commas inside string literals', () => {
    // The comma in "a, b" is data, not an argument separator.
    expect(ctx('{ q(func: eq(name, "a, b"), |')).not.toMatchObject({
      fn: 'eq',
      argIndex: 0,
    })
    expect(ctx('{ q(func: anyofterms(tags, "a, b"|')).toMatchObject({
      kind: 'functionArg',
      fn: 'anyofterms',
      argIndex: 1,
    })
  })

  it('treats a query block body as a bare body position', () => {
    expect(ctx('{ q(func: eq(name, "x")) { |').kind).toBe('body')
    expect(ctx('{ q(func: has(name)) { fri|').kind).toBe('body')
  })

  it('understands nested filter functions', () => {
    expect(ctx('{ q(func: has(name)) @filter(eq(|')).toMatchObject({
      kind: 'functionArg',
      fn: 'eq',
      argIndex: 0,
    })
  })

  it('offers functions directly inside @filter(', () => {
    expect(ctx('{ q(func: has(name)) @filter(|').kind).toBe('rootFunction')
  })

  it('extracts the partial term being typed', () => {
    expect(ctx('{ q(func: eq(ti|').term).toBe('ti')
    expect(ctx('{ q(func: eq(|').term).toBe('')
  })
})

describe('completionsForContext: root-function positions', () => {
  // The card this came from claimed predicates belong after func:. They do not.
  it('offers root functions after func:, never predicates', () => {
    const list = complete('{ q(func: |')

    expect(list).toEqual(expect.arrayContaining(['eq', 'has', 'type', 'near']))
    expect(list).not.toContain('name')
    expect(list).not.toContain('title')
  })

  it('offers no predicate even when the typed term matches one', () => {
    // `name` would fuzzy-match here if predicates were in the candidate pool.
    const list = complete('{ q(func: na|')
    expect(list).not.toContain('name')
  })
})

describe('completionsForContext: argument positions honour type and tokenizer', () => {
  it('offers exact-indexed title but not unindexed name to eq()', () => {
    const list = complete('{ q(func: eq(|')

    expect(list).toContain('title')
    expect(list).not.toContain('name')
  })

  it('offers both title and name at a bare body position', () => {
    const list = complete('{ q(func: has(title)) { |')

    expect(list).toContain('title')
    expect(list).toContain('name')
  })

  it('offers any predicate to has(), indexed or not', () => {
    const list = complete('{ q(func: has(|')

    expect(list).toContain('name')
    expect(list).toContain('title')
  })

  it('offers only term-indexed predicates to allofterms()', () => {
    const list = complete('{ q(func: allofterms(|')

    expect(list).toContain('tags')
    expect(list).not.toContain('bio')
    expect(list).not.toContain('title')
    expect(list).not.toContain('name')
  })

  it('offers only fulltext-indexed predicates to alloftext()', () => {
    const list = complete('{ q(func: alloftext(|')

    expect(list).toContain('bio')
    expect(list).not.toContain('tags')
    expect(list).not.toContain('title')
  })

  it('offers only trigram-indexed predicates to regexp()', () => {
    const list = complete('{ q(func: regexp(|')

    expect(list).toContain('pattern')
    expect(list).not.toContain('title')
  })

  it('offers only geo-indexed predicates to near()', () => {
    const list = complete('{ q(func: near(|')

    expect(list).toContain('loc')
    expect(list).not.toContain('title')
  })

  it('excludes hash-indexed predicates from inequalities, which hash cannot serve', () => {
    // hash is not order-preserving, so lt/gt cannot use it even though
    // `index: true` is set. Legality depends on tokenizer, not on index alone.
    const ltList = complete('{ q(func: lt(|')

    expect(ltList).toContain('age')
    expect(ltList).toContain('title')
    expect(ltList).not.toContain('code')

    // ...but eq is perfectly happy with hash.
    expect(complete('{ q(func: eq(|')).toContain('code')
  })

  it('offers type names, not predicates, to type()', () => {
    const list = complete('{ q(func: type(|')

    expect(list).toContain('Person')
    expect(list).not.toContain('name')
  })

  it('offers only uid-typed edges to uid_in()', () => {
    const list = complete('{ q(func: uid_in(|')

    expect(list).toContain('friend')
    expect(list).not.toContain('title')
  })

  it('offers nothing predicate-ish in a value slot', () => {
    const list = complete('{ q(func: eq(title, |')
    expect(list).not.toContain('name')
    expect(list).not.toContain('title')
  })
})

describe('completionsForContext: inside string literals', () => {
  it('knows the cursor is inside an unterminated string literal', () => {
    expect(ctx('{ q(func: eq(title, "goo|').inString).toBe(true)
    expect(ctx('{ q(func: eq(title, "done") { |').inString).toBe(false)
  })

  it('suggests nothing inside a quoted value', () => {
    // The user is typing data, not schema. `name` must not be offered here
    // just because it fuzzy-matches what they typed.
    expect(complete('{ q(func: has(x)) @filter(eq(title, "nam|')).toEqual([])
  })
})

describe('completionsForContext: directives', () => {
  it('completes a directive without doubling its @', () => {
    // The term must carry the @, otherwise `@fil` + `@filter` splices to
    // `@@filter`.
    const context = ctx('{ q(func: has(x)) @fil|')
    expect(context.term).toBe('@fil')

    const list = completionsForContext(context, {
      predicates: PREDICATES,
      types: TYPES,
      words: ['@filter', '@cascade'],
    })
    expect(list.map((c) => c.text)).toContain('@filter')
  })
})

describe('completionsForContext: result cap', () => {
  it('caps the list so a huge schema cannot stall the hint popup', () => {
    const many = []
    for (let i = 0; i < 2000; i++) {
      many.push({ predicate: `pred_${i}`, type: 'string' })
    }
    // Ctrl-Space at a body position with no term: every predicate matches.
    const list = completionsForContext(ctx('{ q(func: has(x)) { |'), {
      predicates: many,
      types: [],
      words: [],
    })
    expect(list.length).toBeLessThanOrEqual(200)
  })
})

describe('completionsForContext: honest labelling', () => {
  it('labels what actually backs each suggestion', () => {
    const [tags] = completionsForContext(ctx('{ q(func: allofterms(ta|'), {
      predicates: PREDICATES,
      types: TYPES,
      words: [],
    })

    expect(tags.text).toBe('tags')
    expect(tags.detail).toContain('term')
    expect(tags.detail).toContain('string')
  })

  it('does not describe a term index as full-text', () => {
    const [tags] = completionsForContext(ctx('{ q(func: allofterms(ta|'), {
      predicates: PREDICATES,
      types: TYPES,
      words: [],
    })
    expect(tags.detail).not.toContain('fulltext')
  })

  it('marks an unindexed predicate as unindexed at a body position', () => {
    const list = completionsForContext(ctx('{ q(func: has(x)) { nam|'), {
      predicates: PREDICATES,
      types: TYPES,
      words: [],
    })
    const name = list.find((c) => c.text === 'name')
    expect(name.detail).toContain('no index')
  })
})

describe('completionsForContext: matching', () => {
  it('filters by the typed term', () => {
    expect(complete('{ q(func: eq(ti|')).toEqual(['title'])
  })

  it('ranks a prefix match above a looser match', () => {
    const list = complete('{ q(func: has(ag|')
    expect(list[0]).toBe('age')
  })

  it('includes ui keywords and type names at body positions', () => {
    const list = complete('{ q(func: has(x)) { Pers|', { words: ['expand'] })
    expect(list).toContain('Person')
  })
})

describe('completionsForContext: performance', () => {
  it('completes a keystroke against a 2000-predicate schema in under 16ms', () => {
    const many = []
    for (let i = 0; i < 2000; i++) {
      many.push({
        predicate: `predicate_number_${i}`,
        type: 'string',
        index: true,
        tokenizer: ['exact'],
      })
    }

    const context = ctx('{ q(func: eq(pre|')
    const pool = { predicates: many, types: TYPES, words: [] }

    // Warm up, then take the median of many runs so one GC pause cannot
    // decide the result.
    for (let i = 0; i < 20; i++) {
      completionsForContext(context, pool)
    }

    const timings = []
    for (let i = 0; i < 51; i++) {
      const t0 = performance.now()
      completionsForContext(context, pool)
      timings.push(performance.now() - t0)
    }
    timings.sort((a, b) => a - b)
    const median = timings[25]

    expect(completionsForContext(context, pool).length).toBeGreaterThan(0)
    expect(median).toBeLessThan(16)
  })
})
