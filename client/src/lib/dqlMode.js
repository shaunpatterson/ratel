/*
 * SPDX-FileCopyrightText: © 2017-2026 Istari Digital, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

// A small CodeMirror 5 style stream tokenizer for DQL (Dgraph Query
// Language). Hosted in CodeMirror 6 via StreamLanguage.define(dqlMode).
// Token names are legacy CodeMirror style names, which StreamLanguage
// maps onto highlight tags automatically.

export const DQL_KEYWORDS = new Set([
  'after',
  'allofterms',
  'alloftext',
  'and',
  'anyofterms',
  'anyoftext',
  'as',
  'avg',
  'between',
  'cascade',
  'contains',
  'count',
  'delete',
  'eq',
  'expand',
  'filter',
  'first',
  'fragment',
  'func',
  'ge',
  'groupby',
  'gt',
  'has',
  'ignorereflex',
  'intersects',
  'le',
  'lt',
  'match',
  'max',
  'min',
  'mutation',
  'near',
  'normalize',
  'not',
  'offset',
  'or',
  'orderasc',
  'orderdesc',
  'query',
  'recurse',
  'regexp',
  'schema',
  'set',
  'sum',
  'term',
  'type',
  'uid',
  'uid_in',
  'upsert',
  'val',
  'var',
  'within',
])

export const dqlMode = {
  name: 'dql',
  startState: () => ({}),
  token(stream) {
    if (stream.eatSpace()) {
      return null
    }
    // Line comments
    if (stream.match(/^#/)) {
      stream.skipToEnd()
      return 'comment'
    }
    // Strings (a lone unterminated quote still highlights to end of line)
    if (stream.match(/^"(?:[^"\\]|\\.)*"?/)) {
      return 'string'
    }
    // Numbers
    if (stream.match(/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/)) {
      return 'number'
    }
    // Directives: @filter, @cascade, @recurse, @lang ...
    if (stream.match(/^@[\w.]*/)) {
      return 'meta'
    }
    // GraphQL-style variables: $a, $name
    if (stream.match(/^\$\w*/)) {
      return 'variable-2'
    }
    // Angle-bracketed predicates: <name>, <dgraph.type>
    if (stream.match(/^<[^>\s]*>/)) {
      return 'atom'
    }
    // Brackets
    if (stream.match(/^[{}()[\]]/)) {
      return 'bracket'
    }
    // Operators
    if (stream.match(/^(?:<=|>=|==|!=|[=<>+\-*/])/)) {
      return 'operator'
    }
    // Identifiers: keywords, predicates, aliases
    if (stream.match(/^[A-Za-z_][\w.]*/)) {
      const word = stream.current().toLowerCase()
      return DQL_KEYWORDS.has(word) ? 'keyword' : 'variable'
    }
    stream.next()
    return null
  },
  languageData: {
    commentTokens: { line: '#' },
    closeBrackets: { brackets: ['(', '[', '{', '"'] },
  },
}
