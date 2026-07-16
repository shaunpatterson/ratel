/*
 * SPDX-FileCopyrightText: © 2017-2026 Istari Digital, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import { act, render, screen, waitFor } from '@testing-library/react'
import React from 'react'
import { Provider } from 'react-redux'
import { applyMiddleware, combineReducers, createStore } from 'redux'
import ReduxThunk from 'redux-thunk'

import queryReducer from 'reducers/query'

// SigmaGraph is a WebGL renderer whose componentDidMount calls sigma's SDF
// shape helpers, which config/jest/sigmaMock.js does not stub. Mock the child:
// the hooks under test live in GraphContainer itself, and a real WebGL context
// in jsdom would add nothing to this assertion.
jest.mock('components/SigmaGraph', () => {
  const React = require('react')
  const Mock = React.forwardRef((props, ref) => {
    // Park the live props so a test can select a node the way a real click on
    // the canvas would, which is the only way NodeProperties ever mounts.
    Mock.lastProps = props
    React.useImperativeHandle(ref, () => ({
      searchNodes: () => [],
      searchNode: () => null,
      focusNode: () => {},
      zoomToFit: () => {},
    }))
    return React.createElement('div', { 'data-testid': 'sigma-graph' })
  })
  return { __esModule: true, default: Mock }
})

jest.mock('lib/helpers', () => ({
  getDgraphClient: jest.fn(),
  executeQuery: jest.fn(),
  // The drill schema cache is keyed by server; without this it cannot tell
  // which cluster it is caching for.
  getCurrentServerUrl: jest.fn(() => 'http://test-alpha:8080'),
}))

import SigmaGraph from 'components/SigmaGraph'
import { invalidateDrillSchema } from 'lib/drillSchema'
import { getDgraphClient } from 'lib/helpers'
import GraphContainer from './GraphContainer'

// GraphContainer is the default result tab (frames.tab === TAB_VISUAL) and
// FrameSession renders it unconditionally, so a throw here white-screens the
// whole app — there is no error boundary above it. These mount it for real:
// any hook-order or temporal-dead-zone regression fails the suite instead of
// reaching a user.
//
// Uses @testing-library rather than enzyme on purpose: enzyme pulls in
// cheerio -> parse5 -> node:stream, which the current jest transform cannot
// resolve (see sp/fix-jest-esm-transform).

const baseProps = {
  graphUpdateHack: '',
  edgesDataset: new Map(),
  nodesDataset: new Map(),
  highlightPredicate: '',
  onCollapseNode: () => {},
  onExpandNode: () => {},
  onSetPanelMinimized: () => {},
  onShowMoreNodes: () => {},
  onPanelResize: () => {},
  panelMinimized: false,
  panelHeight: 400,
  panelWidth: 600,
  remainingNodes: 0,
  hiddenPredicates: new Set(),
}

test('GraphContainer renders without throwing on an empty graph', () => {
  const { unmount } = render(<GraphContainer {...baseProps} />)
  unmount()
})

test('GraphContainer renders without throwing with nodes present', () => {
  const nodesDataset = new Map([
    ['0x1', { id: '0x1', uid: '0x1', label: 'alice', properties: {} }],
    ['0x2', { id: '0x2', uid: '0x2', label: 'bob', properties: {} }],
  ])
  const edgesDataset = new Map([
    ['0x1-0x2-knows', { source: '0x1', target: '0x2', label: 'knows' }],
  ])

  const { unmount } = render(
    <GraphContainer
      {...baseProps}
      graphUpdateHack='1'
      nodesDataset={nodesDataset}
      edgesDataset={edgesDataset}
    />,
  )
  unmount()
})

// The drill's provenance gate lives in NodeProperties, but NodeProperties only
// receives what GraphContainer hands it. A gate the panel is never given is a
// gate that does nothing — the exact "green test, no-op feature" failure this
// codebase has already shipped twice. So assert the WIRE, by selecting a node
// for real and reading what the panel renders.
describe('the drill provenance gate reaches NodeProperties', () => {
  const SCHEMA = [
    {
      predicate: 'external_id',
      type: 'string',
      index: true,
      tokenizer: ['exact'],
    },
  ]

  // Shaped the way lib/graph.js builds it: attrs keyed by the RAW response key,
  // so an aliased key is indistinguishable from a real predicate here.
  const selectedNode = {
    id: '0x1',
    uid: '0x1',
    label: 'alice',
    expanded: false,
    properties: { attrs: { uid: '0x1', external_id: 'Alice' }, facets: {} },
  }

  beforeEach(() => {
    jest.clearAllMocks()
    invalidateDrillSchema()
    getDgraphClient.mockResolvedValue({
      newTxn: () => ({
        query: jest.fn().mockResolvedValue({ data: { schema: SCHEMA } }),
      }),
    })
  })

  const selectNodeIn = async (query) => {
    const store = createStore(
      combineReducers({ query: queryReducer }),
      { query: { query: '{ untouched }', action: 'query' } },
      applyMiddleware(ReduxThunk),
    )
    render(
      <Provider store={store}>
        <GraphContainer
          {...baseProps}
          query={query}
          graphUpdateHack='1'
          nodesDataset={new Map([['0x1', selectedNode]])}
        />
      </Provider>,
    )
    // Clicking a node on the canvas is what opens the properties panel.
    await act(async () => {
      SigmaGraph.lastProps.onNodeSelected(selectedNode)
    })
    await waitFor(() => expect(getDgraphClient).toHaveBeenCalled())
  }

  const drills = () =>
    screen.queryAllByRole('button').filter((b) => b.querySelector('.fa-search'))

  it('offers a drill when the frame query cannot have renamed the key', async () => {
    await selectNodeIn('{ q(func: has(external_id)) { uid external_id } }')
    await waitFor(() => expect(drills().length).toBe(1))
  })

  it('offers NO drill when the frame query aliased the key', async () => {
    await selectNodeIn('{ q(func: has(name)) { uid external_id: name } }')
    expect(drills()).toHaveLength(0)
  })
})
