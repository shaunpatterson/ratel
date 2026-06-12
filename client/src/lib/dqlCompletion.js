/*
 * SPDX-FileCopyrightText: © 2017-2026 Istari Digital, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

// Matches the token being typed before the cursor: predicate names
// (including dotted ones like dgraph.type), <angle-bracketed> predicates,
// @directives, var: prefixes, etc.
export const TOKEN_BEFORE_CURSOR = /[\w<>~:@.]+$/

/**
 * Checks whether term matches word as a (possibly fuzzy) subsequence.
 * Returns [matched, weight] — higher weight means a better match.
 * A strict prefix match gets the highest possible weight (term.length).
 */
export function termMatchesWord(term, word) {
  term = term.trim()
  word = word.toLowerCase().trim()
  if (term.length > word.length) {
    return [false, 0]
  }

  if (word.startsWith(term)) {
    return [true, term.length]
  }

  const Lw = word.length
  const Lt = term.length

  let it = 0
  let iw = 0
  let match = 0
  let weight = 1.0

  while (it < Lt && iw < Lw) {
    if (term[it] === word[iw]) {
      match += weight
      it++
      iw++
      continue
    }
    // Term's character hasn't been found
    iw++
    weight /= 2
  }
  return [it === Lt, match]
}

/**
 * Sorts [weight, word] pairs by descending weight, then alphabetically.
 */
export function sortMatches(a, b) {
  if (a[0] > b[0]) {
    return -1
  }
  if (a[0] < b[0]) {
    return 1
  }

  const nameA = a[1].toLowerCase()
  const nameB = b[1].toLowerCase()

  return nameA < nameB ? -1 : nameA > nameB ? 1 : 0
}

/**
 * Returns the words matching term, best matches first, without duplicates.
 */
export function getCompletions(term, words) {
  term = (term || '').toLowerCase().trim()
  // Don't autosuggest for anyofterms/allofterms filter values, which
  // would be inside quotes.
  if (!term || term[0] === '"') {
    return []
  }

  const seen = new Set()
  return words
    .map((word) => [...termMatchesWord(term, word), word])
    .filter(([matched]) => matched)
    .map(([, weight, word]) => [weight, word])
    .sort(sortMatches)
    .map(([, word]) => word)
    .filter((word) => {
      if (seen.has(word)) {
        return false
      }
      seen.add(word)
      return true
    })
}

/**
 * Builds a CodeMirror 6 completion source backed by a dynamic word list.
 * getWords is called on every completion request so the list can grow as
 * schema and keyword fetches resolve.
 */
export function makeCompletionSource(getWords) {
  return (context) => {
    const match = context.matchBefore(TOKEN_BEFORE_CURSOR)
    if (!match || (match.from === match.to && !context.explicit)) {
      return null
    }
    const options = getCompletions(match.text, getWords())
    if (!options.length) {
      return null
    }
    return {
      from: match.from,
      options: options.map((label) => ({ label })),
      filter: false,
    }
  }
}
