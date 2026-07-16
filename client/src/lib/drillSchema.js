/*
 * SPDX-FileCopyrightText: © 2017-2026 Istari Digital, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react'

import { getCurrentServerUrl, getDgraphClient } from 'lib/helpers'

// The drill has to know each predicate's tokenizer to decide whether a filter is
// even legal, but the schema lives nowhere in the redux store — the Schema page
// fetches it into local component state. Rather than plumb it through the whole
// frame tree, cache it here.
//
// Cached at module scope because NodeProperties re-renders on every selection
// and every keystroke of an inline edit; re-fetching the schema each time would
// hammer the cluster to answer a question whose answer changes only on an alter.
//
// KEYED BY SERVER URL, because "the schema" is not a global fact. UPDATE_URL
// (reducers/connection.js) calls setCurrentServerUrl() and does NOT reload the
// page, so the dgraph client starts answering from the new cluster immediately.
// An unkeyed cache would keep deciding server B's drills with server A's
// tokenizers — or offer a predicate B has never heard of — and each cluster is
// a different security context. A cache of per-server data with no server in
// the key is a cache that lies the moment the user switches.

let cachedUrl = null
let cached = null
let inflight = null
let inflightUrl = null

/**
 * Drops the cache. Called after a successful alter — an added index changes
 * which drills are legal, and nothing else would ever tell us.
 */
export function invalidateDrillSchema() {
  cachedUrl = null
  cached = null
  inflight = null
  inflightUrl = null
}

/**
 * Returns the current server's `schema {}` predicate list, fetching at most once
 * per server.
 *
 * Resolves to [] rather than rejecting: a missing schema must degrade to "no
 * drill offered" (buildFilterQuery refuses on an unknown predicate), never to a
 * broken properties panel. The failure is NOT cached, so a transient outage
 * doesn't disable the feature for the life of the tab.
 */
export function getDrillSchema() {
  const url = getCurrentServerUrl()

  if (cached && cachedUrl === url) {
    return Promise.resolve(cached)
  }
  if (inflight && inflightUrl === url) {
    return inflight
  }

  inflightUrl = url
  inflight = (async () => {
    const client = await getDgraphClient()
    const response = await client.newTxn().query('schema {}')
    return response?.data?.schema || []
  })()
    .then((schema) => {
      // The user can switch server, or alter, while this is in the air. Landing
      // a late response into the cache would silently restore exactly the stale
      // data the switch/invalidation was meant to drop.
      if (inflightUrl === url) {
        cachedUrl = url
        cached = schema
        inflight = null
        inflightUrl = null
      }
      return schema
    })
    .catch(() => {
      if (inflightUrl === url) {
        inflight = null
        inflightUrl = null
      }
      return []
    })

  return inflight
}

/**
 * Schema for drill decisions; [] until loaded.
 *
 * Re-fetches when the server changes. The url is read on every render and used
 * as the effect's dependency, so any re-render after a switch (UPDATE_URL
 * dispatches checkHealth, which re-renders the connection-bound tree) picks the
 * new cluster up. Without this a mounted panel would hold server A's schema in
 * local state forever.
 */
export function useDrillSchema() {
  const url = getCurrentServerUrl()
  const [schema, setSchema] = React.useState(() =>
    cachedUrl === url && cached ? cached : [],
  )

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
  }, [url])

  return schema
}
