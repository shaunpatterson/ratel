/*
 * SPDX-FileCopyrightText: © 2017-2026 Istari Digital, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import { Fetching, OK } from 'lib/constants'
import { getDgraphClient } from 'lib/helpers'

export const SCHEMA_FETCH_PENDING = 'schema/FETCH_PENDING'
export const SCHEMA_FETCH_SUCCESS = 'schema/FETCH_SUCCESS'
export const SCHEMA_FETCH_ERROR = 'schema/FETCH_ERROR'

// Fetches `schema {}` for the current session, unless we already hold it.
//
// The generation captured here is stamped on every action this thunk goes on to
// dispatch. If the session turns over while the request is in flight, the
// reducer sees the stale generation and discards the response -- see
// reducers/schema.js for why a response is only meaningful to the session that
// issued it.
export const fetchSchema =
  ({ force = false } = {}) =>
  async (dispatch, getState) => {
    const url = getState().connection.serverHistory[0].url
    const current = getState().schema

    if (current.fetchState === Fetching) {
      return
    }
    if (!force && current.fetchState === OK && current.url === url) {
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
