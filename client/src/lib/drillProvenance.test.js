/*
 * SPDX-FileCopyrightText: © 2017-2026 Istari Digital, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import { isProvenanceUnambiguous } from './drillProvenance'

describe('isProvenanceUnambiguous', () => {
  it('accepts a plain query where every response key IS its predicate', () => {
    expect(isProvenanceUnambiguous('{ q(func: uid(0x1)) { name age } }')).toBe(
      true,
    )
  })

  it('accepts query-block keywords that legitimately use a colon', () => {
    expect(
      isProvenanceUnambiguous(
        '{ q(func: eq(name, "x"), first: 10, offset: 5, orderasc: age) { name } }',
      ),
    ).toBe(true)
  })

  it('ignores colons inside string literals and comments', () => {
    expect(
      isProvenanceUnambiguous('{ q(func: eq(name, "alias: bogus")) { name } }'),
    ).toBe(true)
    expect(
      isProvenanceUnambiguous('# alias: bogus\n{ q(func: uid(0x1)) { name } }'),
    ).toBe(true)
  })

  describe('refuses anything that breaks the key -> predicate identity', () => {
    it('aliases', () => {
      expect(
        isProvenanceUnambiguous('{ q(func: uid(0x1)) { myName: name } }'),
      ).toBe(false)
    })

    it('@normalize', () => {
      expect(
        isProvenanceUnambiguous('{ q(func: uid(0x1)) @normalize { name } }'),
      ).toBe(false)
    })

    it('@groupby', () => {
      expect(
        isProvenanceUnambiguous(
          '{ q(func: uid(0x1)) @groupby(age) { count(uid) } }',
        ),
      ).toBe(false)
    })

    it('aggregates', () => {
      expect(
        isProvenanceUnambiguous('{ q(func: uid(0x1)) { count(friend) } }'),
      ).toBe(false)
      expect(
        isProvenanceUnambiguous('{ q(func: uid(0x1)) { sum(val(x)) } }'),
      ).toBe(false)
      expect(
        isProvenanceUnambiguous('{ q(func: uid(0x1)) { math(a + b) } }'),
      ).toBe(false)
    })

    it('value variables', () => {
      expect(
        isProvenanceUnambiguous(
          '{ v as var(func: uid(0x1)) { x as age } q(func: uid(v)) { age } }',
        ),
      ).toBe(false)
    })
  })

  it('refuses empty or non-string input rather than assuming safety', () => {
    expect(isProvenanceUnambiguous('')).toBe(false)
    expect(isProvenanceUnambiguous(null)).toBe(false)
    expect(isProvenanceUnambiguous(undefined)).toBe(false)
  })

  // Strings and comments are MUTUALLY exclusive contexts: a `#` inside a string
  // is data, a `"` inside a comment is prose. Two ordered regex passes cannot
  // express that — whichever runs first wins on input the other one owns, and
  // the loser's construct survives into the scan un-neutralised. Both directions
  // are covered here so the pair can only be satisfied by a real scanner.
  describe('neutralisation must not be order-dependent', () => {
    it('refuses when a # inside a string literal precedes an alias', () => {
      // comments-first blanks from the `#` to EOL, eating `title: name`.
      expect(
        isProvenanceUnambiguous(
          '{ q(func: eq(name, "a#b")) { uid title: name } }',
        ),
      ).toBe(false)
    })

    it('refuses when a hex colour literal precedes @normalize', () => {
      expect(
        isProvenanceUnambiguous(
          '{ q(func: eq(colour, "#ff0000")) @normalize { n: name } }',
        ),
      ).toBe(false)
    })

    it('refuses when a quote inside a comment precedes an alias', () => {
      // strings-first pairs the comment's quote with the next real one, eating
      // the query between them. This is the mirror of the case above.
      expect(
        isProvenanceUnambiguous(
          '{ # say "hello\n q(func: eq(name, "x")) { uid title: name }\n}',
        ),
      ).toBe(false)
    })

    it('refuses an unterminated string rather than letting it swallow an alias', () => {
      // Not valid DQL — but the Pretty tab renders the SERVER ERROR for exactly
      // this query, so the gate is still asked about it, and a string that runs
      // to EOF hides everything after it.
      expect(
        isProvenanceUnambiguous(
          '{ q(func: eq(name, "x)) { uid title: name } }',
        ),
      ).toBe(false)
    })

    it('still sees an alias after an escaped quote inside a string', () => {
      expect(
        isProvenanceUnambiguous(
          '{ q(func: eq(name, "say \\"hi\\"")) { uid title: name } }',
        ),
      ).toBe(false)
    })
  })
})
