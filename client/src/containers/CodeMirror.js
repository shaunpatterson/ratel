/*
 * SPDX-FileCopyrightText: © 2017-2026 Istari Digital, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import 'codemirror/addon/hint/show-hint.css'

import {
  analyzeCompletionContext,
  completionsForContext,
} from 'lib/dqlCompletion'

const CodeMirror = require('codemirror')
require('codemirror/addon/hint/show-hint')
require('codemirror/addon/comment/comment')
require('codemirror/addon/edit/matchbrackets')
require('codemirror/addon/edit/closebrackets')
require('codemirror/addon/fold/foldcode')
require('codemirror/addon/fold/foldgutter')
require('codemirror/addon/fold/brace-fold')
require('codemirror/addon/lint/lint')
require('codemirror/keymap/sublime')
require('codemirror/mode/javascript/javascript')
require('codemirror-graphql/hint')
require('codemirror-graphql/lint')
require('codemirror-graphql/info')
require('codemirror-graphql/jump')
require('codemirror-graphql/mode')

export default CodeMirror

function sortMatches(a, b) {
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

function termMatchesWord(term, word) {
  term = term.trim()
  word = word.toLowerCase().trim()
  if (term.length > word.length) {
    return [false, 0]
  }

  if (word.startsWith(term)) {
    return [true, term.length]
  }

  const Lw = word.length,
    Lt = term.length

  let it = 0,
    iw = 0,
    match = 0,
    weight = 1.0

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

CodeMirror.registerHelper('hint', 'fromList', (cm, options) => {
  const cur = cm.getCursor()
  const token = cm.getTokenAt(cur)

  const to = CodeMirror.Pos(cur.line, token.end)
  let from = '',
    term = ''
  if (token.string) {
    term = token.string
    from = CodeMirror.Pos(cur.line, token.start)
  } else {
    term = ''
    from = to
  }

  // So that we don't autosuggest for anyof/allof filter values which
  // would be inside quotes.
  if (term.length > 0 && term[0] === '"') {
    return { list: [], from: from, to: to }
  }

  // TODO: This is a hack because Graphiql mode considers . as an invalidchar.
  // Ideally we should write our own mode which allows . in predicate.
  if (
    token.type === 'invalidchar' &&
    token.state.prevState !== undefined &&
    token.state.prevState.kind === 'Field'
  ) {
    term = token.state.prevState.name + token.string
    from.ch -= token.state.prevState.name.length
  }

  // Because Codemirror strips the @ from a directive.
  if (token.state.kind === 'Directive') {
    term = '@' + term
    from.ch -= 1
  }

  const emptyMatch = { list: [], from, to }

  term = term.toLowerCase().trim()
  if (!term) {
    return emptyMatch
  }

  const found = options.words
    .map((word) => [...termMatchesWord(term, word), word])
    .filter((match) => match[0])
    .map(([flag, weight, word]) => [weight, word])

  if (!found.length) {
    return emptyMatch
  }
  return {
    list: found.sort(sortMatches).map(([p, w]) => w),
    from,
    to,
  }
})

// Renders a suggestion as `name  type · index`, so the reason a predicate is
// being offered is visible rather than implied.
// Signature is fixed by CodeMirror's show-hint addon: (element, self, data).
function renderDqlHint(element, _self, data) {
  const name = document.createElement('span')
  name.className = 'CodeMirror-hint-name'
  name.textContent = data.displayText || data.text
  element.appendChild(name)

  if (data.detail) {
    const detail = document.createElement('span')
    detail.className = 'CodeMirror-hint-detail'
    detail.textContent = data.detail
    element.appendChild(detail)
  }
}

// Schema- and context-aware completion for DQL.
//
// Unlike `fromList`, which is handed a flat array of names and never learns
// where the cursor is, this reads the text before the cursor and asks
// lib/dqlCompletion what is legal at that position. The scan has to start at
// the top of the document rather than the current line, because the call that
// encloses the cursor is routinely opened on an earlier line.
CodeMirror.registerHelper('hint', 'dqlSchema', (cm, options) => {
  const cur = cm.getCursor()
  const textBeforeCursor = cm.getRange(CodeMirror.Pos(0, 0), cur)

  const context = analyzeCompletionContext(textBeforeCursor)
  const list = completionsForContext(context, {
    predicates: options.predicates,
    types: options.types,
    words: options.words,
  }).map((item) => ({ ...item, render: renderDqlHint }))

  // The replaced range starts where the term does. dqlCompletion decides what
  // counts as a term (it keeps a leading @ so directives do not splice into
  // `@@filter`), so the start must come from it rather than from the token,
  // whose boundaries disagree.
  //
  // The end runs to the end of the word rather than to the cursor, so that
  // completing from inside an existing `title` replaces it instead of leaving
  // the tail behind as `titlele`. This is what the token-based fromList helper
  // did, and users are used to it.
  const line = cm.getLine(cur.line) || ''
  let end = cur.ch
  while (end < line.length && /[A-Za-z0-9_.]/.test(line[end])) {
    end++
  }

  return {
    list,
    from: CodeMirror.Pos(cur.line, cur.ch - context.term.length),
    to: CodeMirror.Pos(cur.line, end),
  }
})
