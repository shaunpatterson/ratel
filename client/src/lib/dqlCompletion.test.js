/*
 * SPDX-FileCopyrightText: © 2017-2026 Istari Digital, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  TOKEN_BEFORE_CURSOR,
  getCompletions,
  makeCompletionSource,
  sortMatches,
  termMatchesWord,
} from './dqlCompletion'

describe('termMatchesWord', () => {
  it('matches a strict prefix with weight equal to the term length', () => {
    expect(termMatchesWord('fun', 'func')).toEqual([true, 3])
  })

  it('matches case-insensitively against the word', () => {
    expect(termMatchesWord('per', 'Person')).toEqual([true, 3])
  })

  it('matches a fuzzy subsequence with a lower weight than a prefix', () => {
    const [matched, weight] = termMatchesWord('fnc', 'func')
    expect(matched).toBe(true)
    expect(weight).toBeLessThan(3)
  })

  it('rejects a term longer than the word', () => {
    expect(termMatchesWord('function', 'func')).toEqual([false, 0])
  })

  it('rejects a term that is not a subsequence of the word', () => {
    const [matched] = termMatchesWord('xyz', 'func')
    expect(matched).toBe(false)
  })
})

describe('sortMatches', () => {
  it('orders higher weights first', () => {
    expect([[1, 'b'], [3, 'a']].sort(sortMatches)).toEqual([
      [3, 'a'],
      [1, 'b'],
    ])
  })

  it('breaks weight ties alphabetically, ignoring case', () => {
    expect([[1, 'b'], [1, 'A']].sort(sortMatches)).toEqual([
      [1, 'A'],
      [1, 'b'],
    ])
  })
})

describe('getCompletions', () => {
  const words = ['func', 'filter', 'first', 'name', '<name>', 'Person']

  it('returns prefix matches ranked before fuzzy matches', () => {
    const result = getCompletions('f', words)
    expect(result[0]).toBe('filter')
    expect(result).toContain('func')
    expect(result).toContain('first')
  })

  it('returns the original casing of matched words', () => {
    expect(getCompletions('pers', words)).toEqual(['Person'])
  })

  it('matches angle-bracketed predicates', () => {
    expect(getCompletions('<na', words)).toEqual(['<name>'])
  })

  it('returns an empty list for an empty term', () => {
    expect(getCompletions('', words)).toEqual([])
    expect(getCompletions('   ', words)).toEqual([])
  })

  it('returns an empty list for quoted terms (filter string values)', () => {
    expect(getCompletions('"al', words)).toEqual([])
  })

  it('deduplicates repeated words', () => {
    expect(getCompletions('name', ['name', 'name', '<name>'])).toEqual([
      'name',
      '<name>',
    ])
  })
})

describe('TOKEN_BEFORE_CURSOR', () => {
  it('matches predicate, directive and angle-bracket tokens', () => {
    expect('{ q(func: ha'.match(TOKEN_BEFORE_CURSOR)[0]).toBe('ha')
    expect('{ name @fil'.match(TOKEN_BEFORE_CURSOR)[0]).toBe('@fil')
    expect('{ <dgraph.ty'.match(TOKEN_BEFORE_CURSOR)[0]).toBe('<dgraph.ty')
  })

  it('does not match after whitespace or an open paren', () => {
    expect('{ q '.match(TOKEN_BEFORE_CURSOR)).toBeNull()
    expect('{ q('.match(TOKEN_BEFORE_CURSOR)).toBeNull()
  })
})

describe('makeCompletionSource', () => {
  // A minimal stand-in for a CodeMirror 6 CompletionContext over a
  // one-line document with the cursor at the end.
  const makeContext = (line, explicit = false) => ({
    explicit,
    matchBefore: (regex) => {
      const match = line.match(regex)
      if (!match) {
        return null
      }
      return {
        from: line.length - match[0].length,
        to: line.length,
        text: match[0],
      }
    },
  })

  it('completes the token before the cursor at the right position', () => {
    const source = makeCompletionSource(() => ['func', 'filter'])
    const result = source(makeContext('{ q(fu'))
    expect(result.from).toBe(4)
    expect(result.options.map((o) => o.label)).toEqual(['func'])
    expect(result.filter).toBe(false)
  })

  it('returns null when there is no token before the cursor', () => {
    const source = makeCompletionSource(() => ['func'])
    expect(source(makeContext('{ q( '))).toBeNull()
  })

  it('returns null when nothing matches the token', () => {
    const source = makeCompletionSource(() => ['func'])
    expect(source(makeContext('{ zzz'))).toBeNull()
  })

  it('reads the word list lazily on each request', () => {
    let words = []
    const source = makeCompletionSource(() => words)
    expect(source(makeContext('{ fu'))).toBeNull()
    words = ['func']
    expect(source(makeContext('{ fu')).options).toHaveLength(1)
  })
})
