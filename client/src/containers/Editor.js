/*
 * SPDX-FileCopyrightText: © 2017-2026 Istari Digital, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  startCompletion,
} from '@codemirror/autocomplete'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import {
  StreamLanguage,
  bracketMatching,
  defaultHighlightStyle,
  syntaxHighlighting,
} from '@codemirror/language'
import { EditorState, Prec } from '@codemirror/state'
import {
  EditorView,
  drawSelection,
  keymap,
  lineNumbers,
} from '@codemirror/view'
import isEmpty from 'lodash.isempty'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useSelector } from 'react-redux'

import { makeCompletionSource } from 'lib/dqlCompletion'
import { dqlMode } from 'lib/dqlMode'
import { getDgraphClient } from 'lib/helpers'

import '../assets/css/Editor.scss'

const editorTheme = EditorView.theme({
  '&': {
    height: '100%',
    backgroundColor: 'white',
    color: 'black',
    fontSize: '14px',
  },
  '&.cm-focused': {
    outline: 'none',
  },
  '.cm-scroller': {
    fontFamily: 'monospace',
    lineHeight: '20px',
    overflow: 'auto',
  },
  '.cm-content': {
    padding: '4px 0',
  },
  '.cm-gutters': {
    backgroundColor: 'rgb(243, 243, 243)',
    color: '#484848',
    borderRight: '1px solid #ddd',
  },
})

export default function Editor({ maxHeight, onHotkeyRun, onUpdateQuery, query }) {
  const _editorRef = useRef(null)
  const _bodyRef = useRef(null)
  const _viewRef = useRef(null)

  const [height, setHeight] = useState(200)
  const [lineCount, setLineCount] = useState(1)

  // Keep latest callbacks and keywords visible to the long lived
  // CodeMirror extensions without re-creating the editor.
  const keywordsRef = useRef([])
  const onHotkeyRunRef = useRef(onHotkeyRun)
  onHotkeyRunRef.current = onHotkeyRun
  const onUpdateQueryRef = useRef(onUpdateQuery)
  onUpdateQueryRef.current = onUpdateQuery

  // The last value either typed by the user or pushed via props, used to
  // break the update echo loop between the view and the redux store.
  const lastSetValueRef = useRef('')

  const allState = useSelector((state) => state)

  const checkLayoutSize = () => {
    if (!_bodyRef.current) {
      return
    }
    const { offsetHeight } = _bodyRef.current
    // Only set height when it has really changed to avoid infinite loop
    if (offsetHeight !== height) {
      setTimeout(() => {
        setHeight(offsetHeight)
      })
    }
  }
  useEffect(checkLayoutSize, [_bodyRef, height, allState])

  const fetchSchema = useCallback(async () => {
    const client = await getDgraphClient()
    try {
      const schemaResponse = await client.newTxn().query('schema {}')

      const schema = schemaResponse.data.schema
      const types = schemaResponse.data.types
      if (schema && !isEmpty(schema)) {
        keywordsRef.current = keywordsRef.current.concat(
          schema.map((kw) => kw.predicate),
          schema.map((kw) => `<${kw.predicate}>`),
          types.map((type) => type.name),
        )
      }
    } catch (error) {
      console.warn('Editor: Error while fetching schema', error)
    }
  }, [])

  const fetchUiKeywords = useCallback(async () => {
    const client = await getDgraphClient()
    try {
      const result = await client.fetchUiKeywords()
      keywordsRef.current = keywordsRef.current.concat(
        result.keywords.map((kw) => kw.name),
      )
    } catch (error) {
      console.warn('Editor: Error while fetching ui/keywords', error)
    }
  }, [])

  // Once after mount
  useEffect(() => {
    fetchUiKeywords()
    fetchSchema()
  }, [fetchUiKeywords, fetchSchema])

  // Once after mount: build the CodeMirror 6 view
  useEffect(() => {
    const state = EditorState.create({
      doc: '',
      extensions: [
        lineNumbers(),
        history(),
        drawSelection(),
        EditorState.tabSize.of(2),
        EditorView.lineWrapping,
        bracketMatching(),
        closeBrackets(),
        StreamLanguage.define(dqlMode),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        autocompletion({
          override: [makeCompletionSource(() => keywordsRef.current)],
          activateOnTyping: true,
          selectOnOpen: false,
          icons: false,
        }),
        Prec.highest(
          keymap.of([
            {
              key: 'Ctrl-Enter',
              run: () => {
                onHotkeyRunRef.current?.()
                return true
              },
            },
            {
              key: 'Cmd-Enter',
              run: () => {
                onHotkeyRunRef.current?.()
                return true
              },
            },
            { key: 'Ctrl-Space', run: startCompletion },
            { key: 'Cmd-Space', run: startCompletion },
          ]),
        ),
        keymap.of([
          ...closeBracketsKeymap,
          ...defaultKeymap,
          ...historyKeymap,
        ]),
        EditorView.updateListener.of((update) => {
          if (!update.docChanged) {
            return
          }
          setLineCount(update.state.doc.lines)
          const value = update.state.doc.toString()
          if (value !== lastSetValueRef.current) {
            lastSetValueRef.current = value
            onUpdateQueryRef.current?.(value)
          }
        }),
        editorTheme,
      ],
    })
    const view = new EditorView({ state, parent: _editorRef.current })
    _viewRef.current = view
    return () => {
      view.destroy()
      _viewRef.current = null
    }
  }, [])

  // Every time query changes: push the external value into the view,
  // replacing the document without resetting undo history. The cursor is
  // mapped through the change automatically.
  useEffect(() => {
    const view = _viewRef.current
    if (!view) {
      return
    }
    const current = view.state.doc.toString()
    if (query === current || query === undefined || query === null) {
      return
    }
    lastSetValueRef.current = query
    view.dispatch({
      changes: { from: 0, to: current.length, insert: query },
    })
  }, [query])

  function getEditorStyles(maxHeight) {
    let h = 0
    const isFillParent =
      maxHeight === 'fillParent' ||
      maxHeight === null ||
      maxHeight === undefined
    if (isFillParent) {
      h = height
    } else {
      // These magic numbers match the editor theme above: every line is
      // 20px high and the content has 8px of vertical padding, so an
      // editor with N lines is 20*N+8 pixels tall.
      h = Math.min(8 + 20 * lineCount, maxHeight)
      h = Math.max(h, 68)
    }
    return {
      outer: { height: isFillParent ? null : h },
      inner: { height: `${h}px` },
    }
  }

  const style = getEditorStyles(maxHeight)

  return (
    <div className='editor-outer' style={style.outer} ref={_bodyRef}>
      <div ref={_editorRef} className='editor-size-el' style={style.inner} />
    </div>
  )
}
