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

// Blanks strings and comments so `eq(name, "alias: bogus")` isn't mistaken for
// an alias.
//
// This MUST be a single scanner rather than two regex passes, because strings
// and comments are mutually exclusive contexts and an ordered pair of passes
// always gets one of them backwards:
//   - comments first: the `#` in eq(colour, "#ff0000") blanks the rest of the
//     line, hiding an @normalize or an alias that follows it.
//   - strings first: the `"` in `# say "hello` pairs with the next real quote,
//     blanking the query between them and hiding an alias there.
// Each ordering false-ACCEPTS the other's case, and a false accept is a button
// that lies. Tracking both states in one left-to-right pass is the only way to
// say "a # inside a string is data, a " inside a comment is prose".
//
// Returns null for an unterminated string. That is not valid DQL — but the
// Pretty tab renders the server's ERROR for exactly such a frame, so the gate
// is still asked about it, and a string that runs to EOF hides every construct
// after it.
function neutralise(query) {
  let out = ''
  let i = 0
  while (i < query.length) {
    const char = query[i]

    if (char === '#') {
      // To end of line: any quote in here is prose. The newline itself is left
      // for the next iteration so line structure survives.
      while (i < query.length && query[i] !== '\n') {
        i++
      }
      out += ' '
      continue
    }

    if (char === '"') {
      i++
      let closed = false
      while (i < query.length) {
        if (query[i] === '\\') {
          // Escaped anything — including \" — is content, never a terminator.
          i += 2
          continue
        }
        if (query[i] === '"') {
          i++
          closed = true
          break
        }
        i++
      }
      if (!closed) {
        return null
      }
      out += '""'
      continue
    }

    out += char
    i++
  }
  return out
}

/**
 * True only when every key in this query's response is provably its own
 * predicate name.
 *
 * Callers must independently establish that the frame IS a query: this reasons
 * about DQL query grammar, and a mutation body contains no alias and no
 * @normalize for it to object to.
 *
 * @param query - the frame's raw query text.
 */
export function isProvenanceUnambiguous(query) {
  if (typeof query !== 'string' || query.trim() === '') {
    return false
  }

  const stripped = neutralise(query)
  if (stripped === null) {
    return false
  }

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
