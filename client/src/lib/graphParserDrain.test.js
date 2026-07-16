/*
 * SPDX-FileCopyrightText: © 2017-2026 Istari Digital, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import { GraphParser } from './graph'

// processQueue is a drain loop: every queued node must be processed before it
// returns (barring the maxAdd budget). Hitting an edge that was already drawn
// is a completely ordinary event when you expand a node whose neighbours are
// partly on screen already — it must not stop the drain.

const firstResponse = {
  q: [
    {
      uid: '0x1',
      name: 'Alice',
      friend: [{ uid: '0x2', name: 'Bob' }],
    },
  ],
}

// Same shape, but Alice now also has a brand new friend Carol. Bob's edge
// (0x1 -friend-> 0x2) is already in edgesDataset from the first pass, and Bob
// sits in the queue AHEAD of Carol.
const expansionResponse = {
  q: [
    {
      uid: '0x1',
      name: 'Alice',
      friend: [
        { uid: '0x2', name: 'Bob' },
        { uid: '0x3', name: 'Carol' },
      ],
    },
  ],
}

test('processQueue keeps draining past an edge it has already seen', () => {
  const parser = new GraphParser()
  parser.addResponseToQueue(firstResponse)
  parser.processQueue('Name')

  expect([...parser.getCurrentGraph().nodes.keys()].sort()).toEqual([
    '0x1',
    '0x2',
  ])

  parser.addResponseToQueue(expansionResponse, '0x1')
  parser.processQueue('Name')

  const graph = parser.getCurrentGraph()
  // Carol is queued BEHIND Bob, whose edge already exists. She must still land.
  expect(graph.nodes.has('0x3')).toBe(true)
  expect(graph.remainingNodes).toBe(0)
  expect(graph.edges.has('0x1-0x3-friend')).toBe(true)
})

test('an already-seen edge still merges its facets', () => {
  const parser = new GraphParser()
  parser.addResponseToQueue({
    q: [{ uid: '0x1', friend: [{ uid: '0x2', 'friend|since': 2019 }] }],
  })
  parser.processQueue('Name')

  parser.addResponseToQueue({
    q: [{ uid: '0x1', friend: [{ uid: '0x2', 'friend|weight': 7 }] }],
  })
  parser.processQueue('Name')

  expect(parser.getCurrentGraph().edges.get('0x1-0x2-friend').facets).toEqual({
    since: 2019,
    weight: 7,
  })
})

// The reported symptom of the aborted drain: the user double-clicks a node,
// the multi-MB expansion query fires, and nothing appears — because a leftover
// queued node sitting in front of it hit an already-seen edge and killed the
// drain before the expansion root was ever reached. So the node never gets
// marked expanded either, and the next double-click re-fires the same query
// for the same nothing.
test('an expansion queued behind a stale leftover node still lands', () => {
  const parser = new GraphParser()
  parser.addResponseToQueue(firstResponse)
  parser.processQueue('Name')

  // A leftover queued entry that re-states the existing 0x1 -friend-> 0x2 edge,
  // as a partially-drained queue would hold after a maxAdd cutoff.
  parser.addResponseToQueue(firstResponse)
  // The user's expansion of 0x1 is appended AFTER that leftover.
  parser.addResponseToQueue(expansionResponse, '0x1')
  parser.processQueue('Name')

  const graph = parser.getCurrentGraph()
  expect(graph.nodes.has('0x3')).toBe(true)
  expect(graph.nodes.get('0x1').expanded).toBe(true)
  expect(graph.remainingNodes).toBe(0)
})
