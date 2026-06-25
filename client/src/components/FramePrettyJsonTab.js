/*
 * SPDX-FileCopyrightText: © 2017-2026 Istari Digital, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import DOMPurify from 'dompurify'
import { marked } from 'marked'
import React from 'react'
import Clipboard from 'react-clipboard.js'
import Highlight from 'react-highlight'

import 'highlight.js/styles/atom-one-light.css'

const STATE_IDLE = 0
const STATE_ERROR = -1
const STATE_SUCCESS = 1

const ROOT_ID = '$'
const INITIAL_EXPAND_DEPTH = 2
const ARRAY_TRUNCATE_AT = 200

const MD_REGEX =
  /(^|\n)\s*(#{1,6}\s|>\s|[-*+]\s|\d+\.\s)|```|\[[^\]\n]+\]\([^)\n]+\)/

function looksLikeMarkdown(value) {
  return (
    typeof value === 'string' &&
    value.length > 1 &&
    value.includes('\n') &&
    MD_REGEX.test(value)
  )
}

function formatPrimitive(value) {
  if (value === null) {
    return 'null'
  }
  if (typeof value === 'string') {
    return JSON.stringify(value)
  }
  if (typeof value === 'bigint') {
    return `${value.toString()}n`
  }
  if (typeof value === 'undefined') {
    return 'undefined'
  }
  if (typeof value === 'function') {
    return `[Function ${value.name || 'anonymous'}]`
  }
  if (typeof value === 'number' && !Number.isFinite(value)) {
    return String(value)
  }
  if (value instanceof Date) {
    return JSON.stringify(value.toISOString())
  }
  return JSON.stringify(value)
}

function getEntryCount(value) {
  if (Array.isArray(value)) {
    return value.length
  }
  if (value && typeof value === 'object') {
    return Object.keys(value).length
  }
  return 0
}

function MarkdownBlock({ text }) {
  const html = React.useMemo(() => {
    const dirty = marked.parse(text)
    return DOMPurify.sanitize(dirty)
  }, [text])
  return (
    <div className='pretty-md'>
      <Highlight innerHTML>{html}</Highlight>
    </div>
  )
}

function PrimitiveValue({ value }) {
  if (typeof value === 'string' && looksLikeMarkdown(value)) {
    return <MarkdownBlock text={value} />
  }
  const type =
    value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value
  return (
    <span className={`pretty-value pretty-${type}`}>
      {formatPrimitive(value)}
    </span>
  )
}

function JsonNode({
  nodeId,
  value,
  keyName,
  isLast,
  depth,
  overrides,
  onToggle,
}) {
  const expanded =
    nodeId in overrides ? overrides[nodeId] : depth < INITIAL_EXPAND_DEPTH

  const indent = { paddingLeft: depth * 16 }
  const type =
    value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value
  const isContainer = type === 'object' || type === 'array'

  if (!isContainer) {
    return (
      <div className='pretty-row pretty-leaf' style={indent}>
        {keyName !== undefined && (
          <span className='pretty-key'>
            {formatPrimitive(String(keyName))}:{' '}
          </span>
        )}
        <PrimitiveValue value={value} />
        {!isLast && <span className='pretty-comma'>,</span>}
      </div>
    )
  }

  const totalEntries = getEntryCount(value)
  const entries = Array.isArray(value)
    ? value.map((v, i) => [i, v])
    : Object.entries(value)
  const truncated = Array.isArray(value) && totalEntries > ARRAY_TRUNCATE_AT
  const visibleEntries = truncated
    ? entries.slice(0, ARRAY_TRUNCATE_AT)
    : entries
  const open = type === 'array' ? '[' : '{'
  const close = type === 'array' ? ']' : '}'
  const toggleable = totalEntries > 0
  const summary =
    type === 'array' ? `Array(${totalEntries})` : `Object{${totalEntries}}`

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onToggle(nodeId)
    }
  }

  return (
    <div className='pretty-row pretty-container'>
      <div className='pretty-line' style={indent}>
        {toggleable ? (
          <button
            type='button'
            className={`pretty-caret${expanded ? ' open' : ''}`}
            onClick={() => onToggle(nodeId)}
            onKeyDown={handleKeyDown}
            aria-expanded={expanded}
            aria-label={expanded ? `Collapse ${summary}` : `Expand ${summary}`}
            tabIndex={0}
          >
            {'\u25B6'}
          </button>
        ) : null}
        {keyName !== undefined && (
          <span className='pretty-key'>
            {formatPrimitive(String(keyName))}:{' '}
          </span>
        )}
        <span className='pretty-bracket'>
          {toggleable
            ? expanded
              ? open
              : `${open} ${summary} ${close}`
            : `${open}${close}`}
        </span>
      </div>
      {expanded && toggleable && (
        <div className='pretty-children'>
          {visibleEntries.map(([k, v], i) => (
            <JsonNode
              key={`${nodeId}.${String(k)}`}
              nodeId={`${nodeId}.${String(k)}`}
              keyName={Array.isArray(value) ? undefined : k}
              value={v}
              isLast={i === visibleEntries.length - 1 && !truncated}
              depth={depth + 1}
              overrides={overrides}
              onToggle={onToggle}
            />
          ))}
          {truncated && (
            <div
              className='pretty-row pretty-truncated'
              style={{ paddingLeft: (depth + 1) * 16 }}
            >
              <span className='pretty-truncated-text'>
                … {totalEntries - ARRAY_TRUNCATE_AT} more items hidden
              </span>
              {!isLast && <span className='pretty-comma'>,</span>}
            </div>
          )}
        </div>
      )}
      {expanded && toggleable && (
        <div className='pretty-line' style={indent}>
          <span className='pretty-bracket'>{close}</span>
          {!isLast && <span className='pretty-comma'>,</span>}
        </div>
      )}
    </div>
  )
}

function collectAllIds(value, prefix, out) {
  if (value === null || typeof value !== 'object') {
    return
  }
  out.push(prefix)
  const entries = Array.isArray(value)
    ? value.map((v, i) => [i, v])
    : Object.entries(value)
  for (const [k, v] of entries) {
    collectAllIds(v, `${prefix}.${String(k)}`, out)
  }
}

export default function FramePrettyJsonTab({ data }) {
  const [overrides, setOverrides] = React.useState({})
  const [copyState, setCopyState] = React.useState(STATE_IDLE)
  const copyTimerRef = React.useRef(null)

  React.useEffect(
    () => () => {
      if (copyTimerRef.current) {
        clearTimeout(copyTimerRef.current)
      }
    },
    [],
  )

  const copyText = React.useMemo(() => {
    if (data === undefined || data === null) {
      return ''
    }
    if (typeof data === 'string') {
      return data
    }
    try {
      return JSON.stringify(data, null, 2) || ''
    } catch {
      return String(data)
    }
  }, [data])

  const flashCopyState = (state, ms) => {
    setCopyState(state)
    if (copyTimerRef.current) {
      clearTimeout(copyTimerRef.current)
    }
    copyTimerRef.current = setTimeout(() => {
      setCopyState(STATE_IDLE)
      copyTimerRef.current = null
    }, ms)
  }

  const onCopySuccess = () => flashCopyState(STATE_SUCCESS, 800)
  const onCopyError = () => flashCopyState(STATE_ERROR, 1500)

  const expandAll = () => {
    const ids = []
    collectAllIds(data, ROOT_ID, ids)
    if (ids.length === 0) {
      return
    }
    const next = { ...overrides }
    for (const id of ids) {
      next[id] = true
    }
    setOverrides(next)
  }

  const collapseAll = () => {
    const ids = []
    collectAllIds(data, ROOT_ID, ids)
    if (ids.length === 0) {
      return
    }
    const next = { ...overrides }
    for (const id of ids) {
      next[id] = false
    }
    setOverrides(next)
  }

  const onToggle = (nodeId) => {
    const current = overrides[nodeId] ?? false
    setOverrides({ ...overrides, [nodeId]: !current })
  }

  const renderBody = () => {
    if (data === undefined || data === null) {
      return <div className='pretty-empty'>No data</div>
    }
    if (typeof data !== 'object') {
      return (
        <div className='pretty-scalar'>
          <PrimitiveValue value={data} />
        </div>
      )
    }
    return (
      <JsonNode
        nodeId={ROOT_ID}
        value={data}
        isLast
        depth={0}
        overrides={overrides}
        onToggle={onToggle}
      />
    )
  }

  return (
    <div className='frame-pretty-tab'>
      <div className='pretty-toolbar'>
        <div className='pretty-toolbar-left'>
          <button
            type='button'
            className='btn btn-sm btn-outline-secondary pretty-btn'
            onClick={expandAll}
            title='Expand every node'
          >
            <i className='fas fa-plus-square' /> Expand all
          </button>
          <button
            type='button'
            className='btn btn-sm btn-outline-secondary pretty-btn'
            onClick={collapseAll}
            title='Collapse every node'
          >
            <i className='fas fa-minus-square' /> Collapse all
          </button>
        </div>
        <Clipboard
          key={copyText}
          className='btn-clipboard'
          option-text={() => copyText}
          onSuccess={onCopySuccess}
          onError={onCopyError}
        >
          <span>
            <i className='far fa-clipboard' />{' '}
            {copyState === STATE_IDLE
              ? 'Copy Text to Clipboard'
              : copyState === STATE_SUCCESS
                ? 'Copied!'
                : 'Error Occured!'}
          </span>
        </Clipboard>
      </div>
      <div className='pretty-tree'>{renderBody()}</div>
    </div>
  )
}
