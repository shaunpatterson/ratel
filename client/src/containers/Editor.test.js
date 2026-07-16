/*
 * SPDX-FileCopyrightText: © 2017-2026 Istari Digital, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import { render, waitFor } from '@testing-library/react'
import React from 'react'
import { Provider } from 'react-redux'
import { applyMiddleware, combineReducers, createStore } from 'redux'
import ReduxThunk from 'redux-thunk'

import connection from 'reducers/connection'
import schema from 'reducers/schema'
import ui from 'reducers/ui'
import {
  editorAtCursor,
  installCodeMirrorJsdomPolyfill,
} from 'testUtils/jsdomCodeMirror'

jest.mock('lib/helpers', () => ({
  ...jest.requireActual('lib/helpers'),
  getDgraphClient: jest.fn(),
}))

import { LOGIN_SUCCESS } from 'actions/connection'
import { getDgraphClient } from 'lib/helpers'
import CodeMirror from './CodeMirror'
import Editor from './Editor'

// `name` is unindexed; `title` is exact-indexed. This is the pair the whole
// feature turns on: both are traversable, only one is legal inside eq().
const SCHEMA = [
  { predicate: 'name', type: 'string' },
  { predicate: 'title', type: 'string', index: true, tokenizer: ['exact'] },
  { predicate: 'friend', type: 'uid', list: true },
]
const TYPES = [{ name: 'Person' }]

function mockClient({ schema: preds = SCHEMA, types = TYPES } = {}) {
  getDgraphClient.mockResolvedValue({
    newTxn: () => ({ query: async () => ({ data: { schema: preds, types } }) }),
    fetchUiKeywords: async () => ({
      keywords: [{ name: 'func' }, { name: '@filter' }],
    }),
  })
}

function renderEditor() {
  const store = createStore(
    combineReducers({ connection, schema, ui }),
    applyMiddleware(ReduxThunk),
  )
  render(
    <Provider store={store}>
      <Editor query='' mode='graphql' onUpdateQuery={() => {}} />
    </Provider>,
  )
  return store
}

describe('Editor schema completion wiring', () => {
  beforeAll(installCodeMirrorJsdomPolyfill)
  beforeEach(() => jest.restoreAllMocks())

  // Captures the options Editor actually hands to CodeMirror.showHint. This is
  // the production call path: Editor renders, its real schema fetch resolves
  // through the real store, and it installs the real autocomplete command.
  async function captureHint(clientOptions) {
    const showHint = jest
      .spyOn(CodeMirror, 'showHint')
      .mockImplementation(() => {})
    mockClient(clientOptions)
    const store = renderEditor()

    await waitFor(() => {
      CodeMirror.commands.autocomplete({})
      expect(showHint).toHaveBeenCalled()
      const opts = showHint.mock.calls[showHint.mock.calls.length - 1][2]
      expect(opts.predicates.length).toBeGreaterThan(0)
    })

    const call = showHint.mock.calls[showHint.mock.calls.length - 1]
    // [1] is the hinter Editor chose, [2] the options it built. Taking the
    // hinter from the call means the test cannot drift onto a different helper
    // than production uses.
    return { hinter: call[1], options: call[2], store, showHint }
  }

  const latestOptions = (showHint) =>
    showHint.mock.calls[showHint.mock.calls.length - 1][2]

  const captureHintOptions = async (o) => (await captureHint(o)).options

  // Drives the hint helper Editor selected, with the options Editor built, over
  // a real CodeMirror instance doing real graphql-mode tokenization. Nothing
  // here is a hand-rolled stand-in for production wiring.
  async function completionsAt(textWithCursor, clientOptions) {
    const { hinter, options } = await captureHint(clientOptions)
    const cm = editorAtCursor(CodeMirror, textWithCursor)
    const result = hinter(cm, options)
    return result.list.map((item) =>
      typeof item === 'string' ? item : item.text,
    )
  }

  it('hands the full predicate objects, not just names, to the hint helper', async () => {
    const opts = await captureHintOptions()

    const title = opts.predicates.find((p) => p.predicate === 'title')
    expect(title.tokenizer).toEqual(['exact'])
    expect(title.index).toBe(true)
    expect(title.type).toBe('string')
  })

  it('offers each predicate exactly once, not as both `name` and `<name>`', async () => {
    const list = await completionsAt('{ q(func: has(x)) { nam| }')

    expect(list.filter((w) => w === 'name' || w === '<name>')).toEqual(['name'])
  })

  it('never offers an angle-bracketed predicate', async () => {
    const list = await completionsAt('{ q(func: has(x)) { | }')

    expect(list.filter((w) => w.startsWith('<'))).toEqual([])
  })

  // Acceptance: predicates are not legal immediately after func:.
  it('offers root functions after func:, not predicates', async () => {
    const list = await completionsAt('{ q(func: | }')

    expect(list).toEqual(expect.arrayContaining(['eq', 'has', 'type']))
    expect(list).not.toContain('name')
    expect(list).not.toContain('title')
  })

  // Acceptance: tokenizer-aware filtering at a real argument position.
  it('offers exact-indexed title but not unindexed name inside eq()', async () => {
    const list = await completionsAt('{ q(func: eq(| }')

    expect(list).toContain('title')
    expect(list).not.toContain('name')
  })

  // Acceptance: both appear at a bare body position.
  it('offers both title and name at a bare body position', async () => {
    const list = await completionsAt('{ q(func: has(title)) { | }')

    expect(list).toContain('title')
    expect(list).toContain('name')
  })

  it('offers type names from the schema to type()', async () => {
    const list = await completionsAt('{ q(func: type(| }')

    expect(list).toContain('Person')
    expect(list).not.toContain('name')
  })

  it('still offers ui keywords fetched from the server', async () => {
    const list = await completionsAt('{ q(func: has(x)) { @fil| }')

    expect(list).toContain('@filter')
  })

  it('replaces exactly the typed term, so the completion does not splice', async () => {
    const { hinter, options } = await captureHint()
    const cm = editorAtCursor(CodeMirror, '{ q(func: eq(tit| }')
    const result = hinter(cm, options)

    expect(cm.getRange(result.from, result.to)).toBe('tit')
  })

  // A route change used to unmount Editor and destroy its schema, so a fresh
  // fetch happened by accident. The store outlives the route, so the refetch
  // now has to be deliberate: without it the session change clears the schema
  // and completion stays empty until the user happens to navigate away.
  it('refetches the schema when a new principal logs in under a mounted editor', async () => {
    const { store, showHint } = await captureHint()
    expect(
      latestOptions(showHint).predicates.map((p) => p.predicate),
    ).toContain('name')

    // A different principal logs in; the cluster now shows them less.
    mockClient({ schema: [{ predicate: 'only_b_can_see', type: 'string' }] })
    store.dispatch({
      type: LOGIN_SUCCESS,
      url: store.getState().connection.serverHistory[0].url,
      refreshToken: 'b',
    })

    await waitFor(() => {
      CodeMirror.commands.autocomplete({})
      expect(
        latestOptions(showHint).predicates.map((p) => p.predicate),
      ).toEqual(['only_b_can_see'])
    })
  })

  it('completes a keystroke against a 2000-predicate schema in under 16ms', async () => {
    const many = []
    for (let i = 0; i < 2000; i++) {
      many.push({
        predicate: `predicate_number_${i}`,
        type: 'string',
        index: true,
        tokenizer: ['exact'],
      })
    }

    const { hinter, options } = await captureHint({ schema: many })
    const cm = editorAtCursor(CodeMirror, '{ q(func: eq(pre| }')

    for (let i = 0; i < 20; i++) {
      hinter(cm, options)
    }

    const timings = []
    for (let i = 0; i < 51; i++) {
      const t0 = performance.now()
      hinter(cm, options)
      timings.push(performance.now() - t0)
    }
    timings.sort((a, b) => a - b)

    expect(hinter(cm, options).list.length).toBeGreaterThan(0)
    expect(timings[25]).toBeLessThan(16)
  })
})
