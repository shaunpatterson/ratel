/*
 * SPDX-FileCopyrightText: © 2017-2026 Istari Digital, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

// Bounded neighbour expansion.
//
// The query this replaces was:
//
//   { node(func:uid(X)) { uid expand(_all_) { uid expand(_all_) } } }
//
// which is unbounded in the only sense that matters -- the wire. A measured
// 5000-degree hub pulls 105,001 nodes / ~3.9MB through it, all so the canvas
// can draw 400.
//
// The tempting fix -- adding `first: N` -- does NOT bound the response.
// `first:` paginates each edge list PER ROOT PER PREDICATE, so N roots x P
// predicates x first:N compounds instead of capping. And `first:` cannot
// paginate `expand(_all_)` at all, because there is no named edge to paginate.
//
// So bounding requires two things together:
//   1. NAMED predicates, so each edge list has its own `first:`, and
//   2. a per-predicate limit derived by DIVIDING one global budget across the
//      edge lists we are about to ask for.
// Then the response is at most 1 (root) + edgeLists * limit <= budget.
//
// The child block stays SCALARS-ONLY on purpose. A nested `expand(_all_)` is
// precisely what reintroduces the blow-up: it walks one more hop and drags in
// every neighbour-of-neighbour. Scalars cost bytes but add no nodes, which is
// what lets us name the new nodes without unbounding the response.

// Predicates safe to inline bare; anything else gets angle-bracket quoted the
// way DQL expects.
const SIMPLE_PREDICATE = /^[A-Za-z0-9_.]+$/

const quotePredicate = (pred) =>
  SIMPLE_PREDICATE.test(pred) ? pred : `<${pred}>`

/**
 * How many neighbours each edge list may return, given one global budget.
 *
 * The root itself occupies a slot in the response, so the edge lists divide
 * `budget - 1`. Returns 0 when the budget cannot give every edge list at
 * least one slot -- the caller should then ask for nothing rather than
 * quietly over-fetch.
 */
export function perPredicateLimit(budget, predicateCount) {
  if (predicateCount <= 0) {
    return 0
  }
  const forEdges = budget - 1
  if (forEdges <= 0) {
    return 0
  }
  return Math.max(0, Math.floor(forEdges / predicateCount))
}

/**
 * Edge lists to request, honouring direction. Reverse edges use DQL's `~pred`
 * and require the predicate to carry @reverse in the schema; when it does not,
 * Dgraph rejects the query -- which is now surfaced to the user instead of
 * being swallowed by a console.error.
 */
export function directedPredicates(predicates, direction) {
  if (direction === 'in') {
    return predicates.map((p) => `~${p}`)
  }
  if (direction === 'both') {
    return [...predicates, ...predicates.map((p) => `~${p}`)]
  }
  return [...predicates]
}

/**
 * Build a depth-one expansion whose RESPONSE is provably <= budget nodes.
 */
export function buildExpandQuery({
  uid,
  predicates = [],
  budget = 500,
  direction = 'out',
  nameFields = [],
}) {
  const edgeLists = directedPredicates(predicates, direction)

  // Both of these would build a query asking for no edges at all: it would
  // succeed, return only the root, add nothing to the canvas, and be
  // indistinguishable from a node with no neighbours. Failing loudly here is
  // the whole point -- the caller turns these into a visible message.
  if (edgeLists.length === 0) {
    throw new Error(
      'No predicate to expand: this graph has no known edge predicates yet.',
    )
  }

  const limit = perPredicateLimit(budget, edgeLists.length)
  if (limit <= 0) {
    throw new Error(
      `Budget of ${budget} is too small to expand ${edgeLists.length} predicates.`,
    )
  }

  const scalars = nameFields.filter((f) => SIMPLE_PREDICATE.test(f))
  const childBlock = ['uid', ...scalars]
  const indent = (depth) => '  '.repeat(depth)

  const lines = ['{', `  node(func: uid(${uid})) {`, '    uid']
  scalars.forEach((s) => lines.push(`    ${s}`))

  edgeLists.forEach((pred) => {
    const reverse = pred.startsWith('~')
    const name = reverse
      ? `~${quotePredicate(pred.slice(1))}`
      : quotePredicate(pred)
    lines.push(`    ${name} (first: ${limit}) {`)
    childBlock.forEach((c) => lines.push(`${indent(3)}${c}`))
    lines.push('    }')
  })

  lines.push('  }', '}')
  return lines.join('\n')
}

/**
 * Turn whatever executeQuery rejected with into something worth showing a user.
 *
 * The old expansion path caught errors and console.error'd them with the
 * comment "Ignore errors and exceptions on this RPC." The result: a failed
 * expansion looked exactly like a node with no neighbours. A reverse-edge
 * query against a predicate lacking @reverse fails this way, and the user was
 * told nothing at all.
 */
export function expansionErrorMessage(error) {
  if (!error) {
    return 'Expansion failed.'
  }
  const dgraph = error.errors && error.errors[0] && error.errors[0].message
  return dgraph || error.message || String(error)
}

/**
 * Count the distinct nodes a Dgraph response actually carries.
 *
 * Deliberately counts the RESPONSE rather than what got rendered: the whole
 * failure being fixed here is a query that pulls 105,001 nodes to draw 400, so
 * a rendered-count assertion would have passed against the broken code.
 */
export function countResponseNodes(data) {
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
