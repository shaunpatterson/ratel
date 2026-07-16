/*
 * SPDX-FileCopyrightText: © 2017-2026 Istari Digital, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

// src/setupTests.js imports these matchers, but jest's config never loads it
// (there is no setupFilesAfterEach), so the file is inert. Import them here
// rather than rewire shared config underneath the other suites.
import '@testing-library/jest-dom'
import { act, fireEvent, render, screen } from '@testing-library/react'
import React from 'react'
import { Provider } from 'react-redux'
import { applyMiddleware, combineReducers, createStore } from 'redux'
import ReduxThunk from 'redux-thunk'

import queryReducer from 'reducers/query'

// Captures the props GraphContainer actually hands the renderer. The verbs are
// only real if they reach SigmaGraph, so the assertions below read what was
// passed down rather than poking at internal state.
const sigmaProps = {}

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
      Object.assign(sigmaProps, props)
      return React.createElement('div', { 'data-testid': 'sigma-graph' })
    }),
  }
})

// Selecting a node mounts NodeProperties, which reads the drill schema through
// these. Stubbed the way GraphContainer.test.js does: the panel is incidental to
// the verbs under test, and the real helpers would put `schema {}` on the wire.
jest.mock('lib/helpers', () => ({
  executeQuery: jest.fn(),
  // The drill schema cache is keyed by server; without this it cannot tell
  // which cluster it is caching for.
  getCurrentServerUrl: jest.fn(() => 'http://test-alpha:8080'),
  getDgraphClient: jest.fn(async () => ({
    newTxn: () => ({ query: async () => ({ data: { schema: [] } }) }),
  })),
}))

import GraphContainer from './GraphContainer'

const node = (uid, label) => ({
  id: uid,
  uid,
  label,
  properties: { attrs: { name: label } },
})

const nodesDataset = new Map([
  ['0x1', node('0x1', 'alice')],
  ['0x2', node('0x2', 'bob')],
  ['0x3', node('0x3', 'carol')],
  ['0x4', node('0x4', 'dave')],
])

const edgesDataset = new Map([
  ['0x1-0x2-knows', { source: '0x1', target: '0x2', predicate: 'knows' }],
  ['0x3-0x4-knows', { source: '0x3', target: '0x4', predicate: 'knows' }],
])

const baseProps = {
  graphUpdateHack: '1',
  edgesDataset,
  nodesDataset,
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

// NodeProperties (mounted as soon as a node is selected) dispatches drills, so
// the tree needs a real store the way GraphContainer.test.js gives it one.
const renderGraph = (props = {}) =>
  render(
    <Provider
      store={createStore(
        combineReducers({ query: queryReducer }),
        applyMiddleware(ReduxThunk),
      )}
    >
      <GraphContainer {...baseProps} {...props} />
    </Provider>,
  )

// Drives the production callback SigmaGraph would fire, modifier and all.
const clickNode = (uid, { shiftKey = false } = {}) =>
  act(() => {
    sigmaProps.onNodeSelected(nodesDataset.get(uid), { shiftKey })
  })

const rightClickNode = (uid) =>
  act(() => {
    sigmaProps.onNodeContextMenu(nodesDataset.get(uid), { x: 50, y: 60 })
  })

test('shift-clicking three nodes selects all three and the menu says so', () => {
  renderGraph()

  clickNode('0x1')
  clickNode('0x2', { shiftKey: true })
  clickNode('0x3', { shiftKey: true })

  rightClickNode('0x3')

  expect(screen.getByText('3 nodes selected')).toBeInTheDocument()
})

test('a plain click replaces the selection instead of adding to it', () => {
  renderGraph()

  clickNode('0x1')
  clickNode('0x2', { shiftKey: true })
  clickNode('0x4')

  rightClickNode('0x4')

  expect(screen.getByText('1 node selected')).toBeInTheDocument()
})

test('shift-clicking a selected node deselects it', () => {
  renderGraph()

  clickNode('0x1')
  clickNode('0x2', { shiftKey: true })
  clickNode('0x2', { shiftKey: true })

  rightClickNode('0x1')

  expect(screen.getByText('1 node selected')).toBeInTheDocument()
})

test('Hide hides exactly the selected nodes, and the renderer is told', () => {
  renderGraph()

  clickNode('0x1')
  clickNode('0x2', { shiftKey: true })
  clickNode('0x3', { shiftKey: true })
  rightClickNode('0x3')

  fireEvent.click(screen.getByText('Hide'))

  // Exactly those three -- not 0x4, which was never selected.
  expect(Array.from(sigmaProps.hiddenIds).sort()).toEqual(['0x1', '0x2', '0x3'])
})

test('Hide others hides the complement of the selection', () => {
  renderGraph()

  clickNode('0x1')
  clickNode('0x2', { shiftKey: true })
  rightClickNode('0x1')

  fireEvent.click(screen.getByText('Hide others'))

  expect(Array.from(sigmaProps.hiddenIds).sort()).toEqual(['0x3', '0x4'])
})

test('right-clicking an unselected node makes it the selection', () => {
  renderGraph()

  clickNode('0x1')
  clickNode('0x2', { shiftKey: true })
  // Right-clicking outside the current selection should target what the user
  // actually pointed at, not silently act on the old selection.
  rightClickNode('0x4')

  expect(screen.getByText('1 node selected')).toBeInTheDocument()

  fireEvent.click(screen.getByText('Hide'))
  expect(Array.from(sigmaProps.hiddenIds)).toEqual(['0x4'])
})

test('right-clicking inside the selection keeps the whole selection', () => {
  renderGraph()

  clickNode('0x1')
  clickNode('0x2', { shiftKey: true })
  clickNode('0x3', { shiftKey: true })
  rightClickNode('0x2')

  expect(screen.getByText('3 nodes selected')).toBeInTheDocument()
})

// The escape hatch. "Hide others" without a way back is just a new dead end --
// the exact pain this feature exists to remove.
test('Show hidden brings hidden nodes back', () => {
  renderGraph()

  clickNode('0x1')
  rightClickNode('0x1')
  fireEvent.click(screen.getByText('Hide'))
  expect(sigmaProps.hiddenIds.size).toBe(1)

  fireEvent.click(screen.getByText(/Show hidden/))
  expect(sigmaProps.hiddenIds.size).toBe(0)
})

test('the hidden banner counts what is hidden and stays away when nothing is', () => {
  renderGraph()

  expect(screen.queryByText(/Show hidden/)).not.toBeInTheDocument()

  clickNode('0x1')
  clickNode('0x2', { shiftKey: true })
  rightClickNode('0x1')
  fireEvent.click(screen.getByText('Hide'))

  expect(screen.getByText('2 hidden')).toBeInTheDocument()
})

test('Reset view clears hidden nodes and the selection together', () => {
  renderGraph()

  clickNode('0x1')
  rightClickNode('0x1')
  fireEvent.click(screen.getByText('Hide others'))
  expect(sigmaProps.hiddenIds.size).toBe(3)

  fireEvent.click(screen.getByText('Reset view'))

  expect(sigmaProps.hiddenIds.size).toBe(0)
  expect(screen.queryByText(/hidden/)).not.toBeInTheDocument()
})

test('the menu closes after a verb runs', () => {
  renderGraph()

  clickNode('0x1')
  rightClickNode('0x1')
  expect(screen.getByText('Hide others')).toBeInTheDocument()

  fireEvent.click(screen.getByText('Hide'))

  expect(screen.queryByText('Hide others')).not.toBeInTheDocument()
})

test('Copy value copies the node label to the clipboard', async () => {
  const writeText = jest.fn(() => Promise.resolve())
  Object.assign(navigator, { clipboard: { writeText } })

  renderGraph()

  clickNode('0x2')
  rightClickNode('0x2')
  fireEvent.click(screen.getByText('Copy value'))

  expect(writeText).toHaveBeenCalledWith('bob')
})

// "Hide" sits one keystroke from "Delete" in most menus. Keeping destructive
// verbs out of this menu entirely is the mitigation, so assert it rather than
// trusting review to catch a later addition.
test('the menu offers no destructive verb', () => {
  renderGraph()

  clickNode('0x1')
  rightClickNode('0x1')

  expect(screen.queryByText(/Delete/i)).not.toBeInTheDocument()
  expect(screen.queryByText(/Remove/i)).not.toBeInTheDocument()
  expect(screen.queryByText(/Drop/i)).not.toBeInTheDocument()
})
