/*
 * SPDX-FileCopyrightText: © 2017-2026 Istari Digital, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

// Context-aware completion for DQL.
//
// The rule that matters, and that a name-only word list cannot express: a
// predicate is not a legal completion just because it exists. `func:` takes a
// ROOT FUNCTION, not a predicate. Predicates become legal inside specific
// function ARGUMENT slots, and which predicates are legal there depends on the
// predicate's type and TOKENIZER -- not merely on `index: true`. Offering
// `eq(some_unindexed_predicate)` produces a query the cluster rejects.

const isIndexedWith = (allowed) => (pred) =>
  !!pred.index && (pred.tokenizer || []).some((t) => allowed.indexOf(t) >= 0)

// eq matches a whole value, so any order-agnostic index will serve it,
// including hash.
const EQ_TOKENIZERS = [
  'exact',
  'hash',
  'term',
  'fulltext',
  'int',
  'float',
  'bool',
  'year',
  'month',
  'day',
  'hour',
]

// Inequalities need an order-preserving index. `hash` is deliberately absent:
// it is indexed, but it hashes, so it cannot answer lt/gt/le/ge/between. This
// is precisely why `index: true` is not a sufficient test.
const ORDERED_TOKENIZERS = [
  'exact',
  'int',
  'float',
  'year',
  'month',
  'day',
  'hour',
]

const predicateArg = (accepts, needs) => ({
  arg0: 'predicate',
  accepts,
  needs,
})

export const DQL_FUNCTIONS = {
  // Existence only. Needs no index at all, so every predicate is legal here.
  has: predicateArg(() => true, 'any predicate'),

  eq: predicateArg(isIndexedWith(EQ_TOKENIZERS), 'an equality index'),

  ge: predicateArg(isIndexedWith(ORDERED_TOKENIZERS), 'an ordered index'),
  gt: predicateArg(isIndexedWith(ORDERED_TOKENIZERS), 'an ordered index'),
  le: predicateArg(isIndexedWith(ORDERED_TOKENIZERS), 'an ordered index'),
  lt: predicateArg(isIndexedWith(ORDERED_TOKENIZERS), 'an ordered index'),
  between: predicateArg(isIndexedWith(ORDERED_TOKENIZERS), 'an ordered index'),

  // Term search. A term index is NOT a full-text index and does not do
  // stemming or stop-word handling; only allofterms/anyofterms may claim it.
  allofterms: predicateArg(isIndexedWith(['term']), 'a term index'),
  anyofterms: predicateArg(isIndexedWith(['term']), 'a term index'),

  // Full-text search. Only a fulltext index supports these.
  alloftext: predicateArg(isIndexedWith(['fulltext']), 'a fulltext index'),
  anyoftext: predicateArg(isIndexedWith(['fulltext']), 'a fulltext index'),

  regexp: predicateArg(isIndexedWith(['trigram']), 'a trigram index'),
  match: predicateArg(isIndexedWith(['trigram']), 'a trigram index'),

  near: predicateArg(isIndexedWith(['geo']), 'a geo index'),
  within: predicateArg(isIndexedWith(['geo']), 'a geo index'),
  contains: predicateArg(isIndexedWith(['geo']), 'a geo index'),
  intersects: predicateArg(isIndexedWith(['geo']), 'a geo index'),

  // Walks an edge, so only uid-typed predicates make sense.
  uid_in: predicateArg((pred) => pred.type === 'uid', 'a uid edge'),

  // Takes a type name from the type system, not a predicate.
  type: { arg0: 'type' },

  // Takes uids or a variable; nothing in the schema completes it.
  uid: { arg0: 'uid' },
}

export const ROOT_FUNCTIONS = Object.keys(DQL_FUNCTIONS).sort()

// Replaces the contents of string literals with spaces, preserving offsets, so
// that a comma inside "a, b" is not mistaken for an argument separator. An
// unterminated literal (the cursor is inside the string the user is typing)
// blanks to the end.
function blankStringLiterals(text) {
  let out = ''
  let inString = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inString) {
      if (c === '\\') {
        out += '  '
        i++
        continue
      }
      if (c === '"') {
        inString = false
        out += '"'
        continue
      }
      out += ' '
      continue
    }
    if (c === '"') {
      inString = true
      out += '"'
      continue
    }
    out += c
  }
  return out
}

function identifierEndingAt(text, end) {
  let i = end - 1
  while (i >= 0 && /\s/.test(text[i])) {
    i--
  }
  let name = ''
  while (i >= 0 && /[A-Za-z0-9_]/.test(text[i])) {
    name = text[i] + name
    i--
  }
  return name
}

// Walks backwards to the innermost unclosed '(' and reports which identifier
// opened it and which argument slot the cursor sits in.
function findEnclosingCall(text) {
  let depth = 0
  let commas = 0
  for (let i = text.length - 1; i >= 0; i--) {
    const c = text[i]
    if (c === ')') {
      depth++
    } else if (c === '(') {
      if (depth === 0) {
        return { name: identifierEndingAt(text, i), argIndex: commas }
      }
      depth--
    } else if (c === ',' && depth === 0) {
      commas++
    }
  }
  return null
}

// True when an odd number of unescaped quotes precede the cursor, i.e. the user
// is typing inside a string literal.
function isInsideStringLiteral(text) {
  let inString = false
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\\') {
      i++
      continue
    }
    if (text[i] === '"') {
      inString = !inString
    }
  }
  return inString
}

export function analyzeCompletionContext(text, { cursor } = {}) {
  const before = text.slice(0, cursor === undefined ? text.length : cursor)

  // The leading @ is part of the term. Without it, completing `@fil` against
  // `@filter` splices to `@@filter`, because the replaced range would cover
  // only `fil`.
  const termMatch = before.match(/@?[A-Za-z0-9_.]*$/)
  const term = termMatch ? termMatch[0] : ''

  const inString = isInsideStringLiteral(before)

  const prefix = blankStringLiterals(
    before.slice(0, before.length - term.length),
  ).replace(/\s+$/, '')

  // `func:` introduces the root function of a query block.
  if (/\bfunc\s*:$/.test(prefix)) {
    return { kind: 'rootFunction', term, inString }
  }

  const call = findEnclosingCall(prefix)
  if (call) {
    // @filter(...) takes the same functions a root does.
    if (call.name === 'filter' && call.argIndex === 0) {
      return { kind: 'rootFunction', term, inString }
    }
    if (Object.prototype.hasOwnProperty.call(DQL_FUNCTIONS, call.name)) {
      return {
        kind: 'functionArg',
        fn: call.name,
        argIndex: call.argIndex,
        term,
        inString,
      }
    }
  }

  return { kind: 'body', term, inString }
}

// Scoring, kept identical to the existing fromList helper so that ordering does
// not change under users: an exact prefix beats a subsequence match, and a
// subsequence's score decays the further apart its characters are.
function scoreMatch(term, word) {
  const w = word.toLowerCase()
  if (term.length > w.length) {
    return -1
  }
  if (w.startsWith(term)) {
    return term.length
  }

  let it = 0
  let iw = 0
  let score = 0
  let weight = 1.0
  while (it < term.length && iw < w.length) {
    if (term[it] === w[iw]) {
      score += weight
      it++
      iw++
      continue
    }
    iw++
    weight /= 2
  }
  return it === term.length ? score : -1
}

// Says what actually backs a suggestion, so that a term index is never
// presented as if it were full-text.
export function describePredicate(pred) {
  const type = pred.list ? `[${pred.type}]` : pred.type
  const tokenizers = pred.tokenizer || []
  const index =
    pred.index && tokenizers.length ? tokenizers.join(', ') : 'no index'
  return `${type} · ${index}`
}

function predicateCandidates(predicates) {
  return predicates.map((p) => ({
    text: p.predicate,
    displayText: p.predicate,
    detail: describePredicate(p),
    className: 'CodeMirror-hint-predicate',
  }))
}

function candidatesForContext(context, { predicates, types, words }) {
  if (context.kind === 'rootFunction') {
    return ROOT_FUNCTIONS.map((name) => ({
      text: name,
      displayText: name,
      detail: 'function',
      className: 'CodeMirror-hint-function',
    }))
  }

  if (context.kind === 'functionArg') {
    const rule = DQL_FUNCTIONS[context.fn]
    // Only the first slot names a predicate or type; later slots are values.
    if (!rule || context.argIndex !== 0) {
      return []
    }
    if (rule.arg0 === 'type') {
      return types.map((t) => ({
        text: t.name,
        displayText: t.name,
        detail: 'type',
        className: 'CodeMirror-hint-type',
      }))
    }
    if (rule.arg0 === 'predicate') {
      return predicateCandidates(predicates.filter(rule.accepts))
    }
    return []
  }

  // Bare body position: any predicate can be traversed regardless of index, and
  // type names and UI keywords are legal here too.
  return [
    ...predicateCandidates(predicates),
    ...types.map((t) => ({
      text: t.name,
      displayText: t.name,
      detail: 'type',
      className: 'CodeMirror-hint-type',
    })),
    ...words.map((w) => ({
      text: w,
      displayText: w,
      className: 'CodeMirror-hint-keyword',
    })),
  ]
}

// CodeMirror's hint popup builds a DOM node per entry, so an uncapped list is
// the thing that actually stalls a keystroke on a large schema -- not the
// filtering, which measures ~0.3ms over 2000 predicates. The list is ranked, so
// the cap keeps the best matches.
const MAX_RESULTS = 200

export function completionsForContext(context, pool) {
  // Inside a quoted value the user is typing data, not schema.
  if (context.inString) {
    return []
  }

  const candidates = candidatesForContext(context, {
    predicates: pool.predicates || [],
    types: pool.types || [],
    words: pool.words || [],
  })

  const term = (context.term || '').toLowerCase().trim()
  if (!term) {
    return candidates.slice(0, MAX_RESULTS)
  }

  const scored = []
  for (let i = 0; i < candidates.length; i++) {
    const score = scoreMatch(term, candidates[i].text)
    if (score >= 0) {
      scored.push([score, i, candidates[i]])
    }
  }

  scored.sort((a, b) => {
    if (a[0] !== b[0]) {
      return b[0] - a[0]
    }
    const nameA = a[2].text.toLowerCase()
    const nameB = b[2].text.toLowerCase()
    return nameA < nameB ? -1 : nameA > nameB ? 1 : 0
  })

  return scored.slice(0, MAX_RESULTS).map((s) => s[2])
}
