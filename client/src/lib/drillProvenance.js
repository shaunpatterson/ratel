/*
 * SPDX-FileCopyrightText: © 2017-2026 Istari Digital, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

// Decides whether a rendered JSON key can be TRUSTED to be its source predicate.
//
// This is the whole reason the Pretty tab is dangerous as a drill surface. A key
// in the response is not proof of a predicate: it can be an alias, an aggregate,
// @normalize output, a value variable, or a count. Without a real query AST an
// "index-aware" generator can still confidently query the WRONG predicate — the
// key says `name`, the schema says `name` is term-indexed, and the generated
// allofterms(name, ...) is nonsense because the value actually came from
// `name: some.other.predicate`.
//
// Rather than parse DQL (a real AST is the right long-term fix), this gate is
// deliberately CONSERVATIVE: it proves the ABSENCE of every construct that can
// decouple a key from its predicate, and refuses the whole query otherwise.
// False refusals are cheap — the user still has NodeProperties. A false accept
// is a button that lies, which is the thing we are paid to avoid.

// Constructs that decouple a response key from a source predicate.
const AMBIGUITY_MARKERS = [
  /@normalize\b/,
  /@groupby\b/,
  /\bcount\s*\(/,
  /\bsum\s*\(/,
  /\bavg\s*\(/,
  /\bmin\s*\(/,
  /\bmax\s*\(/,
  /\bmath\s*\(/,
  /\bval\s*\(/,
  // `x as ...` binds a variable and renames output.
  /\b[A-Za-z_][A-Za-z0-9_]*\s+as\s+/,
]

// Keywords for which `foo:` is query syntax rather than an alias.
const COLON_KEYWORDS = new Set([
  'func',
  'first',
  'offset',
  'after',
  'depth',
  'loop',
  'from',
  'to',
  'numpaths',
  'minweight',
  'maxweight',
  'orderasc',
  'orderdesc',
])

const IDENT_COLON = /([A-Za-z_][A-Za-z0-9_.]*)\s*:/g

/**
 * True only when every key in this query's response is provably its own
 * predicate name.
 *
 * @param query - the frame's raw query text.
 */
export function isProvenanceUnambiguous(query) {
  if (typeof query !== 'string' || query.trim() === '') {
    return false
  }

  // Strings and comments can contain anything; neutralise them before scanning
  // so `eq(name, "alias: bogus")` isn't mistaken for an alias.
  const stripped = query
    .replace(/#[^\n]*/g, ' ')
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')

  if (AMBIGUITY_MARKERS.some((re) => re.test(stripped))) {
    return false
  }

  // Any `foo:` that isn't query syntax is an alias, and an alias means the key
  // is not the predicate.
  for (const match of stripped.matchAll(IDENT_COLON)) {
    if (!COLON_KEYWORDS.has(match[1])) {
      return false
    }
  }

  return true
}
