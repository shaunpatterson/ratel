/*
 * SPDX-FileCopyrightText: © 2017-2026 Istari Digital, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import '@testing-library/jest-dom'
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import React from 'react'

// This drives the real production path end-to-end: FrameSession -> the real
// GraphContainer -> the context menu -> the expand dialog -> executeQuery.
// The only things faked are the boundaries (redux, the parser cache, the WebGL
// renderer, and the RPC itself). Asserting the query FrameSession actually puts
// on the wire is the point: a unit test of the query builder alone would have
// passed happily while FrameSession went on sending expand(_all_).

const mockSigmaProps = {}

jest.mock('components/SigmaGraph', () => {
  const React = require('react')
  return {
    __esModule: true,
    default: React.forwardRef((props, ref) => {
      React.useImperativeHandle(ref, () => ({
        searchNodes: () => [],
        searchNode: () => null,
        focusNode: () => {},
        zoomToFit: () => {},
      }))
      Object.assign(mockSigmaProps, props)
      return React.createElement('div', { 'data-testid': 'sigma-graph' })
    }),
  }
})

jest.mock('react-redux', () => ({
  useSelector: (fn) =>
    fn({ ui: { panelMinimized: false, panelHeight: 400, panelWidth: 600 } }),
  useDispatch: () => () => {},
}))

const mockExecuteQuery = jest.fn()
jest.mock('lib/helpers', () => ({
  executeQuery: (...args) => mockExecuteQuery(...args),
}))

const node = (uid, label) => ({
  id: uid,
  uid,
  label,
  properties: { attrs: { name: label } },
})

const nodesDataset = new Map([
  ['0x1', node('0x1', 'alice')],
  ['0x2', node('0x2', 'bob')],
])
const edgesDataset = new Map([
  ['0x1-0x2-knows', { source: '0x1', target: '0x2', predicate: 'knows' }],
])

const mockParser = {
  getCurrentGraph: () => ({
    nodes: nodesDataset,
    edges: edgesDataset,
    remainingNodes: 0,
    labels: [],
  }),
  addResponseToQueue: jest.fn(),
  processQueue: jest.fn(),
  collapseNode: jest.fn(),
}

jest.mock('lib/graphParserCache', () => ({
  getGraphParser: () => mockParser,
}))

jest.mock('components/EntitySelector', () => ({
  __esModule: true,
  default: () => null,
}))

import FrameSession from './FrameSession'

const frame = {
  id: 'frame-1',
  action: 'query',
  query: '{ q(func: uid(0x1)) { uid } }',
}

const renderSession = () =>
  render(<FrameSession frame={frame} tabResult={{ response: {} }} />)

// FrameSession asks the cluster which predicates are edges before it can build
// a bounded expansion (see FrameSession.discovery.test.js for why the graph on
// screen cannot answer that). That probe shares this mock, so the expansion
// assertions below filter it out rather than counting it.
const isSchemaQuery = (q) => /^\s*schema\s*\{\s*\}\s*$/.test(q)
const expansionQueries = () =>
  mockExecuteQuery.mock.calls.map(([q]) => q).filter((q) => !isSchemaQuery(q))

// The node properties panel carries its own 'Expand' button, so every query
// for the dialog's controls is scoped to the dialog itself.
const expandDialog = () => screen.getByRole('dialog')

const clickExpand = () =>
  fireEvent.click(
    within(expandDialog()).getByRole('button', { name: 'Expand' }),
  )

const openExpandDialog = () => {
  act(() => {
    mockSigmaProps.onNodeSelected(nodesDataset.get('0x1'), {})
  })
  act(() => {
    mockSigmaProps.onNodeContextMenu(nodesDataset.get('0x1'), { x: 10, y: 10 })
  })
  fireEvent.click(screen.getByText('Expand…'))
}

beforeEach(() => {
  mockExecuteQuery.mockReset()
  mockParser.addResponseToQueue.mockReset()
})

test('a rejected expansion shows the user a visible error', async () => {
  // The shape dgraph-js-http rejects with.
  mockExecuteQuery.mockRejectedValue({
    errors: [{ message: 'Predicate knows is not indexed with @reverse' }],
  })

  renderSession()
  openExpandDialog()
  clickExpand()

  // The old code caught this and console.error'd it under the comment
  // "Ignore errors and exceptions on this RPC", making a failed expansion
  // look exactly like a node with no neighbours.
  const alert = await screen.findByRole('alert')
  expect(alert).toHaveTextContent(
    'Predicate knows is not indexed with @reverse',
  )
})

test('the expansion FrameSession sends is bounded, not expand(_all_)', async () => {
  mockExecuteQuery.mockResolvedValue({ data: { node: [{ uid: '0x1' }] } })

  renderSession()
  openExpandDialog()
  clickExpand()

  await waitFor(() => expect(expansionQueries()).toHaveLength(1))

  const [query] = expansionQueries()
  // The nested expand is what pulled 105,001 nodes to draw 400.
  expect(query).not.toContain('expand(_all_)')
  expect(query).toMatch(/first:\s*\d+/)
  expect(query).toContain('knows')
})

test('a successful expansion feeds the parser and closes the dialog', async () => {
  mockExecuteQuery.mockResolvedValue({ data: { node: [{ uid: '0x1' }] } })

  renderSession()
  openExpandDialog()
  clickExpand()

  await waitFor(() => expect(mockParser.addResponseToQueue).toHaveBeenCalled())
  // Expansion still merges into the live parser, creating no new frame.
  expect(mockParser.addResponseToQueue.mock.calls[0][1]).toBe('0x1')
  await waitFor(() =>
    expect(screen.queryByText('Max nodes to fetch')).not.toBeInTheDocument(),
  )
})

test('the budget is global across a multi-node expansion, not per node', async () => {
  mockExecuteQuery.mockResolvedValue({ data: { node: [{ uid: '0x1' }] } })

  renderSession()
  act(() => {
    mockSigmaProps.onNodeSelected(nodesDataset.get('0x1'), {})
  })
  act(() => {
    mockSigmaProps.onNodeSelected(nodesDataset.get('0x2'), { shiftKey: true })
  })
  act(() => {
    mockSigmaProps.onNodeContextMenu(nodesDataset.get('0x1'), { x: 10, y: 10 })
  })
  fireEvent.click(screen.getByText('Expand…'))
  clickExpand()

  await waitFor(() => expect(expansionQueries()).toHaveLength(2))

  // Two nodes sharing one budget of 500 means 250 each. Handing each node the
  // full 500 would make "global budget" a lie the moment anyone multi-selects.
  const limits = expansionQueries().map((q) =>
    Number(q.match(/first:\s*(\d+)/)[1]),
  )
  const predicateCount = 1 // only `knows` is in the fixture
  limits.forEach((limit) => {
    expect(limit * predicateCount + 1).toBeLessThanOrEqual(250)
  })
})

test('the expand button reports pending while the RPC is in flight', async () => {
  let resolve
  mockExecuteQuery.mockReturnValue(
    new Promise((r) => {
      resolve = r
    }),
  )

  renderSession()
  openExpandDialog()
  clickExpand()

  // Without a pending flag the dialog looked idle and invited a second click,
  // doubling the wire.
  expect(await screen.findByText('Expanding…')).toBeInTheDocument()

  await act(async () => {
    resolve({ data: { node: [{ uid: '0x1' }] } })
  })
})
