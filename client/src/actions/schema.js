/*
 * SPDX-FileCopyrightText: © 2017-2026 Istari Digital, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import { Fetching } from 'lib/constants'
import { getDgraphClient } from 'lib/helpers'

export const SCHEMA_FETCH_PENDING = 'schema/FETCH_PENDING'
export const SCHEMA_FETCH_SUCCESS = 'schema/FETCH_SUCCESS'
export const SCHEMA_FETCH_ERROR = 'schema/FETCH_ERROR'

// Fetches `schema {}` for the current session.
//
// The generation captured here is stamped on every action this thunk goes on to
// dispatch. If the session turns over while the request is in flight, the
// reducer sees the stale generation and discards the response -- see
// reducers/schema.js for why a response is only meaningful to the session that
// issued it.
//
// Concurrent callers are deduped, but a completed schema is deliberately NOT
// cached. It is tempting: the slice already knows the session and the url, so
// (session, url) looks like a sound key, and re-asking on every mount looks
// wasteful. But nothing bumps the generation when the schema itself changes.
// The Schema page mutates it through a component that knows nothing about this
// store, and any other client pointed at the same cluster can change it too, so
// a cache under that key never invalidates and completion goes on offering a
// schema the cluster no longer has. `schema {}` is bounded metadata, not a
// traversal; asking again on mount is what the Editor did before this store
// existed, and it is cheaper than being wrong.
export const fetchSchema = () => async (dispatch, getState) => {
  const url = getState().connection.serverHistory[0].url
  const current = getState().schema

  if (current.fetchState === Fetching) {
    return
  }

  const generation = current.generation
  dispatch({ type: SCHEMA_FETCH_PENDING, generation, url })

  try {
    const client = await getDgraphClient()
    const response = await client.newTxn().query('schema {}')
    dispatch({
      type: SCHEMA_FETCH_SUCCESS,
      generation,
      url,
      predicates: response.data?.schema || [],
      types: response.data?.types || [],
    })
  } catch (error) {
    console.warn('Error while fetching schema', error)
    dispatch({ type: SCHEMA_FETCH_ERROR, generation, url, error })
  }
}
