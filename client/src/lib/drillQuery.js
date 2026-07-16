/*
 * SPDX-FileCopyrightText: © 2017-2026 Istari Digital, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import { escapeRdfString, isSafePredicate } from 'lib/mutations'

// Derives a NEW query from a value the user clicked in a result.
//
// This is deliberately a pure function with no UI and no dispatch: the whole
// risk of the drill-down feature is emitting a query that is subtly wrong, and
// that risk is only testable if the generator is separable from the button.
//
// It is INDEX-AWARE by construction. Dgraph can only filter on a predicate that
// carries a tokenizer, and the tokenizer decides which function is legal:
// eq() against an exact/hash index, allofterms() against a term index. Guessing
// eq() for an unindexed predicate produces "Predicate X is not indexed" at
// runtime — a button that lies. When we cannot prove a query is legal we refuse
// and say why, so the refusal lands in the UI instead of in the server's error.
//
// NOTE: lib/mutations' valueToRdfLiteral is NOT usable here. It emits RDF typed
// literals ("25"^^<xs:int>) for N-Quad mutations; DQL's eq() takes a bare
// literal (25). Only escapeRdfString and isSafePredicate carry over.

const DEFAULT_LIMIT = 50

// A predicate can appear bare in DQL only if it is a plain identifier
// (dgraph.type qualifies). Anything else — a leading digit, a dash — has to be
// wrapped in <>. Note <> is not quoting: eq("name", ...) is invalid DQL.
const BARE_IDENTIFIER = /^[A-Za-z][A-Za-z0-9_.]*$/

const renderPredicate = (predicate) =>
  BARE_IDENTIFIER.test(predicate) ? predicate : `<${predicate}>`

// Tokenizer -> the function it makes legal, in preference order. Exact/hash win
// because they mean what the user clicking a value means: "this exact value".
// term/fulltext are a strictly weaker, different question and must be labelled
// as such — allofterms(name, "Bank Secrecy Act") also returns "Bank Secrecy Act
// Amendments", which is NOT what "filter by this value" promises.
const STRING_STRATEGIES = [
  { tokenizer: 'exact', fn: 'eq', label: 'Filter by this exact value' },
  { tokenizer: 'hash', fn: 'eq', label: 'Filter by this exact value' },
  { tokenizer: 'term', fn: 'allofterms', label: 'Search for all terms' },
  { tokenizer: 'fulltext', fn: 'alloftext', label: 'Search full text' },
]

// Non-string scalars: any index at all makes eq() legal.
const EQ_TYPES = ['int', 'float', 'bool', 'datetime']

const refuse = (reason) => ({ ok: false, reason })

// Serializes a value into DQL literal grammar, driven by the SCHEMA type rather
// than the JS type — the response JSON may have widened an int to a JS number
// or stringified it, and the schema is the authority on what the predicate holds.
function toDqlLiteral(value, type) {
  if (type === 'int' || type === 'float') {
    const n = typeof value === 'number' ? value : Number(value)
    if (!Number.isFinite(n)) {
      return null
    }
    return String(n)
  }
  if (type === 'bool') {
    if (typeof value === 'boolean') {
      return String(value)
    }
    if (value === 'true' || value === 'false') {
      return value
    }
    return null
  }
  // string, datetime and anything else quotable.
  return `"${escapeRdfString(value)}"`
}

/**
 * Builds a derived query from a clicked datum.
 *
 * @param predicate - the source predicate name. MUST be a real predicate, not a
 *   JSON key that might be an alias/aggregate — callers are responsible for
 *   proving provenance before calling.
 * @param value - the clicked scalar value.
 * @param schema - the `schema {}` predicate list.
 * @param limit - bounds the ROOT SET only. `first: n` caps how many nodes match
 *   the filter; it says nothing about the size of each one, and the
 *   expand(_all_) body below is deliberately unbounded in breadth — a
 *   high-degree node still returns all of its edges. The drill opens the query
 *   in a tab for the user to read and edit, and never runs it, so breadth is the
 *   user's call to make on a query they can see. Do not describe the result as
 *   "bounded" without that qualification.
 * @returns {ok: true, query, label, fn} or {ok: false, reason}
 */
export function buildFilterQuery({
  predicate,
  value,
  schema,
  limit = DEFAULT_LIMIT,
}) {
  if (!isSafePredicate(predicate)) {
    return refuse(`"${predicate}" is not a valid predicate name.`)
  }
  if (value === null || value === undefined || typeof value === 'object') {
    return refuse('Only scalar values can be drilled into.')
  }
  // uid is structural, not a predicate, and never appears in schema {}. Falling
  // through would blame the schema for a key that is reserved by design.
  //
  // It is also deliberately NOT offered as a drill: across 45 real queries the
  // user wrote zero uid literals while 705 distinct uids came back. The loop
  // worth supporting is harvesting VALUES, not re-querying a uid.
  if (predicate === 'uid') {
    return refuse(
      'uid identifies this node — drill a value instead to find related nodes.',
    )
  }

  const entry = (schema || []).find((p) => p && p.predicate === predicate)
  if (!entry) {
    return refuse(
      `"${predicate}" is not in the schema, so Ratel can't tell how to filter on it.`,
    )
  }

  const type = entry.type
  if (type === 'uid') {
    return refuse(
      `"${predicate}" is an edge, not a value. Expand the node to follow it.`,
    )
  }
  if (type === 'password' || type === 'geo' || type === 'default') {
    return refuse(`Ratel can't build a filter for a ${type} predicate.`)
  }

  const tokenizers = Array.isArray(entry.tokenizer) ? entry.tokenizer : []
  if (!entry.index || tokenizers.length === 0) {
    return refuse(
      `Predicate "${predicate}" is not indexed, so Dgraph can't filter on it. ` +
        'Add an index in the Schema tab first.',
    )
  }

  let strategy
  if (type === 'string') {
    strategy = STRING_STRATEGIES.find((s) => tokenizers.includes(s.tokenizer))
    if (!strategy && tokenizers.includes('trigram')) {
      return refuse(
        `"${predicate}" only has a trigram index, which supports regular-expression ` +
          "search — Ratel can't derive an exact filter from it.",
      )
    }
  } else if (EQ_TYPES.includes(type)) {
    strategy = { fn: 'eq', label: 'Filter by this exact value' }
  }

  if (!strategy) {
    return refuse(
      `Predicate "${predicate}" has no tokenizer Ratel can filter on ` +
        `(has: ${tokenizers.join(', ') || 'none'}).`,
    )
  }

  const literal = toDqlLiteral(value, type)
  if (literal === null) {
    return refuse(`"${value}" is not a valid ${type} value.`)
  }

  const query = `{
  drill(func: ${strategy.fn}(${renderPredicate(predicate)}, ${literal}), first: ${limit}) {
    uid
    expand(_all_)
  }
}`

  return { ok: true, query, label: strategy.label, fn: strategy.fn }
}
