/*
 * SPDX-FileCopyrightText: © 2017-2026 Istari Digital, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react'

import { getDgraphClient } from 'lib/helpers'

// The drill has to know each predicate's tokenizer to decide whether a filter is
// even legal, but the schema lives nowhere in the redux store — the Schema page
// fetches it into local component state. Rather than plumb it through the whole
// frame tree, cache it here.
//
// Cached at module scope because NodeProperties re-renders on every selection
// and every keystroke of an inline edit; re-fetching the schema each time would
// hammer the cluster to answer a question whose answer changes only on an alter.

let cached = null
let inflight = null

/** Drops the cache. Call after an alter, and from tests. */
export function invalidateDrillSchema() {
  cached = null
  inflight = null
}

/**
 * Returns the `schema {}` predicate list, fetching at most once.
 *
 * Resolves to [] rather than rejecting: a missing schema must degrade to "no
 * drill offered" (buildFilterQuery refuses on an unknown predicate), never to a
 * broken properties panel. The failure is NOT cached, so a transient outage
 * doesn't disable the feature for the life of the tab.
 */
export function getDrillSchema() {
  if (cached) {
    return Promise.resolve(cached)
  }
  if (!inflight) {
    inflight = (async () => {
      const client = await getDgraphClient()
      const response = await client.newTxn().query('schema {}')
      return response?.data?.schema || []
    })()
      .then((schema) => {
        cached = schema
        inflight = null
        return schema
      })
      .catch(() => {
        inflight = null
        return []
      })
  }
  return inflight
}

/** Schema for drill decisions; [] until loaded. */
export function useDrillSchema() {
  const [schema, setSchema] = React.useState(cached || [])

  React.useEffect(() => {
    let alive = true
    getDrillSchema().then((s) => {
      if (alive) {
        setSchema(s)
      }
    })
    return () => {
      alive = false
    }
  }, [])

  return schema
}
