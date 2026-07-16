/*
 * SPDX-FileCopyrightText: © 2017-2026 Istari Digital, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import { buildExpandQuery, uidPredicates } from './expandQuery'

// buildExpandQuery documents that its RESPONSE is "provably <= budget nodes".
// That proof rests on a precondition the function never actually checked:
// exactly ONE root, and predicate names that survive interpolation intact.
//
// Both were interpolated straight into executable DQL. `uid()` legally accepts
// a LIST, so a uid of '0x1, 0x2, 0x3' silently creates three roots while
// perPredicateLimit still divides the budget as if there were one -- turning a
// budget of 500 into a measured 1500. And quotePredicate wrapped odd names in
// angle brackets, which is not escaping: a name containing '>' closed the
// bracket and emitted whatever followed as query text.
//
// These inputs come from parsed cluster data and query response keys rather
// than a typed boundary, so the module has to enforce its own precondition
// instead of trusting the caller to have already done it.

const ok = { predicates: ['friend'], budget: 500 }

describe('uid must be exactly one root', () => {
  test('a uid list is rejected rather than silently tripling the budget', () => {
    // Built `node(func: uid(0x1, 0x2, 0x3))` with `friend (first: 499)` --
    // three roots x 499 = up to 1500 nodes from a budget of 500.
    expect(() => buildExpandQuery({ ...ok, uid: '0x1, 0x2, 0x3' })).toThrow(
      /uid/i,
    )
  })

  test('a uid carrying a whole query block is rejected', () => {
    expect(() =>
      buildExpandQuery({ ...ok, uid: '0x1)) { uid } q2(func: has(name' }),
    ).toThrow(/uid/i)
  })

  test('a non-hex uid is rejected', () => {
    expect(() => buildExpandQuery({ ...ok, uid: 'alice' })).toThrow(/uid/i)
  })

  test('an empty uid is rejected', () => {
    expect(() => buildExpandQuery({ ...ok, uid: '' })).toThrow(/uid/i)
  })

  test('an ordinary uid still builds', () => {
    // Regression guard: the validation must not reject what Dgraph actually
    // hands back.
    expect(buildExpandQuery({ ...ok, uid: '0x1' })).toContain(
      'node(func: uid(0x1))',
    )
    expect(buildExpandQuery({ ...ok, uid: '0xffe1' })).toContain(
      'node(func: uid(0xffe1))',
    )
  })
})

describe('predicate names must survive interpolation', () => {
  test('a predicate that breaks out of its angle brackets is rejected', () => {
    // Emitted verbatim as:
    //   <a> { uid } friend (first: 99999) { uid } <b> (first: 499) {
    const evil = 'a> { uid } friend (first: 99999) { uid } <b'
    expect(() => buildExpandQuery({ uid: '0x1', predicates: [evil] })).toThrow(
      /predicate/i,
    )
  })

  test('a predicate carrying a newline is rejected', () => {
    expect(() =>
      buildExpandQuery({ uid: '0x1', predicates: ['friend\n    uid'] }),
    ).toThrow(/predicate/i)
  })

  test('an ordinary predicate still builds', () => {
    const query = buildExpandQuery({ uid: '0x1', predicates: ['friend'] })
    expect(query).toMatch(/friend\s*\(first:/)
  })

  test('a dotted predicate still builds', () => {
    // `person.friend` is idiomatic Dgraph and must not be collateral damage.
    const query = buildExpandQuery({
      uid: '0x1',
      predicates: ['person.friend'],
    })
    expect(query).toMatch(/person\.friend\s*\(first:/)
  })
})

describe('uidPredicates reads the schema, not the screen', () => {
  const schema = {
    data: {
      schema: [
        { predicate: 'friend', type: 'uid' },
        { predicate: 'worksAt', type: 'uid' },
        { predicate: 'name', type: 'string' },
        { predicate: 'age', type: 'int' },
        { predicate: 'dgraph.type', type: 'string' },
        { predicate: 'dgraph.graphql.schema', type: 'string' },
      ],
    },
  }

  test('only uid-typed predicates are edges', () => {
    expect(uidPredicates(schema)).toEqual(['friend', 'worksAt'])
  })

  test('dgraph internals are never expansion targets', () => {
    const internal = {
      data: { schema: [{ predicate: 'dgraph.xid', type: 'uid' }] },
    }
    expect(uidPredicates(internal)).toEqual([])
  })

  test('a missing or empty schema yields nothing rather than throwing', () => {
    // The caller falls back to on-screen predicates; it must not crash first.
    expect(uidPredicates(null)).toEqual([])
    expect(uidPredicates({})).toEqual([])
    expect(uidPredicates({ data: {} })).toEqual([])
  })

  test('predicates that could not be safely interpolated are dropped', () => {
    const nasty = {
      data: { schema: [{ predicate: 'a> { uid } <b', type: 'uid' }] },
    }
    expect(uidPredicates(nasty)).toEqual([])
  })
})
