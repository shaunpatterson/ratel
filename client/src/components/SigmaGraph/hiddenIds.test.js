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

// Hiding is a SCENE layer, not a dataset edit. These assertions run the real
// nodeReducer/edgeReducer that sigma itself calls on every frame -- the same
// functions passed into the renderer in componentDidMount -- rather than a
// helper written for the test. A reducer that returned the right answer while
// never being wired to the renderer is exactly how two toolbar features once
// shipped as no-ops with green tests.

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
  layout: 'force',
  colorBy: 'group',
  sizeBy: 'degree',
  styleRules: {},
  defaultLabelPosition: 'inside',
}

const mount = (hiddenIds) => {
  const ref = React.createRef()
  render(<SigmaGraph {...baseProps} ref={ref} hiddenIds={hiddenIds} />)
  return ref.current
}

const attrsFor = (graph, uid) => graph.getNodeAttributes(uid)
// sigma hands the reducer the graphology edge attributes (which carry
// originalEdge), not the raw dataset entry. Read them off the real graph so
// the reducer is exercised with exactly what it gets in production.
const edgeAttrsFor = (graph, key) => graph.getEdgeAttributes(key)

test('a hidden node is hidden by the reducer the renderer actually calls', () => {
  const instance = mount(new Set(['0x2']))

  const hiddenRes = instance.nodeReducer(
    '0x2',
    null,
    attrsFor(instance.graph, '0x2'),
  )
  expect(hiddenRes.hidden).toBe(true)

  const visibleRes = instance.nodeReducer(
    '0x1',
    null,
    attrsFor(instance.graph, '0x1'),
  )
  expect(visibleRes.hidden).toBeFalsy()
})

test('hiding a node hides its incident edges, both directions', () => {
  const instance = mount(new Set(['0x2']))

  // 0x2 is the target of one edge and the source of the other; both must go,
  // or Hide leaves edges dangling into empty space.
  expect(
    instance.edgeReducer(
      '0x1-0x2-knows',
      null,
      edgeAttrsFor(instance.graph, '0x1-0x2-knows'),
    ).hidden,
  ).toBe(true)
  expect(
    instance.edgeReducer(
      '0x2-0x3-knows',
      null,
      edgeAttrsFor(instance.graph, '0x2-0x3-knows'),
    ).hidden,
  ).toBe(true)
})

test('an edge between two visible nodes survives', () => {
  const instance = mount(new Set(['0x3']))

  expect(
    instance.edgeReducer(
      '0x1-0x2-knows',
      null,
      edgeAttrsFor(instance.graph, '0x1-0x2-knows'),
    ).hidden,
  ).toBeFalsy()
})

test('nothing is hidden when hiddenIds is empty', () => {
  const instance = mount(new Set())

  expect(
    instance.nodeReducer('0x1', null, attrsFor(instance.graph, '0x1')).hidden,
  ).toBeFalsy()
  expect(
    instance.edgeReducer(
      '0x1-0x2-knows',
      null,
      edgeAttrsFor(instance.graph, '0x1-0x2-knows'),
    ).hidden,
  ).toBeFalsy()
})

// Expansion merges into the live GraphParser Maps in place. If hiding were a
// dataset edit it would be undone by the next merge; as a scene layer it holds.
test('hidden nodes stay hidden after the dataset grows underneath', () => {
  const hiddenIds = new Set(['0x2'])
  const ref = React.createRef()
  const { rerender } = render(
    <SigmaGraph {...baseProps} ref={ref} hiddenIds={hiddenIds} />,
  )

  const grown = new Map(nodes)
  grown.set('0x4', node('0x4', 'dave'))
  const grownEdges = new Map(edges)
  grownEdges.set('0x2-0x4-knows', edge('0x2', '0x4'))

  rerender(
    <SigmaGraph
      {...baseProps}
      ref={ref}
      nodes={grown}
      edges={grownEdges}
      graphUpdateHack='2'
      hiddenIds={hiddenIds}
    />,
  )

  expect(
    ref.current.nodeReducer('0x2', null, attrsFor(ref.current.graph, '0x2'))
      .hidden,
  ).toBe(true)
})
