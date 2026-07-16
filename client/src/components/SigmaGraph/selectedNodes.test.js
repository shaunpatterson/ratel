/*
 * SPDX-FileCopyrightText: © 2017-2026 Istari Digital, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import { render } from '@testing-library/react'
import React from 'react'

jest.mock('graphology-layout-forceatlas2/worker', () => {
  return class FA2LayoutStub {
    start() {}
    stop() {}
    kill() {}
  }
})

import SigmaGraph from './index'

// Multi-selection has to be VISIBLE, and visible means the reducer sigma calls
// on every frame says so. GraphContainer passed `selectedNodes` down and
// SigmaGraph never read it: shift-clicking three nodes highlighted at most one,
// because the only highlight branch keyed off the single `activeNode`. The
// selection tests stayed green because they asserted the context-menu header
// and never the canvas -- structurally the same no-op that shipped
// Color:Community and Size:Centrality.
//
// So these assertions run the REAL nodeReducer off a REAL mounted renderer,
// exactly as hiddenIds.test.js does, rather than a helper written for the test.

const node = (uid, label) => ({
  id: uid,
  uid,
  label,
  properties: { attrs: {} },
})

const nodes = new Map([
  ['0x1', node('0x1', 'alice')],
  ['0x2', node('0x2', 'bob')],
  ['0x3', node('0x3', 'carol')],
])

const edge = (source, target) => ({
  source,
  target,
  label: 'knows',
  predicate: 'knows',
  fromTo: `${source}-${target}`,
})

const edges = new Map([
  ['0x1-0x2-knows', edge('0x1', '0x2')],
  ['0x2-0x3-knows', edge('0x2', '0x3')],
])

const baseProps = {
  nodes,
  edges,
  graphUpdateHack: '1',
  onNodeHovered: () => {},
  onNodeSelected: () => {},
  onNodeDoubleClicked: () => {},
  onEdgeHovered: () => {},
  onEdgeSelected: () => {},
  hiddenPredicates: new Set(),
  hiddenIds: new Set(),
  layout: 'force',
  colorBy: 'group',
  sizeBy: 'degree',
  styleRules: {},
  defaultLabelPosition: 'inside',
}

const mount = (props) => {
  const ref = React.createRef()
  render(<SigmaGraph {...baseProps} {...props} ref={ref} />)
  return ref.current
}

const reduce = (instance, uid) =>
  instance.nodeReducer(uid, null, instance.graph.getNodeAttributes(uid))

test('every node in a multi-selection is highlighted, not just one', () => {
  const instance = mount({ selectedNodes: new Set(['0x1', '0x3']) })

  // The whole point of shift-click. Before this, `highlighted` came back
  // undefined for both and the canvas showed no selection at all.
  expect(reduce(instance, '0x1').highlighted).toBe(true)
  expect(reduce(instance, '0x3').highlighted).toBe(true)
})

test('a node outside the selection is not highlighted', () => {
  const instance = mount({ selectedNodes: new Set(['0x1', '0x3']) })

  expect(reduce(instance, '0x2').highlighted).toBeFalsy()
})

test('selection highlight does not depend on the properties-panel node', () => {
  // activeNode drives the panel and is deliberately a single node. Selection
  // highlight must not be parasitic on it: here nothing is hovered/inspected,
  // yet two nodes are selected and both must show.
  const instance = mount({
    selectedNodes: new Set(['0x2', '0x3']),
    activeNode: null,
  })

  expect(reduce(instance, '0x2').highlighted).toBe(true)
  expect(reduce(instance, '0x3').highlighted).toBe(true)
  expect(reduce(instance, '0x1').highlighted).toBeFalsy()
})

test('a hidden node is not highlighted even when selected', () => {
  // Hide wins over selection: Hide-then-Expand leaves uids in selectedNodes,
  // and a hidden node that still glowed would be a ghost.
  const instance = mount({
    selectedNodes: new Set(['0x1']),
    hiddenIds: new Set(['0x1']),
  })

  expect(reduce(instance, '0x1').hidden).toBe(true)
  expect(reduce(instance, '0x1').highlighted).toBeFalsy()
})

test('the single-node activeNode highlight still works', () => {
  // Regression guard: plain click / hover behaviour predates selection and
  // must survive it.
  const instance = mount({
    selectedNodes: new Set(),
    activeNode: nodes.get('0x2'),
  })

  expect(reduce(instance, '0x2').highlighted).toBe(true)
  expect(reduce(instance, '0x1').highlighted).toBeFalsy()
})
