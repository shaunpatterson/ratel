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
import { GraphParser } from 'lib/graph'
import { getDgraphClient } from 'lib/helpers'
import NodeProperties from './NodeProperties'

jest.mock('lib/helpers', () => ({
  getDgraphClient: jest.fn(),
  executeQuery: jest.fn(),
  // The drill schema cache is keyed by server; without this it cannot tell
  // which cluster it is caching for.
  getCurrentServerUrl: jest.fn(() => 'http://test-alpha:8080'),
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

const PLAIN_QUERY =
  '{ q(func: has(external_id)) { uid external_id name source_uri } }'

let store

const renderNode = (target, query) => {
  store = createStore(
    combineReducers({ query: queryReducer }),
    { query: { query: '{ precious unsaved work }', action: 'query' } },
    applyMiddleware(ReduxThunk),
  )
  return render(
    <Provider store={store}>
      <NodeProperties
        node={target}
        query={query}
        onExpandNode={() => {}}
        onCollapseNode={() => {}}
      />
    </Provider>,
  )
}

const renderPanel = async () => {
  renderNode(node, PLAIN_QUERY)
  // Schema arrives asynchronously; drills stay refused until it does.
  await waitFor(() =>
    expect(screen.getByTitle(/Filter by this exact value/)).toBeInTheDocument(),
  )
}

// Builds a node the way production does — through the real GraphParser — rather
// than by hand. The hand-built `node` above can only ever contain genuine
// predicate names, so it is structurally incapable of catching the alias bug.
const parseFirstNode = (response) => {
  const parser = new GraphParser()
  parser.addResponseToQueue(response.data)
  parser.processQueue('Name')
  return [...parser.getCurrentGraph().nodes.values()][0]
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

  // The panel is NOT inherently a safe drill surface. lib/graph.js:186 does
  // `properties.attrs[prop] = val` with the RAW response key, so an alias lands
  // in attrs indistinguishable from a real predicate — `title: name` yields
  // attrs.title = 'Alice' and a naive drill emits eq(title, "Alice") for a value
  // that came from `name`. Both keys can be real, indexed predicates, so neither
  // the key nor the schema can tell them apart. Only the query can.
  describe('aliased queries', () => {
    const ALIASED_RESPONSE = {
      data: { q: [{ uid: '0x1', external_id: 'Alice' }] },
    }
    const ALIASED_QUERY = '{ q(func: has(name)) { uid external_id: name } }'

    it('offers NO drills when the query aliased its output', async () => {
      const aliased = parseFirstNode(ALIASED_RESPONSE)
      // The alias really did land in attrs under the aliased name — this is the
      // precondition the bug depends on, asserted rather than assumed.
      expect(aliased.properties.attrs.external_id).toBe('Alice')

      renderNode(aliased, ALIASED_QUERY)
      // Let the schema land, so an absent drill means the gate refused rather
      // than the schema simply not having arrived yet.
      await waitFor(() => expect(getDgraphClient).toHaveBeenCalled())

      const drills = screen
        .queryAllByRole('button')
        .filter((b) => b.querySelector('.fa-search'))
      expect(drills).toHaveLength(0)
    })

    it('never emits a filter naming a predicate the value did not come from', async () => {
      renderNode(parseFirstNode(ALIASED_RESPONSE), ALIASED_QUERY)
      await waitFor(() => expect(getDgraphClient).toHaveBeenCalled())

      // Click whatever the panel DID offer. Asserting the store without this is
      // a test that cannot fail on the unfixed code — nothing writes a query
      // until a button is pressed.
      for (const button of screen
        .queryAllByRole('button')
        .filter((b) => b.querySelector('.fa-search'))) {
        fireEvent.click(button)
      }

      // The value 'Alice' came from `name`. A filter on `external_id` would be a
      // button that lies.
      expect(store.getState().query.query).not.toContain('eq(external_id')
      expect(store.getState().query.query).toBe('{ precious unsaved work }')
    })

    it('still drills a node whose query is provably unaliased', async () => {
      const plain = parseFirstNode({
        data: { q: [{ uid: '0x1', external_id: 'R-1' }] },
      })
      renderNode(plain, PLAIN_QUERY)

      await waitFor(() =>
        expect(
          screen.getByTitle(/Filter by this exact value/),
        ).toBeInTheDocument(),
      )
      fireEvent.click(screen.getByTitle(/Filter by this exact value/))
      expect(store.getState().query.query).toContain('eq(external_id, "R-1")')
    })

    it('refuses when it is given no query, rather than assuming the keys are safe', async () => {
      renderNode(parseFirstNode(ALIASED_RESPONSE), undefined)
      await waitFor(() => expect(getDgraphClient).toHaveBeenCalled())

      const drills = screen
        .queryAllByRole('button')
        .filter((b) => b.querySelector('.fa-search'))
      expect(drills).toHaveLength(0)
    })
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
