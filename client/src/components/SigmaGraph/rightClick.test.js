/*
 * SPDX-FileCopyrightText: © 2017-2026 Istari Digital, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import { render } from '@testing-library/react'
import React from 'react'

// The force layout spawns a real web worker off a blob URL, which jsdom has no
// URL.createObjectURL for. It only moves nodes around; it has no bearing on
// event binding, so stub the worker rather than the component under test.
jest.mock('graphology-layout-forceatlas2/worker', () => {
  return class FA2LayoutStub {
    start() {}
    stop() {}
    kill() {}
  }
})

import SigmaGraph from './index'

// Scope note, stated plainly rather than implied:
//
// Jest cannot exercise sigma's own DOM fan-out. The real path is
// container 'contextmenu' -> MouseCaptor.emit('rightClick') ->
// createInteractionListener('rightClick') -> resolveEventHit ->
// emit('rightClickNode'), and config/jest/sigmaMock.js models none of it (no
// DOM listener, no hit resolution) because sigma v4's ESM bundle touches
// WebGL2RenderingContext at module load and cannot run in jsdom at all.
//
// That fan-out is sigma's code, not ours, and it was verified by reading the
// installed sigma 4.0.0-alpha.7 bundle: :508 binds a 'contextmenu' listener,
// :575 emits 'rightClick', :1900 wires createInteractionListener('rightClick')
// -> rightClickNode/rightClickEdge via the identical resolveEventHit path as
// clickNode, and :1950 binds it on the mouseCaptor.
//
// What IS ours, and what these tests cover, is the binding: that we listen for
// rightClickNode at all, that we call preventDefault on the underlying DOM
// event (sigma's handleRightClick only preventDefaults when
// enableCameraMouseRotation is set, so ours is required or the browser menu
// wins), and that we hand the coordinates up. Those are asserted through the
// mounted component's real bindEvents(), not by calling a helper directly.

const nodes = new Map([
  ['0x1', { id: '0x1', uid: '0x1', label: 'alice', properties: { attrs: {} } }],
  ['0x2', { id: '0x2', uid: '0x2', label: 'bob', properties: { attrs: {} } }],
])
const edges = new Map([
  [
    '0x1-0x2-knows',
    {
      source: '0x1',
      target: '0x2',
      label: 'knows',
      predicate: 'knows',
      fromTo: '0x1-0x2',
    },
  ],
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

const rightClickPayload = (node) => {
  const preventDefault = jest.fn()
  return {
    payload: {
      node,
      event: { x: 120, y: 80, original: { preventDefault } },
    },
    preventDefault,
  }
}

test('right-clicking a node calls preventDefault and reports the node upward', () => {
  const onNodeContextMenu = jest.fn()
  const ref = React.createRef()

  render(
    <SigmaGraph
      {...baseProps}
      ref={ref}
      onNodeContextMenu={onNodeContextMenu}
      onStageContextMenu={() => {}}
    />,
  )

  const { payload, preventDefault } = rightClickPayload('0x1')
  ref.current.renderer.emit('rightClickNode', payload)

  // Without this the browser's own context menu opens over the canvas.
  expect(preventDefault).toHaveBeenCalled()
  expect(onNodeContextMenu).toHaveBeenCalledTimes(1)

  const [node, coords] = onNodeContextMenu.mock.calls[0]
  // The original node object, matching clickNode's contract -- not the raw uid.
  expect(node.uid).toBe('0x1')
  expect(coords).toEqual({ x: 120, y: 80 })
})

test('right-clicking empty canvas calls preventDefault and closes via the stage handler', () => {
  const onStageContextMenu = jest.fn()
  const ref = React.createRef()

  render(
    <SigmaGraph
      {...baseProps}
      ref={ref}
      onNodeContextMenu={() => {}}
      onStageContextMenu={onStageContextMenu}
    />,
  )

  const preventDefault = jest.fn()
  ref.current.renderer.emit('rightClickStage', {
    event: { x: 5, y: 5, original: { preventDefault } },
  })

  expect(preventDefault).toHaveBeenCalled()
  expect(onStageContextMenu).toHaveBeenCalledTimes(1)
})
