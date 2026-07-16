/*
 * SPDX-FileCopyrightText: © 2017-2026 Istari Digital, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import { getCurrentServerUrl, getDgraphClient } from 'lib/helpers'
import { getDrillSchema, invalidateDrillSchema } from './drillSchema'

jest.mock('lib/helpers', () => ({
  getDgraphClient: jest.fn(),
  getCurrentServerUrl: jest.fn(),
}))

const mockSchema = (schema) => {
  const query = jest.fn().mockResolvedValue({ data: { schema } })
  getDgraphClient.mockResolvedValue({ newTxn: () => ({ query }) })
  return query
}

// A deferred fetch, so a test can switch server while one is in flight.
// `started` resolves once query() has actually been called — getDgraphClient is
// itself async, so the request is not in flight the instant getDrillSchema()
// returns, and settling before then would settle nothing.
const mockPendingSchema = () => {
  let resolve
  let started
  const hasStarted = new Promise((r) => (started = r))
  const query = jest.fn(
    () =>
      new Promise((r) => {
        resolve = r
        started()
      }),
  )
  getDgraphClient.mockResolvedValue({ newTxn: () => ({ query }) })
  return {
    query,
    hasStarted,
    settle: (schema) => resolve({ data: { schema } }),
  }
}

describe('getDrillSchema', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    invalidateDrillSchema()
    getCurrentServerUrl.mockReturnValue('http://alpha-a:8080')
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

  // A cache of "the schema" with no notion of WHICH server's schema is a cache
  // that lies the moment the user switches server. reducers/connection.js:151
  // calls setCurrentServerUrl() on UPDATE_URL with no page reload, so the
  // dgraph client follows the switch immediately — and an unkeyed module-scope
  // cache does not. Server B's drills would then be decided by server A's
  // tokenizers, or by predicates that do not exist on B at all.
  describe('is keyed by server', () => {
    it("refetches after a server switch instead of serving the old server's schema", async () => {
      const a = [{ predicate: 'only_on_a', type: 'string' }]
      mockSchema(a)
      await expect(getDrillSchema()).resolves.toEqual(a)

      getCurrentServerUrl.mockReturnValue('http://alpha-b:8080')
      const b = [{ predicate: 'only_on_b', type: 'string' }]
      const queryB = mockSchema(b)

      await expect(getDrillSchema()).resolves.toEqual(b)
      expect(queryB).toHaveBeenCalledTimes(1)
    })

    it('still caches per server — switching back does not re-hit either', async () => {
      const query = mockSchema([])
      await getDrillSchema()
      await getDrillSchema()
      expect(query).toHaveBeenCalledTimes(1)

      getCurrentServerUrl.mockReturnValue('http://alpha-b:8080')
      await getDrillSchema()
      await getDrillSchema()
      // One extra fetch for B, not one per call.
      expect(query).toHaveBeenCalledTimes(2)
    })

    it("does not let server A's in-flight response become server B's cache", async () => {
      const pending = mockPendingSchema()
      const inflight = getDrillSchema()
      await pending.hasStarted

      // The user switches server before A's schema comes back.
      getCurrentServerUrl.mockReturnValue('http://alpha-b:8080')
      pending.settle([{ predicate: 'only_on_a', type: 'string' }])
      await inflight

      const b = [{ predicate: 'only_on_b', type: 'string' }]
      mockSchema(b)
      // If A's late response was written to the cache unkeyed, this returns A's.
      await expect(getDrillSchema()).resolves.toEqual(b)
    })
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
