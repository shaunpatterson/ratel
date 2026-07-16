/*
 * SPDX-FileCopyrightText: © 2017-2026 Istari Digital, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import '@testing-library/jest-dom'
import { act, render, screen, waitFor } from '@testing-library/react'
import React from 'react'

// Where the predicates to expand along COME FROM.
//
// They used to be harvested from the edges already on screen, which fails in
// the two cases that matter most:
//
//   1. `{ q(func: uid(0x1)) { uid } }` puts one node and ZERO edges on screen.
//      The expansion that exists to fetch edges then refused to run at all,
//      because it required the edges you do not yet have. That is the canonical
//      "start from one node and explore" flow, and it was dead.
//
//   2. `friends: friend { uid }` is a legal DQL alias. The parser records the
//      RESPONSE KEY ('friends'), not the schema predicate ('friend'), so the
//      expansion asked for a predicate that does not exist and silently got
//      nothing back.
//
// Both are fixed at the source: the cluster schema is authoritative about which
// predicates are edges. These tests drive the real FrameSession -> real
// GraphContainer -> executeQuery path; only redux, the parser and the RPC are
// faked.

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

// The state of the world after `{ q(func: uid(0x1)) { uid } }`: one node, no
// edges. Nothing about this graph tells you `friend` exists.
let nodesDataset = new Map([['0x1', node('0x1', 'alice')]])
let edgesDataset = new Map()

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

const SCHEMA = {
  data: {
    schema: [
      { predicate: 'friend', type: 'uid' },
      { predicate: 'worksAt', type: 'uid' },
      { predicate: 'name', type: 'string' },
      { predicate: 'age', type: 'int' },
      { predicate: 'dgraph.type', type: 'string' },
    ],
  },
}

const isSchemaQuery = (q) => /^\s*schema\s*\{\s*\}\s*$/.test(q)

// Route the schema probe and the expansion to different answers, the way a real
// cluster does.
const respond = (expansion = { data: { node: [{ uid: '0x1' }] } }) => {
  mockExecuteQuery.mockImplementation((q) =>
    isSchemaQuery(q) ? Promise.resolve(SCHEMA) : Promise.resolve(expansion),
  )
}

const expansionQueries = () =>
  mockExecuteQuery.mock.calls.map(([q]) => q).filter((q) => !isSchemaQuery(q))

const renderSession = () =>
  render(<FrameSession frame={frame} tabResult={{ response: {} }} />)

beforeEach(() => {
  mockExecuteQuery.mockReset()
  mockParser.addResponseToQueue.mockReset()
  nodesDataset = new Map([['0x1', node('0x1', 'alice')]])
  edgesDataset = new Map()
})

test('a single-node result with no edges can still be expanded', async () => {
  respond()
  renderSession()

  // Wait for the schema probe to land before exploring.
  await waitFor(() => expect(mockExecuteQuery).toHaveBeenCalled())

  await act(async () => {
    mockSigmaProps.onNodeDoubleClicked(nodesDataset.get('0x1'))
  })

  // Before this, ZERO queries were sent and the user got
  // "No predicate to expand: this graph has no known edge predicates yet."
  await waitFor(() => expect(expansionQueries()).toHaveLength(1))
  expect(expansionQueries()[0]).toContain('friend')
})

test('expanding a lone node shows no error banner', async () => {
  respond()
  renderSession()
  await waitFor(() => expect(mockExecuteQuery).toHaveBeenCalled())

  await act(async () => {
    mockSigmaProps.onNodeDoubleClicked(nodesDataset.get('0x1'))
  })

  await waitFor(() => expect(expansionQueries()).toHaveLength(1))
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})

test('the expansion is still bounded and never expand(_all_)', async () => {
  // Restoring the flow must not restore the 105,001-node query it replaced.
  respond()
  renderSession()
  await waitFor(() => expect(mockExecuteQuery).toHaveBeenCalled())

  await act(async () => {
    mockSigmaProps.onNodeDoubleClicked(nodesDataset.get('0x1'))
  })

  await waitFor(() => expect(expansionQueries()).toHaveLength(1))
  const query = expansionQueries()[0]
  expect(query).not.toContain('expand(_all_)')
  expect(query).toMatch(/first:\s*\d+/)
})

test('scalar predicates are not expanded as if they were edges', async () => {
  respond()
  renderSession()
  await waitFor(() => expect(mockExecuteQuery).toHaveBeenCalled())

  await act(async () => {
    mockSigmaProps.onNodeDoubleClicked(nodesDataset.get('0x1'))
  })

  await waitFor(() => expect(expansionQueries()).toHaveLength(1))
  const query = expansionQueries()[0]
  // `age` is an int; asking for `age (first: N) { uid }` is a type error, and
  // every scalar admitted here also dilutes the budget away from real edges.
  expect(query).not.toMatch(/age\s*\(first:/)
  expect(query).not.toMatch(/dgraph\.type\s*\(first:/)
})

test('an aliased edge expands the schema predicate, not the response key', async () => {
  // `friends: friend { uid }` -- the parser only ever sees 'friends'.
  edgesDataset = new Map([
    ['0x1-0x2-friends', { source: '0x1', target: '0x2', predicate: 'friends' }],
  ])
  respond()
  renderSession()
  await waitFor(() => expect(mockExecuteQuery).toHaveBeenCalled())

  await act(async () => {
    mockSigmaProps.onNodeDoubleClicked(nodesDataset.get('0x1'))
  })

  await waitFor(() => expect(expansionQueries()).toHaveLength(1))
  const query = expansionQueries()[0]
  // Asking for `friends` returns nothing forever: no such predicate exists.
  expect(query).not.toMatch(/friends\s*\(first:/)
  expect(query).toMatch(/friend\s*\(first:/)
})

test('a graph that already shows edges expands those, not the whole schema', async () => {
  // The schema is the right source for DISCOVERY, and the wrong one for a
  // graph that already tells you what it is made of. Every extra edge list
  // divides the budget again: naming all 2 schema predicates when the user can
  // only see `friend` halves what `friend` returns, and a real 30-predicate
  // schema takes 499 neighbours down to 16. So the schema is used to CONFIRM
  // what is on screen, and only stands in when there is nothing on screen.
  edgesDataset = new Map([
    ['0x1-0x2-friend', { source: '0x1', target: '0x2', predicate: 'friend' }],
  ])
  respond()
  renderSession()
  await waitFor(() => expect(mockExecuteQuery).toHaveBeenCalled())

  await act(async () => {
    mockSigmaProps.onNodeDoubleClicked(nodesDataset.get('0x1'))
  })

  await waitFor(() => expect(expansionQueries()).toHaveLength(1))
  const query = expansionQueries()[0]
  expect(query).toMatch(/friend\s*\(first:/)
  expect(query).not.toMatch(/worksAt\s*\(first:/)
  // The budget must land on the one predicate the user can actually see.
  expect(Number(query.match(/first:\s*(\d+)/)[1])).toBe(499)
})

test('a schema probe that throws synchronously cannot take the frame down', async () => {
  // The probe is best-effort scaffolding for a feature. It renders on mount,
  // so anything it throws lands during render of the whole frame -- and this
  // codebase has already spent four weeks on one white-screen crash. An
  // executeQuery that throws before returning a promise (no connection
  // configured, say) must cost the user expansion quality, not the canvas.
  mockExecuteQuery.mockImplementation(() => {
    throw new Error('no connection')
  })

  expect(() => renderSession()).not.toThrow()
  expect(await screen.findByTestId('sigma-graph')).toBeInTheDocument()
})

test('a schema probe returning a non-promise cannot take the frame down', async () => {
  mockExecuteQuery.mockReturnValue(undefined)

  expect(() => renderSession()).not.toThrow()
  expect(await screen.findByTestId('sigma-graph')).toBeInTheDocument()
})

test('expansion falls back to on-screen predicates when the schema probe fails', async () => {
  // A cluster that refuses `schema {}` (ACLs) must not lose expansion too.
  edgesDataset = new Map([
    ['0x1-0x2-knows', { source: '0x1', target: '0x2', predicate: 'knows' }],
  ])
  mockExecuteQuery.mockImplementation((q) =>
    isSchemaQuery(q)
      ? Promise.reject(new Error('unauthorized'))
      : Promise.resolve({ data: { node: [{ uid: '0x1' }] } }),
  )
  renderSession()
  await waitFor(() => expect(mockExecuteQuery).toHaveBeenCalled())

  await act(async () => {
    mockSigmaProps.onNodeDoubleClicked(nodesDataset.get('0x1'))
  })

  await waitFor(() => expect(expansionQueries()).toHaveLength(1))
  expect(expansionQueries()[0]).toContain('knows')
})
