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

// Expanding a multi-selection issues one RPC PER SELECTED NODE, sequentially.
// Bounding the nodes each response may carry says nothing about how many
// requests the loop makes, and the user had no way to stop it: Cancel was
// disabled for the whole run, justified by a comment arguing that because
// dgraph-js-http exposes no AbortSignal, cancelling was pointless.
//
// That reasoning is wrong. The IN-FLIGHT request cannot be aborted, but the
// QUEUED ones have not been sent yet -- and those are the ones worth stopping.
// Unmounting has the same problem: switching frames mid-expansion left the loop
// hammering the cluster for a canvas nobody is looking at.

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

const mockNodes = new Map([
  ['0x1', node('0x1', 'alice')],
  ['0x2', node('0x2', 'bob')],
  ['0x3', node('0x3', 'carol')],
])
const mockEdges = new Map([
  ['0x1-0x2-knows', { source: '0x1', target: '0x2', predicate: 'knows' }],
])

const mockParser = {
  getCurrentGraph: () => ({
    nodes: mockNodes,
    edges: mockEdges,
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

const isSchemaQuery = (q) => /^\s*schema\s*\{\s*\}\s*$/.test(q)
const expansionCalls = () =>
  mockExecuteQuery.mock.calls.filter(([q]) => !isSchemaQuery(q))

// Hand back a promise per expansion so the loop can be frozen mid-run.
let pendingResolvers = []
const holdExpansions = () => {
  pendingResolvers = []
  mockExecuteQuery.mockImplementation((q) => {
    if (isSchemaQuery(q)) {
      return Promise.resolve({ data: { schema: [] } })
    }
    return new Promise((resolve) => {
      pendingResolvers.push(() => resolve({ data: { node: [{ uid: '0x1' }] } }))
    })
  })
}

const renderSession = () =>
  render(<FrameSession frame={frame} tabResult={{ response: {} }} />)

const selectThreeAndExpand = async () => {
  await waitFor(() => expect(mockExecuteQuery).toHaveBeenCalled())
  act(() => {
    mockSigmaProps.onNodeSelected(mockNodes.get('0x1'), {})
  })
  act(() => {
    mockSigmaProps.onNodeSelected(mockNodes.get('0x2'), { shiftKey: true })
  })
  act(() => {
    mockSigmaProps.onNodeSelected(mockNodes.get('0x3'), { shiftKey: true })
  })
  act(() => {
    mockSigmaProps.onNodeContextMenu(mockNodes.get('0x1'), { x: 10, y: 10 })
  })
  fireEvent.click(screen.getByText('Expand…'))
  fireEvent.click(
    within(screen.getByRole('dialog')).getByRole('button', { name: 'Expand' }),
  )
}

beforeEach(() => {
  mockExecuteQuery.mockReset()
  mockParser.addResponseToQueue.mockReset()
  pendingResolvers = []
})

test('Cancel is clickable while an expansion is running', async () => {
  holdExpansions()
  renderSession()
  await selectThreeAndExpand()

  await waitFor(() => expect(expansionCalls()).toHaveLength(1))

  // It was `disabled={pending}`: the one moment you actually want to cancel is
  // the one moment you could not.
  const cancel = within(screen.getByRole('dialog')).getByRole('button', {
    name: 'Cancel',
  })
  expect(cancel).not.toBeDisabled()
})

test('cancelling stops the queued RPCs the loop had not sent yet', async () => {
  holdExpansions()
  renderSession()
  await selectThreeAndExpand()

  await waitFor(() => expect(expansionCalls()).toHaveLength(1))

  fireEvent.click(
    within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }),
  )

  // Let the in-flight request land. It cannot be un-sent -- but nodes 2 and 3
  // must never go on the wire.
  await act(async () => {
    pendingResolvers.forEach((r) => r())
  })

  await waitFor(() =>
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
  )
  expect(expansionCalls()).toHaveLength(1)
})

test('a cancelled expansion still merges the response it already paid for', async () => {
  // The bytes are already bought; throwing them away would be a second waste.
  holdExpansions()
  renderSession()
  await selectThreeAndExpand()

  await waitFor(() => expect(expansionCalls()).toHaveLength(1))
  fireEvent.click(
    within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }),
  )
  await act(async () => {
    pendingResolvers.forEach((r) => r())
  })

  expect(mockParser.addResponseToQueue).toHaveBeenCalledTimes(1)
})

test('unmounting mid-expansion stops the loop', async () => {
  holdExpansions()
  const { unmount } = renderSession()
  await selectThreeAndExpand()

  await waitFor(() => expect(expansionCalls()).toHaveLength(1))

  unmount()
  await act(async () => {
    pendingResolvers.forEach((r) => r())
  })

  // Switching frames must not leave a loop querying the cluster for a canvas
  // that no longer exists.
  expect(expansionCalls()).toHaveLength(1)
})

test('an uncancelled multi-node expansion still expands every selected node', async () => {
  // Regression guard: cancellation must not break the normal path.
  mockExecuteQuery.mockImplementation((q) =>
    isSchemaQuery(q)
      ? Promise.resolve({ data: { schema: [] } })
      : Promise.resolve({ data: { node: [{ uid: '0x1' }] } }),
  )
  renderSession()
  await selectThreeAndExpand()

  await waitFor(() => expect(expansionCalls()).toHaveLength(3))
})
