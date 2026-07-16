/*
 * SPDX-FileCopyrightText: © 2017-2026 Istari Digital, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

// CodeMirror measures text by asking a DOM Range for its bounding rect. jsdom
// implements Range but returns nothing measurable, so CodeMirror's
// hasBadBidiRects() throws during construction. Stubbing a fixed character box
// lets a real CodeMirror instance mount and tokenize under jsdom, which is what
// lets us test the hint helpers against real GraphQL-mode tokens instead of a
// hand-rolled fake token stream.
export function installCodeMirrorJsdomPolyfill() {
  const rect = () => ({
    top: 0,
    left: 0,
    right: 8,
    bottom: 16,
    width: 8,
    height: 16,
    x: 0,
    y: 0,
  })

  document.createRange = () => ({
    setStart: () => {},
    setEnd: () => {},
    getBoundingClientRect: rect,
    getClientRects: () => [rect()],
    commonAncestorContainer: document.body,
  })

  Range.prototype.getBoundingClientRect = rect
  Range.prototype.getClientRects = () => [rect()]
}

// Builds a real CodeMirror editor holding `text`, with the cursor placed at the
// | marker (which is stripped from the text before it is loaded).
export function editorAtCursor(CodeMirror, textWithCursor, mode = 'graphql') {
  const ch = textWithCursor.indexOf('|')
  if (ch < 0) {
    throw new Error('editorAtCursor: text must contain a | cursor marker')
  }
  const text = textWithCursor.replace('|', '')
  const div = document.createElement('div')
  document.body.appendChild(div)
  const cm = CodeMirror(div, { mode, value: text })
  cm.setCursor({ line: 0, ch })
  return cm
}
