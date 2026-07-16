/*
 * SPDX-FileCopyrightText: © 2017-2026 Istari Digital, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

// setupTests.js is not wired into this repo's jest config (no setupFilesAfterEach),
// so the jest-dom matchers have to be pulled in per-suite.
import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import React from 'react'
import { Provider } from 'react-redux'
import { applyMiddleware, combineReducers, createStore } from 'redux'
import ReduxThunk from 'redux-thunk'

import queryReducer from 'reducers/query'

import { invalidateDrillSchema } from 'lib/drillSchema'
import { getDgraphClient } from 'lib/helpers'
import NodeProperties from './NodeProperties'

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

const node = {
  uid: '0x1',
  expanded: false,
  properties: {
    attrs: {
      uid: '0x1',
      external_id: 'R-628abbedb594',
      name: 'Bank Secrecy Act',
      source_uri: 'http://example.com/x',
    },
    facets: {},
  },
}

let store

const renderPanel = async () => {
  store = createStore(
    combineReducers({ query: queryReducer }),
    { query: { query: '{ precious unsaved work }', action: 'query' } },
    applyMiddleware(ReduxThunk),
  )
  render(
    <Provider store={store}>
      <NodeProperties
        node={node}
        onExpandNode={() => {}}
        onCollapseNode={() => {}}
      />
    </Provider>,
  )
  // Schema arrives asynchronously; drills stay refused until it does.
  await waitFor(() =>
    expect(screen.getByTitle(/Filter by this exact value/)).toBeInTheDocument(),
  )
}

describe('NodeProperties value drill-down', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    invalidateDrillSchema()
    getDgraphClient.mockResolvedValue({
      newTxn: () => ({
        query: jest.fn().mockResolvedValue({ data: { schema: SCHEMA } }),
      }),
    })
  })

  it('drills an exact-indexed value into a NEW tab, without running it', async () => {
    await renderPanel()

    fireEvent.click(screen.getByTitle(/Filter by this exact value/))

    const state = store.getState().query
    expect(state.query).toBe(`{
  drill(func: eq(external_id, "R-628abbedb594"), first: 50) {
    uid
    expand(_all_)
  }
}`)
    // The work the user already had open must survive in its own tab.
    expect(state.tabs).toHaveLength(2)
    expect(
      state.tabs.some((t) => t.query === '{ precious unsaved work }'),
    ).toBe(true)
  })

  it('labels a term-indexed predicate as a term search, not an exact filter', async () => {
    await renderPanel()

    const termButton = screen.getByTitle(/Search for all terms/)
    expect(termButton).toBeInTheDocument()

    fireEvent.click(termButton)
    expect(store.getState().query.query).toContain(
      'allofterms(name, "Bank Secrecy Act")',
    )
  })

  it('refuses an unindexed predicate with a reason instead of a query', async () => {
    await renderPanel()

    const refused = screen.getByTitle(/not indexed/i)
    // aria-disabled, not disabled: the tooltip carrying the reason has to stay
    // readable, and browsers suppress tooltips on disabled controls.
    expect(refused).toHaveAttribute('aria-disabled', 'true')
    expect(refused.getAttribute('title')).toContain('source_uri')

    fireEvent.click(refused)
    // A refusal must not open a tab or write a query.
    expect(store.getState().query.query).toBe('{ precious unsaved work }')
  })

  it('offers no drill on the uid row — the observed loop harvests literals, not uids', async () => {
    await renderPanel()

    // Three attrs are drillable (external_id, name, source_uri); uid gets no
    // drill button at all, enabled or refused.
    const drills = screen
      .getAllByRole('button')
      .filter((b) => b.querySelector('.fa-search'))
    expect(drills).toHaveLength(3)
    expect(
      drills.some((b) =>
        /uid identifies this node/.test(b.getAttribute('title') || ''),
      ),
    ).toBe(false)
  })
})
