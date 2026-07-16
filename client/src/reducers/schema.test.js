/*
 * SPDX-FileCopyrightText: © 2017-2026 Istari Digital, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import { render } from '@testing-library/react'
import React from 'react'
import { Provider, useSelector } from 'react-redux'
import { applyMiddleware, combineReducers, createStore } from 'redux'
import ReduxThunk from 'redux-thunk'

jest.mock('lib/helpers', () => ({
  ...jest.requireActual('lib/helpers'),
  getDgraphClient: jest.fn(),
}))

import { DO_LOGOUT, LOGIN_SUCCESS } from 'actions/connection'
import { fetchSchema } from 'actions/schema'
import { getDgraphClient } from 'lib/helpers'
import connection from './connection'
import schema, { selectSchemaPredicates } from './schema'

// A guardian sees every predicate. `schema {}` is silently ACL-filtered, so a
// restricted user gets a short list back with HTTP 200 and no errors key --
// there is no signal in the response that anything was withheld.
const GUARDIAN_PREDICATES = [
  { predicate: 'salary', type: 'int' },
  { predicate: 'ssn', type: 'string' },
  { predicate: 'name', type: 'string' },
]
const RESTRICTED_PREDICATES = [{ predicate: 'name', type: 'string' }]

function makeStore() {
  return createStore(
    combineReducers({ connection, schema }),
    applyMiddleware(ReduxThunk),
  )
}

function serveSchema(predicates, types = []) {
  let resolve
  const gate = new Promise((r) => {
    resolve = r
  })
  getDgraphClient.mockResolvedValue({
    newTxn: () => ({
      query: async () => {
        await gate
        return { data: { schema: predicates, types } }
      },
    }),
  })
  return { release: () => resolve() }
}

function serveSchemaNow(predicates, types = []) {
  const { release } = serveSchema(predicates, types)
  release()
}

function predicateNames(store) {
  return selectSchemaPredicates(store.getState()).map((p) => p.predicate)
}

function currentUrl(store) {
  return store.getState().connection.serverHistory[0].url
}

describe('schema store: ACL session isolation', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('clears the fetched schema synchronously on logout', async () => {
    const store = makeStore()
    serveSchemaNow(GUARDIAN_PREDICATES)

    await store.dispatch(fetchSchema())
    expect(predicateNames(store)).toEqual(['salary', 'ssn', 'name'])

    store.dispatch({ type: DO_LOGOUT })

    // Synchronously after the dispatch returns -- i.e. before React has had any
    // chance to render -- the guardian's predicates must already be gone.
    expect(predicateNames(store)).toEqual([])
  })

  it('clears the fetched schema synchronously when a new principal logs in', async () => {
    const store = makeStore()
    serveSchemaNow(GUARDIAN_PREDICATES)

    await store.dispatch(fetchSchema())
    expect(predicateNames(store)).toEqual(['salary', 'ssn', 'name'])

    store.dispatch({
      type: LOGIN_SUCCESS,
      url: currentUrl(store),
      refreshToken: 'principal-b-token',
    })

    expect(predicateNames(store)).toEqual([])
  })

  // The acceptance test. Same server, same namespace, two principals.
  it('never renders principal A predicates to principal B on the same server', async () => {
    const store = makeStore()
    const url = currentUrl(store)

    const rendered = []
    function Probe() {
      const predicates = useSelector(selectSchemaPredicates)
      rendered.push(predicates.map((p) => p.predicate))
      return null
    }

    // --- principal A: a guardian ---
    serveSchemaNow(GUARDIAN_PREDICATES)
    store.dispatch({ type: LOGIN_SUCCESS, url, refreshToken: 'a' })
    await store.dispatch(fetchSchema())

    render(
      <Provider store={store}>
        <Probe />
      </Provider>,
    )
    expect(rendered[rendered.length - 1]).toEqual(['salary', 'ssn', 'name'])

    // --- A logs out, B logs in on the SAME server and namespace ---
    store.dispatch({ type: DO_LOGOUT })
    store.dispatch({ type: LOGIN_SUCCESS, url, refreshToken: 'b' })

    // The moment B is logged in, whatever is on screen must already be empty.
    // Asserting only on *subsequent* renders would pass vacuously: a store that
    // never clears never re-renders, and B simply keeps staring at A's schema.
    expect(rendered[rendered.length - 1]).toEqual([])

    const rendersDuringB = rendered.length
    serveSchemaNow(RESTRICTED_PREDICATES)
    await store.dispatch(fetchSchema())

    // And no render B ever sees may contain a predicate only A could read.
    const leaked = rendered
      .slice(rendersDuringB)
      .filter((names) => names.includes('salary') || names.includes('ssn'))
    expect(leaked).toEqual([])
    expect(predicateNames(store)).toEqual(['name'])
  })

  it('drops an in-flight response that resolves after the session changed', async () => {
    const store = makeStore()
    const url = currentUrl(store)

    // A's fetch is in flight and has not resolved yet.
    const guardianFetch = serveSchema(GUARDIAN_PREDICATES)
    const inFlight = store.dispatch(fetchSchema())

    // The session turns over while that request is still on the wire.
    store.dispatch({ type: DO_LOGOUT })
    store.dispatch({ type: LOGIN_SUCCESS, url, refreshToken: 'b' })

    // Only now does A's request come back.
    guardianFetch.release()
    await inFlight

    // It belongs to a dead session and must not be admitted to the store.
    expect(predicateNames(store)).toEqual([])
  })

  it('refetches for the new session rather than serving the cached schema', async () => {
    const store = makeStore()
    const url = currentUrl(store)

    serveSchemaNow(GUARDIAN_PREDICATES)
    await store.dispatch(fetchSchema())

    store.dispatch({ type: DO_LOGOUT })
    store.dispatch({ type: LOGIN_SUCCESS, url, refreshToken: 'b' })

    serveSchemaNow(RESTRICTED_PREDICATES)
    await store.dispatch(fetchSchema())

    expect(predicateNames(store)).toEqual(['name'])
  })
})

describe('schema store: caching', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('does not requery the server when the schema is already loaded', async () => {
    const store = makeStore()
    let queries = 0
    getDgraphClient.mockResolvedValue({
      newTxn: () => ({
        query: async () => {
          queries++
          return { data: { schema: GUARDIAN_PREDICATES, types: [] } }
        },
      }),
    })

    await store.dispatch(fetchSchema())
    await store.dispatch(fetchSchema())

    expect(queries).toBe(1)
  })
})
