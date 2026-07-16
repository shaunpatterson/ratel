/*
 * SPDX-FileCopyrightText: © 2017-2026 Istari Digital, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

// setupTests.js is not wired into this repo's jest config, so pull in jest-dom here.
import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import React from 'react'
import { Provider } from 'react-redux'
import { applyMiddleware, combineReducers, createStore } from 'redux'
import ReduxThunk from 'redux-thunk'

import queryReducer from 'reducers/query'

import { invalidateDrillSchema } from 'lib/drillSchema'
import { getDgraphClient } from 'lib/helpers'
import FramePrettyJsonTab from './FramePrettyJsonTab'

jest.mock('lib/helpers', () => ({
  getDgraphClient: jest.fn(),
  executeQuery: jest.fn(),
}))

const SCHEMA = [
  {
    predicate: 'external_id',
    type: 'string',
    index: true,
    tokenizer: ['exact'],
  },
  { predicate: 'name', type: 'string', index: true, tokenizer: ['term'] },
  { predicate: 'source_uri', type: 'string' },
]

const DATA = {
  data: {
    q: [
      { uid: '0x1', external_id: 'R-628abbedb594', name: 'Bank Secrecy Act' },
    ],
  },
  extensions: {
    // Dgraph reports per-predicate uid counts here. These keys ARE predicate
    // names, and their values are counts — drilling one would emit
    // eq(name, 5): legal DQL, completely wrong meaning.
    metrics: { num_uids: { name: 5, external_id: 5 } },
  },
}

let store

const renderTab = async (
  query = '{ q(func: uid(0x1)) { uid external_id name } }',
) => {
  store = createStore(
    combineReducers({ query: queryReducer }),
    { query: { query: '{ precious unsaved work }', action: 'query' } },
    applyMiddleware(ReduxThunk),
  )
  const utils = render(
    <Provider store={store}>
      <FramePrettyJsonTab data={DATA} query={query} />
    </Provider>,
  )
  // Reveal the whole tree, including extensions.
  fireEvent.click(screen.getByText(/Expand all/))
  return utils
}

const drillButtons = () =>
  screen.queryAllByRole('button').filter((b) => b.querySelector('.fa-search'))

describe('FramePrettyJsonTab value drill-down', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    invalidateDrillSchema()
    getDgraphClient.mockResolvedValue({
      newTxn: () => ({
        query: jest.fn().mockResolvedValue({ data: { schema: SCHEMA } }),
      }),
    })
  })

  it('drills an unambiguous entry into a NEW tab, without running it', async () => {
    await renderTab()
    await waitFor(() => expect(drillButtons().length).toBeGreaterThan(0))

    fireEvent.click(screen.getByTitle(/Filter by this exact value/))

    const state = store.getState().query
    expect(state.query).toContain('eq(external_id, "R-628abbedb594")')
    expect(state.query).toContain('first:')
    expect(
      state.tabs.some((t) => t.query === '{ precious unsaved work }'),
    ).toBe(true)
  })

  it('never drills inside extensions — num_uids keys are predicate names with COUNT values', async () => {
    await renderTab()
    await waitFor(() => expect(drillButtons().length).toBeGreaterThan(0))

    // The num_uids entries ARE rendered, and their keys ARE indexed predicates,
    // so nothing but the path guard can stop them being offered as drills.
    expect(screen.getAllByText('5').length).toBe(2)

    // Exactly the two real data values (external_id, name) are drillable. If the
    // extensions subtree leaked in, this would be 4.
    expect(drillButtons()).toHaveLength(2)

    // And no drill can ever turn a uid COUNT into a filter on that predicate.
    for (const button of drillButtons()) {
      fireEvent.click(button)
      expect(store.getState().query.query).not.toContain('"5"')
    }
  })

  it('offers NO drills at all when the query aliases its output', async () => {
    await renderTab('{ q(func: uid(0x1)) { external_id: some_other_pred } }')
    // Give the schema a chance to land, so an empty result means the provenance
    // gate refused rather than the schema simply not having arrived.
    await waitFor(() => expect(getDgraphClient).toHaveBeenCalled())

    expect(drillButtons()).toHaveLength(0)
  })

  it('offers NO drills when the query normalizes', async () => {
    await renderTab('{ q(func: uid(0x1)) @normalize { external_id } }')
    await waitFor(() => expect(getDgraphClient).toHaveBeenCalled())

    expect(drillButtons()).toHaveLength(0)
  })

  it('labels a term-indexed predicate as a term search', async () => {
    await renderTab()
    await waitFor(() => expect(drillButtons().length).toBeGreaterThan(0))

    fireEvent.click(screen.getByTitle(/Search for all terms/))
    expect(store.getState().query.query).toContain(
      'allofterms(name, "Bank Secrecy Act")',
    )
  })
})
