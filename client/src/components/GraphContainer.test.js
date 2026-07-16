/*
 * SPDX-FileCopyrightText: © 2017-2026 Istari Digital, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import { render } from '@testing-library/react'
import React from 'react'

// SigmaGraph is a WebGL renderer whose componentDidMount calls sigma's SDF
// shape helpers, which config/jest/sigmaMock.js does not stub. Mock the child:
// the hooks under test live in GraphContainer itself, and a real WebGL context
// in jsdom would add nothing to this assertion.
jest.mock('components/SigmaGraph', () => {
  const React = require('react')
  return {
    __esModule: true,
    default: React.forwardRef((_props, ref) => {
      React.useImperativeHandle(ref, () => ({
        searchNodes: () => [],
        searchNode: () => null,
        focusNode: () => {},
        zoomToFit: () => {},
      }))
      return React.createElement('div', { 'data-testid': 'sigma-graph' })
    }),
  }
})

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
