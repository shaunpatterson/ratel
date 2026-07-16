/*
 * SPDX-FileCopyrightText: © 2017-2026 Istari Digital, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import { act, render } from '@testing-library/react'
import React from 'react'

// These mount FrameSession for real and drive it through its own props, so the
// assertion is about the production call path — not about whatever the parser
// cache does when called directly. The cache only earns its keep if the graph
// the user sees survives a trip through another frame.

jest.mock('react-redux', () => ({
  useDispatch: () => () => {},
  useSelector: () => ({
    panelMinimized: false,
    panelHeight: 400,
    panelWidth: 600,
  }),
}))

jest.mock('lib/helpers', () => ({ executeQuery: jest.fn() }))

// Renders the node count so an assertion can read what the user would see.
// Also parks the live props so the test can fire onExpandNode the way the
// real GraphContainer does on a double-click.
jest.mock('components/GraphContainer', () => {
  const React = require('react')
  const Mock = (props) => {
    Mock.lastProps = props
    return React.createElement(
      'div',
      { 'data-testid': 'node-count' },
      String(props.nodesDataset.size),
    )
  }
  return { __esModule: true, default: Mock }
})

jest.mock('components/EntitySelector', () => ({
  __esModule: true,
  default: () => null,
}))

import GraphContainer from 'components/GraphContainer'
import { executeQuery } from 'lib/helpers'
import FrameSession from './FrameSession'

const frameA = {
  id: 'frame-a',
  action: 'query',
  query: '{ q(func: uid(0x1)) { uid name } }',
}
const tabResultA = {
  response: { data: { q: [{ uid: '0x1', name: 'Alice' }] } },
}

const frameB = {
  id: 'frame-b',
  action: 'query',
  query: '{ q(func: uid(0x9)) { uid name } }',
}
const tabResultB = {
  response: { data: { q: [{ uid: '0x9', name: 'Zed' }] } },
}

const nodeCount = (view) => Number(view.getByTestId('node-count').textContent)

beforeEach(() => executeQuery.mockReset())

test("switching to another frame and back keeps the first frame's expansions", async () => {
  // Frame A: one node on screen.
  let view = render(<FrameSession frame={frameA} tabResult={tabResultA} />)
  expect(nodeCount(view)).toBe(1)

  // The user double-clicks Alice; Bob joins the graph.
  executeQuery.mockResolvedValue({
    data: {
      node: [
        { uid: '0x1', name: 'Alice', friend: [{ uid: '0x2', name: 'Bob' }] },
      ],
    },
  })
  await act(async () => {
    await GraphContainer.lastProps.onExpandNode('0x1')
  })
  expect(nodeCount(view)).toBe(2)
  view.unmount()

  // The user looks at frame B...
  view = render(<FrameSession frame={frameB} tabResult={tabResultB} />)
  expect(nodeCount(view)).toBe(1)
  view.unmount()

  // ...and comes back to A. Bob must still be there.
  view = render(<FrameSession frame={frameA} tabResult={tabResultA} />)
  expect(nodeCount(view)).toBe(2)
  view.unmount()
})

test('re-running a frame rebuilds its graph from the new response', () => {
  // Its own frame id: the cache is module-level and deliberately outlives an
  // unmount, so reusing frameA here would inherit the test above.
  const frameC = { ...frameA, id: 'frame-c' }

  let view = render(<FrameSession frame={frameC} tabResult={tabResultA} />)
  expect(nodeCount(view)).toBe(1)
  view.unmount()

  // Same frame id, fresh response: the graph must reflect the new result
  // rather than serve the parser built from the stale one.
  const rerun = {
    response: {
      data: {
        q: [
          { uid: '0x1', name: 'Alice' },
          { uid: '0x7', name: 'Newcomer' },
        ],
      },
    },
  }
  view = render(<FrameSession frame={frameC} tabResult={rerun} />)
  expect(nodeCount(view)).toBe(2)
  view.unmount()
})
