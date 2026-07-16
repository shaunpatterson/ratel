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
//
// WHAT THIS DOES NOT BOUND: bytes. The bound is on NODE COUNT only. Each node
// carries up to 8 observed scalars, and a Dgraph string or `[string]` has no
// useful size limit, so a budget of 500 can still be a large response if the
// data is large -- the tests count uids, and prove nothing about wire size.
// That is a real remaining gap, not an oversight: bounding bytes needs either
// a server-side limit or a streaming/aborting client, and neither exists here.
// What it does buy is the difference between 105,001 nodes and 500.

// The budget proof below assumes EXACTLY ONE root. `uid()` legally accepts a
// list, so a uid of '0x1, 0x2, 0x3' would create three roots while the limit
// was still divided as if there were one -- 3x the budget, measured. Dgraph
// only ever issues hex uids, so anything else is not a uid we should be
// interpolating into a query.
const UID = /^0x[0-9a-fA-F]+$/

// Predicates safe to inline. Angle brackets were used to "quote" the rest, but
// bracketing is not escaping: `a> { uid } friend (first: 99999) { uid } <b`
// closes the bracket and emits the middle as query text. Nothing legitimate
// needs the brackets -- schema predicates that reach here are already filtered
// to this shape -- so unrepresentable names are refused rather than mangled.
const SIMPLE_PREDICATE = /^[A-Za-z0-9_.]+$/

/**
 * Edge predicates, according to the cluster schema.
 *
 * The schema is the only authority on this, and asking it fixes two failures
 * that harvesting predicates off the RENDERED EDGES cannot:
 *
 *   1. `{ q(func: uid(0x1)) { uid } }` renders one node and zero edges, so
 *      there was nothing to harvest and expansion refused outright -- the
 *      feature that exists to fetch edges demanded edges you do not have yet.
 *      That is the canonical "start from one node and explore" flow.
 *
 *   2. `friends: friend { uid }` is a legal DQL alias. GraphParser records the
 *      response KEY (`pred: key` in lib/graph.js), so the harvested name is
 *      'friends' -- not a predicate at all. Expanding along it returns nothing,
 *      forever and silently, because Dgraph does not error on an unknown edge.
 *
 * Only `uid`-typed predicates are edges; a scalar admitted here would be a type
 * error on the wire AND would dilute the budget away from real edges.
 * dgraph.* predicates are Dgraph's own bookkeeping, never what a user means by
 * "expand this node".
 */
export function uidPredicates(schemaResponse) {
  const data = (schemaResponse && schemaResponse.data) || schemaResponse || {}
  const preds = (data.schema || [])
    .filter((p) => p && p.type === 'uid' && typeof p.predicate === 'string')
    .map((p) => p.predicate)
    .filter((p) => !p.startsWith('dgraph.') && SIMPLE_PREDICATE.test(p))
  return Array.from(new Set(preds)).sort((a, b) => a.localeCompare(b))
}

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
 * Build a depth-one expansion whose RESPONSE carries <= budget NODES.
 *
 * Nodes, not bytes -- see the note at the top of this file. The bound holds
 * because there is exactly one root and every edge list is capped, both of
 * which are enforced below rather than assumed of the caller.
 */
export function buildExpandQuery({
  uid,
  predicates = [],
  budget = 500,
  direction = 'out',
  nameFields = [],
}) {
  // Enforce the preconditions the budget proof rests on, rather than trusting
  // every caller to have already done it. These values arrive from parsed
  // cluster data and query response keys, not from a typed boundary.
  if (!UID.test(String(uid))) {
    throw new Error(`Cannot expand: ${JSON.stringify(uid)} is not a uid.`)
  }
  const unsafe = predicates.find((p) => !SIMPLE_PREDICATE.test(p))
  if (unsafe !== undefined) {
    throw new Error(
      `Cannot expand: ${JSON.stringify(unsafe)} is not a usable predicate name.`,
    )
  }

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
    lines.push(`    ${pred} (first: ${limit}) {`)
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
