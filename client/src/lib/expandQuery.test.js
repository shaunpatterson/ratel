/*
 * SPDX-FileCopyrightText: © 2017-2026 Istari Digital, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import { buildExpandQuery, perPredicateLimit } from './expandQuery'

/**
 * Count the distinct nodes a Dgraph response actually carries.
 *
 * Deliberately counts the RESPONSE rather than what got rendered: the whole
 * failure being fixed here is a query that pulls 105,001 nodes to draw 400, so
 * a rendered-count assertion would have passed against the broken code.
 *
 * Lives here rather than in lib/ because it has no production caller and never
 * had one -- it exists to let the fake Dgraph below prove its own fixture. An
 * exported helper that only tests use reads like a shipped safety check and is
 * not one; nothing in the app counts the response.
 */
function countResponseNodes(data) {
  const seen = new Set()
  const walk = (value) => {
    if (Array.isArray(value)) {
      value.forEach(walk)
      return
    }
    if (!value || typeof value !== 'object') {
      return
    }
    if (typeof value.uid === 'string') {
      seen.add(value.uid)
    }
    Object.values(value).forEach(walk)
  }
  walk(data)
  return seen.size
}

// The query FrameSession shipped before bounded expansion existed. Kept here
// verbatim as the control: the whole point of this module is that this shape
// is unbounded, so the fixture must reproduce its blow-up before we can claim
// to have fixed it.
const NAIVE_QUERY = `{
      node(func:uid(0x1)) {
        uid
        expand(_all_) {
          uid
          expand(_all_)
        }
      }
    }`

const PREDICATES = ['p0', 'p1', 'p2', 'p3', 'p4']

// A 5000-degree hub: 5 predicates x 1000 neighbours, each neighbour carrying
// 20 of its own. Depth-two expansion therefore touches
// 1 + 5000 + (5000 * 20) = 105,001 nodes -- the number measured against a real
// Dgraph in the deep dive.
function makeHubFixture() {
  const adj = new Map()
  let next = 2
  const nextUid = () => `0x${(next++).toString(16)}`

  const hub = {}
  const firstRing = []
  PREDICATES.forEach((pred) => {
    hub[pred] = []
    for (let i = 0; i < 1000; i++) {
      const uid = nextUid()
      hub[pred].push(uid)
      firstRing.push(uid)
    }
  })
  adj.set('0x1', { attrs: { name: 'hub' }, edges: hub })

  firstRing.forEach((uid) => {
    const edges = { p0: [] }
    for (let i = 0; i < 20; i++) {
      const leaf = nextUid()
      edges.p0.push(leaf)
      adj.set(leaf, { attrs: { name: `leaf-${leaf}` }, edges: {} })
    }
    adj.set(uid, { attrs: { name: `ring-${uid}` }, edges })
  })

  return adj
}

// A deliberately small stand-in for Dgraph that models the only two query
// shapes in play: nested `expand(_all_)` (expand every predicate, no
// pagination) and named predicates carrying `(first: N)` (paginate that edge
// list). It is not a DQL parser; it is just faithful enough on those two
// shapes to make the bounding claim falsifiable.
function fakeDgraph(query, adj) {
  const rootUid = query.match(/uid\((0x[0-9a-f]+)\)/)[1]

  const expandNode = (uid, depth) => {
    const entry = adj.get(uid)
    const out = { uid }
    if (!entry || depth <= 0) {
      return out
    }
    Object.assign(out, entry.attrs)
    Object.entries(entry.edges).forEach(([pred, targets]) => {
      out[pred] = targets.map((t) => expandNode(t, depth - 1))
    })
    return out
  }

  if (query.includes('expand(_all_)')) {
    // Each nesting level of expand(_all_) walks one more hop out.
    const depth = query.split('expand(_all_)').length - 1
    return { node: [expandNode(rootUid, depth)] }
  }

  // Bounded shape: `pred (first: N) { uid ... }`. Scalars in the child block
  // add no nodes, so the response size is decided entirely by N.
  const entry = adj.get(rootUid)
  const root = { uid: rootUid, ...entry.attrs }
  const re = /(~?[A-Za-z0-9_.]+)\s*\(first:\s*(\d+)\)/g
  let m
  while ((m = re.exec(query)) !== null) {
    const [, pred, limit] = m
    const targets = entry.edges[pred.replace(/^~/, '')] || []
    root[pred] = targets.slice(0, Number(limit)).map((t) => ({
      uid: t,
      ...(adj.get(t) || {}).attrs,
    }))
  }
  return { node: [root] }
}

test('the fixture reproduces the measured 105,001-node blow-up', () => {
  const adj = makeHubFixture()
  expect(countResponseNodes(fakeDgraph(NAIVE_QUERY, adj))).toBe(105001)
})

test('a bounded expand with a global budget of 500 returns <= 500 nodes where the naive query returns 105,001', () => {
  const adj = makeHubFixture()

  // Control: the query this replaces.
  expect(countResponseNodes(fakeDgraph(NAIVE_QUERY, adj))).toBe(105001)

  const query = buildExpandQuery({
    uid: '0x1',
    predicates: PREDICATES,
    budget: 500,
    nameFields: ['name'],
  })

  const count = countResponseNodes(fakeDgraph(query, adj))
  expect(count).toBeLessThanOrEqual(500)
  // ...and it actually fetched something, rather than "bounding" by doing nothing.
  expect(count).toBeGreaterThan(1)
})

test('per-predicate limit divides the budget so the total cannot exceed it', () => {
  // 5 predicates, budget 500 -> at most 99 each, +1 root = 496.
  expect(perPredicateLimit(500, 5)).toBe(99)
  expect(perPredicateLimit(500, 5) * 5 + 1).toBeLessThanOrEqual(500)
  // A budget too small to give every predicate a slot yields no request at all
  // rather than silently over-fetching.
  expect(perPredicateLimit(1, 5)).toBe(0)
})

test('reverse direction emits ~pred so incoming edges are expandable', () => {
  const query = buildExpandQuery({
    uid: '0x1',
    predicates: ['friend'],
    budget: 100,
    direction: 'in',
  })
  expect(query).toContain('~friend')
})

test('both direction bounds out and in edges together within one budget', () => {
  const adj = makeHubFixture()
  const query = buildExpandQuery({
    uid: '0x1',
    predicates: PREDICATES,
    budget: 500,
    direction: 'both',
  })
  // 10 edge lists (5 out + 5 in) must share the same 500, not get 500 each.
  expect(countResponseNodes(fakeDgraph(query, adj))).toBeLessThanOrEqual(500)
})

// A query that asks for no edges comes back with just the root, adds nothing
// to the canvas, and looks exactly like a node with no neighbours -- the same
// silent failure this whole change exists to remove. Refuse to build it.
test('refuses to build an expansion with no predicates rather than no-op silently', () => {
  expect(() =>
    buildExpandQuery({ uid: '0x1', predicates: [], budget: 500 }),
  ).toThrow(/predicate/i)
})

test('refuses to build an expansion whose budget buys nothing', () => {
  // 5 predicates cannot share a budget of 1.
  expect(() =>
    buildExpandQuery({ uid: '0x1', predicates: PREDICATES, budget: 1 }),
  ).toThrow(/budget/i)
})

test('buildExpandQuery never emits a nested expand(_all_)', () => {
  const query = buildExpandQuery({
    uid: '0x1',
    predicates: PREDICATES,
    budget: 500,
  })
  // A nested expand is exactly what makes the response unbounded: the child
  // block must stay scalars-only.
  expect(query).not.toContain('expand(_all_)')
})
