/*
 * SPDX-FileCopyrightText: © 2017-2026 Istari Digital, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import { getDgraphClient } from 'lib/helpers'
import { getDrillSchema, invalidateDrillSchema } from './drillSchema'

jest.mock('lib/helpers', () => ({ getDgraphClient: jest.fn() }))

const mockSchema = (schema) => {
  const query = jest.fn().mockResolvedValue({ data: { schema } })
  getDgraphClient.mockResolvedValue({ newTxn: () => ({ query }) })
  return query
}

describe('getDrillSchema', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    invalidateDrillSchema()
  })

  it('returns the predicate list from schema {}', async () => {
    const preds = [
      { predicate: 'name', type: 'string', index: true, tokenizer: ['term'] },
    ]
    const query = mockSchema(preds)

    await expect(getDrillSchema()).resolves.toEqual(preds)
    expect(query).toHaveBeenCalledWith('schema {}')
  })

  it('fetches once and caches — selecting nodes must not re-hit the cluster', async () => {
    const query = mockSchema([])

    await getDrillSchema()
    await getDrillSchema()
    await getDrillSchema()

    expect(query).toHaveBeenCalledTimes(1)
  })

  it('de-dupes concurrent callers into one request', async () => {
    const query = mockSchema([])

    await Promise.all([getDrillSchema(), getDrillSchema()])

    expect(query).toHaveBeenCalledTimes(1)
  })

  it('degrades to an empty schema when the cluster errors, and retries later', async () => {
    getDgraphClient.mockRejectedValueOnce(new Error('boom'))
    await expect(getDrillSchema()).resolves.toEqual([])

    // A failure must not be cached as "no predicates forever".
    const query = mockSchema([{ predicate: 'name', type: 'string' }])
    await expect(getDrillSchema()).resolves.toHaveLength(1)
    expect(query).toHaveBeenCalledTimes(1)
  })
})
