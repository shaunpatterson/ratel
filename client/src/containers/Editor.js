/*
 * SPDX-FileCopyrightText: © 2017-2026 Istari Digital, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useDispatch, useSelector, useStore } from 'react-redux'

import { fetchSchema } from 'actions/schema'
import { getDgraphClient } from 'lib/helpers'
import { resolveTheme } from 'lib/theme'
import {
  selectSchemaGeneration,
  selectSchemaPredicates,
  selectSchemaTypes,
} from 'reducers/schema'
import CodeMirror from './CodeMirror'

import 'codemirror/theme/material-darker.css'
import '../assets/css/Editor.scss'

function isJSON(value) {
  return /^\s*{\s*"/.test(value)
}

export default function Editor({
  maxHeight,
  mode,
  onHotkeyRun,
  onUpdateQuery,
  query,
}) {
  const _editorRef = useRef(null)
  const _bodyRef = useRef(null)

  const [height, setHeight] = useState(200)

  const [editorInstance, setEditorInstance] = useState(undefined)
  const [keywords, setKeywords] = useState([])

  const lastSetValueRef = useRef('')
  const isSettingContent = useRef(false)

  const allState = useSelector((state) => state)
  const themeSetting = useSelector((state) => state.ui.theme)

  const dispatch = useDispatch()
  const store = useStore()
  // The schema comes from the store rather than local state so that it is
  // cleared the instant the auth session changes -- see reducers/schema.js.
  const schemaGeneration = useSelector(selectSchemaGeneration)

  const [systemPrefersDark, setSystemPrefersDark] = useState(
    () => !!window.matchMedia?.('(prefers-color-scheme: dark)').matches,
  )

  useEffect(() => {
    const mediaQuery = window.matchMedia?.('(prefers-color-scheme: dark)')
    if (!mediaQuery?.addEventListener) {
      return
    }
    const onChange = (e) => setSystemPrefersDark(e.matches)
    mediaQuery.addEventListener('change', onChange)
    return () => mediaQuery.removeEventListener('change', onChange)
  }, [])

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

  const fetchUiKeywords = useCallback(async () => {
    const client = await getDgraphClient()
    try {
      const result = await client.fetchUiKeywords()
      setKeywords((kws) => kws.concat(result.keywords.map((kw) => kw.name)))
    } catch (error) {
      console.warn('Editor: Error while fetching ui/keywords', error)
    }
  }, [setKeywords])

  // Once after mount
  useEffect(() => {
    fetchUiKeywords()
  }, [fetchUiKeywords])

  // Refetch on mount, and again whenever the auth session turns over. Editor
  // used to be unmounted by any route change, which destroyed its schema and
  // refetched it by accident; the store outlives the route, so this has to be
  // asked for. Without the generation dep a login clears the schema and
  // completion stays empty until the user happens to navigate away and back.
  useEffect(() => {
    dispatch(fetchSchema())
  }, [dispatch, schemaGeneration])

  // Keywords are static UI vocabulary, not session data, so a ref that trails
  // by a render costs nothing.
  const keywordsRef = useRef([])
  useEffect(() => {
    keywordsRef.current = keywords
  }, [keywords])

  // `CodeMirror.commands.autocomplete` is a global, and this is the one place
  // that answers a keystroke with predicate names. It reads the schema out of
  // the store at call time rather than closing over a rendered value, because
  // only the store is cleared synchronously: reducers/schema.js drops the
  // previous principal's predicates inside the dispatch, but React 18 batches,
  // so a closure over `useSelector` output still holds them until a re-render
  // and its passive effect have run. Reading getState() makes the reducer's
  // guarantee -- gone before React renders -- actually reach the popup.
  //
  // The cleanup matters for the same reason: a global outlives the component
  // that installed it, so without it an unmounted Editor leaves one principal's
  // schema reachable to whatever mounts next.
  useEffect(() => {
    const autocomplete = (cm) => {
      const state = store.getState()
      CodeMirror.showHint(cm, CodeMirror.hint.dqlSchema, {
        completeSingle: false,
        words: keywordsRef.current,
        predicates: selectSchemaPredicates(state),
        types: selectSchemaTypes(state),
      })
    }
    CodeMirror.commands.autocomplete = autocomplete

    return () => {
      // Retract only our own. Today App renders one view at a time, so two
      // Editors are never mounted at once -- but if that ever changes, a blind
      // delete here would strip completion from the editor still on screen.
      if (CodeMirror.commands.autocomplete === autocomplete) {
        delete CodeMirror.commands.autocomplete
      }
    }
  }, [store])

  // Once after mount
  useEffect(() => {
    const editor = CodeMirror(_editorRef.current, {
      value: '',
      lineNumbers: true,
      tabSize: 2,
      lineWrapping: true,
      mode: 'graphql',
      readOnly: false,
      theme: 'neo',
      keyMap: 'sublime',
      autoCloseBrackets: true,
      completeSingle: false,
      showCursorWhenSelecting: true,
      foldGutter: true,
      gutters: ['CodeMirror-linenumbers', 'CodeMirror-foldgutter'],
      viewportMargin: 200,
    })
    setEditorInstance(editor)
    //editor.setCursor(editor.lineCount(), 0); // Set the cursor at the end of existing content
    // Force-focus the editor
    setTimeout(() => {
      editor.refresh()
      //editor.focus();
    })
  }, [])

  const useEditorEffect = (fn, deps) =>
    useEffect(() => {
      if (!editorInstance) {
        return
      }
      return fn()
    }, [editorInstance, ...deps])

  useEditorEffect(() => editorInstance.setOption('mode', mode), [mode])

  // Clearing the store does not unpaint an already-open popup: by the time the
  // session turns over it has materialized the previous principal's predicate
  // names into the DOM, where they stay until something dismisses them.
  useEditorEffect(() => editorInstance.closeHint(), [schemaGeneration])

  useEditorEffect(() => {
    const resolved = resolveTheme(themeSetting, systemPrefersDark)
    editorInstance.setOption(
      'theme',
      resolved === 'dark' ? 'material-darker' : 'neo',
    )
  }, [themeSetting, systemPrefersDark])

  useEditorEffect(
    () =>
      editorInstance.setOption('extraKeys', {
        'Ctrl-Space': (cm) => CodeMirror.commands.autocomplete(cm),
        'Cmd-Space': (cm) => CodeMirror.commands.autocomplete(cm),
        'Cmd-Enter': () => onHotkeyRun?.(),
        'Ctrl-Enter': () => onHotkeyRun?.(),
      }),
    [onHotkeyRun],
  )

  // Every time editor is created or callback for onUpdateQuery is updated
  useEditorEffect(() => {
    if (!editorInstance) {
      return
    }

    const onChangeHandler = (cm) => {
      if (isSettingContent.current) return
      const value = editorInstance.getValue()
      lastSetValueRef.current = value

      const isJsonValue = isJSON()

      if (editorInstance.getMode().name === 'graphql') {
        if (isJsonValue) {
          editorInstance.setOption('mode', {
            name: 'javascript',
            json: true,
          })
        }
      } else if (!isJsonValue) {
        editorInstance.setOption('mode', 'graphql')
      }

      if (onUpdateQuery) {
        onUpdateQuery(value)
      }
    }

    editorInstance.on('change', onChangeHandler)
    return () => editorInstance.off('change', onChangeHandler)
  }, [onUpdateQuery])

  useEditorEffect(() => {
    editorInstance.on('keydown', (cm, event) => {
      const code = event.keyCode
      if (!event.ctrlKey && code >= 65 && code <= 90) {
        CodeMirror.commands.autocomplete(cm)
      }
    })
  }, [])

  // Every time query changes
  useEditorEffect(() => {
    if (query !== lastSetValueRef.current) {
      isSettingContent.current = true
      const cursor = editorInstance.getCursor()

      editorInstance.setValue(query)

      lastSetValueRef.current = query
      editorInstance.setCursor(cursor)
      setTimeout(() => {
        isSettingContent.current = false
      }, 0)
    }
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
      const lineCount = editorInstance?.lineCount() || 1
      // These magic numbers have been measured using current CodeMirror
      // styles and automatic resizing of the editor div.
      // Every new line increases editor height by 20px, and editor with
      // N lines has height of 20*N+8 pixels.
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
