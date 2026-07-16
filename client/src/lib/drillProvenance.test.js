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
})
