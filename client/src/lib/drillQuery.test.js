/*
 * SPDX-FileCopyrightText: © 2017-2026 Istari Digital, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import { buildFilterQuery } from './drillQuery'

const exactSchema = [
  {
    predicate: 'external_id',
    type: 'string',
    index: true,
    tokenizer: ['exact'],
  },
]
const termSchema = [
  { predicate: 'name', type: 'string', index: true, tokenizer: ['term'] },
]
const noIndexSchema = [{ predicate: 'source_uri', type: 'string' }]

describe('buildFilterQuery — exact index', () => {
  // ACCEPTANCE 1
  it('emits eq() with the predicate UNQUOTED and the value quoted', () => {
    const result = buildFilterQuery({
      predicate: 'external_id',
      value: 'R-628abbedb594',
      schema: exactSchema,
    })

    expect(result.ok).toBe(true)
    expect(result.query).toContain('eq(external_id, "R-628abbedb594")')
    // The predicate must NOT be quoted — eq("external_id", ...) is wrong DQL.
    expect(result.query).not.toContain('eq("external_id"')
    expect(result.label).toBe('Filter by this exact value')
  })

  it('treats a hash index as exact-capable', () => {
    const result = buildFilterQuery({
      predicate: 'external_id',
      value: 'R-1',
      schema: [
        {
          predicate: 'external_id',
          type: 'string',
          index: true,
          tokenizer: ['hash'],
        },
      ],
    })
    expect(result.ok).toBe(true)
    expect(result.query).toContain('eq(external_id, "R-1")')
  })
})

describe('buildFilterQuery — term index', () => {
  // ACCEPTANCE 2
  it('emits allofterms and labels it as a term SEARCH, not an exact filter', () => {
    const result = buildFilterQuery({
      predicate: 'name',
      value: 'Bank Secrecy Act',
      schema: termSchema,
    })

    expect(result.ok).toBe(true)
    expect(result.query).toContain('allofterms(name, "Bank Secrecy Act")')
    // allofterms returns values OTHER than the clicked one, so it must not
    // claim to be an exact filter.
    expect(result.label).toBe('Search for all terms')
    expect(result.label).not.toBe('Filter by this exact value')
  })

  it('prefers exact over term when the predicate has both', () => {
    const result = buildFilterQuery({
      predicate: 'name',
      value: 'Bank Secrecy Act',
      schema: [
        {
          predicate: 'name',
          type: 'string',
          index: true,
          tokenizer: ['term', 'exact'],
        },
      ],
    })
    expect(result.query).toContain('eq(name, "Bank Secrecy Act")')
    expect(result.label).toBe('Filter by this exact value')
  })

  it('emits alloftext for a fulltext-only index', () => {
    const result = buildFilterQuery({
      predicate: 'bio',
      value: 'money laundering',
      schema: [
        {
          predicate: 'bio',
          type: 'string',
          index: true,
          tokenizer: ['fulltext'],
        },
      ],
    })
    expect(result.query).toContain('alloftext(bio, "money laundering")')
    expect(result.label).toBe('Search full text')
  })
})

describe('buildFilterQuery — refusals with a reason', () => {
  // ACCEPTANCE 3
  it('refuses an unindexed predicate and says why', () => {
    const result = buildFilterQuery({
      predicate: 'source_uri',
      value: 'http://x',
      schema: noIndexSchema,
    })

    expect(result.ok).toBe(false)
    expect(result.query).toBeUndefined()
    expect(result.reason).toMatch(/not indexed/i)
    expect(result.reason).toContain('source_uri')
  })

  it('refuses an indexed predicate that has no usable tokenizer', () => {
    const result = buildFilterQuery({
      predicate: '0-title',
      value: 'x',
      schema: [
        { predicate: '0-title', type: 'string', index: true, tokenizer: [] },
      ],
    })
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/tokenizer|not indexed/i)
  })

  it('refuses a trigram-only index rather than guessing eq()', () => {
    const result = buildFilterQuery({
      predicate: 'code',
      value: 'abc',
      schema: [
        {
          predicate: 'code',
          type: 'string',
          index: true,
          tokenizer: ['trigram'],
        },
      ],
    })
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/trigram/i)
  })

  it('refuses a predicate absent from the schema', () => {
    const result = buildFilterQuery({
      predicate: 'ghost',
      value: 'x',
      schema: exactSchema,
    })
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/not in the schema|unknown/i)
  })

  it('refuses the reserved uid key with a uid-specific reason', () => {
    const result = buildFilterQuery({
      predicate: 'uid',
      value: '0x1',
      schema: exactSchema,
    })
    expect(result.ok).toBe(false)
    // Must not fall through to the generic "not in the schema" message — uid is
    // reserved, not missing.
    expect(result.reason).not.toMatch(/not in the schema/i)
    expect(result.reason).toMatch(/uid/i)
  })

  it('refuses a uid-typed predicate — that is an edge, not a value', () => {
    const result = buildFilterQuery({
      predicate: 'friend',
      value: '0x1',
      schema: [
        { predicate: 'friend', type: 'uid', index: true, tokenizer: [] },
      ],
    })
    expect(result.ok).toBe(false)
  })

  it('refuses an unsafe predicate name instead of injecting it', () => {
    const result = buildFilterQuery({
      predicate: 'a) <b',
      value: 'x',
      schema: [
        {
          predicate: 'a) <b',
          type: 'string',
          index: true,
          tokenizer: ['exact'],
        },
      ],
    })
    expect(result.ok).toBe(false)
  })

  it('refuses a null/object value', () => {
    expect(
      buildFilterQuery({
        predicate: 'external_id',
        value: null,
        schema: exactSchema,
      }).ok,
    ).toBe(false)
    expect(
      buildFilterQuery({
        predicate: 'external_id',
        value: {},
        schema: exactSchema,
      }).ok,
    ).toBe(false)
  })
})

describe('buildFilterQuery — typed DQL serialization', () => {
  it('emits int literals unquoted (NOT an RDF typed literal)', () => {
    const result = buildFilterQuery({
      predicate: 'age',
      value: 25,
      schema: [
        { predicate: 'age', type: 'int', index: true, tokenizer: ['int'] },
      ],
    })
    expect(result.ok).toBe(true)
    expect(result.query).toContain('eq(age, 25)')
    // valueToRdfLiteral would have produced "25"^^<xs:int> — wrong grammar for eq().
    expect(result.query).not.toContain('xs:int')
    expect(result.query).not.toContain('"25"')
  })

  it('emits float and bool literals unquoted', () => {
    expect(
      buildFilterQuery({
        predicate: 'score',
        value: 1.5,
        schema: [
          {
            predicate: 'score',
            type: 'float',
            index: true,
            tokenizer: ['float'],
          },
        ],
      }).query,
    ).toContain('eq(score, 1.5)')

    expect(
      buildFilterQuery({
        predicate: 'active',
        value: true,
        schema: [
          {
            predicate: 'active',
            type: 'bool',
            index: true,
            tokenizer: ['bool'],
          },
        ],
      }).query,
    ).toContain('eq(active, true)')
  })

  it('quotes datetime values', () => {
    const result = buildFilterQuery({
      predicate: 'created',
      value: '2020-01-02T03:04:05Z',
      schema: [
        {
          predicate: 'created',
          type: 'datetime',
          index: true,
          tokenizer: ['year'],
        },
      ],
    })
    expect(result.query).toContain('eq(created, "2020-01-02T03:04:05Z")')
  })

  it('escapes quotes and backslashes in the value', () => {
    const result = buildFilterQuery({
      predicate: 'external_id',
      value: 'say "hi"\\',
      schema: exactSchema,
    })
    expect(result.ok).toBe(true)
    expect(result.query).toContain('eq(external_id, "say \\"hi\\"\\\\")')
  })

  it('wraps a predicate that is not a bare DQL identifier in angle brackets', () => {
    const result = buildFilterQuery({
      predicate: '0-title',
      value: 'x',
      schema: [
        {
          predicate: '0-title',
          type: 'string',
          index: true,
          tokenizer: ['exact'],
        },
      ],
    })
    expect(result.ok).toBe(true)
    expect(result.query).toContain('eq(<0-title>, "x")')
  })
})

describe('buildFilterQuery — query shape', () => {
  // ACCEPTANCE 4
  //
  // `first:` bounds the ROOT SET, not the response — expand(_all_) is unbounded
  // in breadth per root. toContain('first:') would also pass on a query with
  // `first:` in a comment, so assert the value is attached to the root func.
  it('every generated query bounds its root set with the limit it was given', () => {
    const cases = [
      { predicate: 'external_id', value: 'R-1', schema: exactSchema },
      { predicate: 'name', value: 'Bank Secrecy Act', schema: termSchema },
      {
        predicate: 'age',
        value: 25,
        schema: [
          { predicate: 'age', type: 'int', index: true, tokenizer: ['int'] },
        ],
      },
    ]
    for (const c of cases) {
      const result = buildFilterQuery(c)
      expect(result.ok).toBe(true)
      expect(result.query).toMatch(
        /^\{\n {2}drill\(func: \w+\(.+\), first: 50\) \{$/m,
      )
    }
  })

  it('honours a custom limit', () => {
    const result = buildFilterQuery({
      predicate: 'external_id',
      value: 'R-1',
      schema: exactSchema,
      limit: 10,
    })
    expect(result.query).toContain('first: 10')
  })

  it('produces a complete, runnable query block', () => {
    const result = buildFilterQuery({
      predicate: 'external_id',
      value: 'R-628abbedb594',
      schema: exactSchema,
    })
    expect(result.query).toBe(`{
  drill(func: eq(external_id, "R-628abbedb594"), first: 50) {
    uid
    expand(_all_)
  }
}`)
  })
})
