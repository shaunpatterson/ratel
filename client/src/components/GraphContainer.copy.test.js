/*
 * SPDX-FileCopyrightText: © 2017-2026 Istari Digital, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import '@testing-library/jest-dom'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import React from 'react'
import { Provider } from 'react-redux'
import { applyMiddleware, combineReducers, createStore } from 'redux'
import ReduxThunk from 'redux-thunk'

import queryReducer from 'reducers/query'

// 'Copy value' on the origin Ratel is usually served from.
//
// The existing copy test manufactures a working navigator.clipboard, so it
// asserts the one environment where the old code happened to work. On a plain
// http:// deployment navigator.clipboard is undefined and the old guard --
// `if (navigator.clipboard && navigator.clipboard.writeText)` -- fell straight
// through to closeMenu(). The menu shut, nothing was copied, and the user found
// out at paste time.
//
// These drive the real GraphContainer menu, not the helper.

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
// the copy path under test, and the real helpers would put `schema {}` on the
// wire.
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
])

const baseProps = {
  graphUpdateHack: '1',
  edgesDataset: new Map(),
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
const renderGraph = () =>
  render(
    <Provider
      store={createStore(
        combineReducers({ query: queryReducer }),
        applyMiddleware(ReduxThunk),
      )}
    >
      <GraphContainer {...baseProps} />
    </Provider>,
  )

const setClipboard = (value) =>
  Object.defineProperty(navigator, 'clipboard', {
    value,
    configurable: true,
    writable: true,
  })

const copyNode = (uid) => {
  act(() => {
    sigmaProps.onNodeSelected(nodesDataset.get(uid), {})
  })
  act(() => {
    sigmaProps.onNodeContextMenu(nodesDataset.get(uid), { x: 10, y: 10 })
  })
  fireEvent.click(screen.getByText('Copy value'))
}

afterEach(() => setClipboard(undefined))

test('Copy value still copies with no clipboard API (an http:// origin)', async () => {
  setClipboard(undefined)
  let copied = null
  document.execCommand = jest.fn(() => {
    const textarea = document.querySelector('textarea')
    copied = textarea && textarea.value
    return true
  })

  renderGraph()
  copyNode('0x2')

  await waitFor(() => expect(copied).toBe('bob'))
})

test('Copy value falls back when the clipboard API rejects', async () => {
  setClipboard({ writeText: () => Promise.reject(new Error('denied')) })
  document.execCommand = jest.fn(() => true)

  renderGraph()
  copyNode('0x2')

  await waitFor(() => expect(document.execCommand).toHaveBeenCalledWith('copy'))
})

test('a copy that truly failed says so instead of pretending', async () => {
  setClipboard(undefined)
  document.execCommand = jest.fn(() => false)

  renderGraph()
  copyNode('0x2')

  // Silence here is the bug: the user pastes stale content and blames paste.
  const alert = await screen.findByRole('alert')
  expect(alert).toHaveTextContent(/copy/i)
})

test('a successful copy reports nothing at all', async () => {
  setClipboard({ writeText: () => Promise.resolve() })

  renderGraph()
  copyNode('0x2')

  await waitFor(() =>
    expect(screen.queryByText('Copy value')).not.toBeInTheDocument(),
  )
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})

test('the async clipboard API is still preferred when present', async () => {
  const writeText = jest.fn(() => Promise.resolve())
  setClipboard({ writeText })
  document.execCommand = jest.fn(() => true)

  renderGraph()
  copyNode('0x2')

  await waitFor(() => expect(writeText).toHaveBeenCalledWith('bob'))
  expect(document.execCommand).not.toHaveBeenCalled()
})
