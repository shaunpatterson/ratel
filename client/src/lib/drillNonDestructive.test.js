/*
 * SPDX-FileCopyrightText: © 2017-2026 Istari Digital, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import { getGraphParser } from 'lib/graphParserCache'

// ACCEPTANCE 5 for the value drill-down.
//
// Wiring a drill turns a passive dead end into a DESTRUCTIVE one if a frame's
// accumulated exploration can't survive looking at another frame. Before the
// parser cache was keyed by frame id it was a memoize-one — a cache of SIZE ONE
// — so drilling from frame A to frame B evicted A's parser, and returning to A
// silently rebuilt it from the original response with every expansion thrown
// away. The drill would have destroyed the exact work it was meant to extend.
//
// This asserts the property the drill depends on, at the layer that owns it.

const responseA = { data: { q: [{ uid: '0x1', name: 'Alice' }] } }
const responseB = { data: { q: [{ uid: '0xb0', name: 'DrillResult' }] } }

const expansionFor = (uid) => ({
  data: {
    q: [
      {
        uid,
        name: `Expanded ${uid}`,
        friend: [{ uid: `${uid}f`, name: 'Friend' }],
      },
    ],
  },
})

test('three expansions on frame A survive a drill to frame B and back', () => {
  const parserA = getGraphParser('frame-A', responseA, false)

  // Expand three nodes, the way clicking three nodes in the graph would.
  for (const uid of ['0xa1', '0xa2', '0xa3']) {
    parserA.addResponseToQueue(expansionFor(uid).data)
    parserA.processQueue('Name')
  }

  const afterExpansion = parserA.getCurrentGraph().nodes.size
  expect(afterExpansion).toBeGreaterThan(responseA.data.q.length)

  // Drill: a second frame is created and rendered.
  getGraphParser('frame-B', responseB, false)

  // Return to frame A.
  const parserAAgain = getGraphParser('frame-A', responseA, false)

  expect(parserAAgain).toBe(parserA)
  const nodes = parserAAgain.getCurrentGraph().nodes
  expect(nodes.size).toBe(afterExpansion)
  for (const uid of ['0xa1', '0xa2', '0xa3']) {
    expect(nodes.has(uid)).toBe(true)
  }
})
