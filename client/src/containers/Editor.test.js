/*
 * SPDX-FileCopyrightText: © 2017-2026 Istari Digital, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import { act, render, waitFor } from '@testing-library/react'
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

function makeStore() {
  return createStore(
    combineReducers({ connection, schema, ui }),
    applyMiddleware(ReduxThunk),
  )
}

function renderEditor(store = makeStore()) {
  const { container, unmount } = render(
    <Provider store={store}>
      <Editor query='' mode='graphql' onUpdateQuery={() => {}} />
    </Provider>,
  )
  store.unmount = unmount
  // Editor's own CodeMirror instance, reached the way the DOM exposes it.
  // Scoped to this render's container: editorAtCursor leaves its throwaway
  // editors attached to document.body, so a document-wide query finds whichever
  // one an earlier test happened to leave behind.
  store.editor = () => container.querySelector('.CodeMirror').CodeMirror
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

  it('replaces the whole word when completing from mid-word', async () => {
    // Cursor sits inside an existing `title`. Replacing only the text behind
    // the cursor would leave the tail behind and produce `titlele`.
    const { hinter, options } = await captureHint()
    const cm = editorAtCursor(CodeMirror, '{ q(func: eq(tit|le }')
    const result = hinter(cm, options)

    expect(cm.getRange(result.from, result.to)).toBe('title')
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

  // The Schema page mutates the schema through its own component, which knows
  // nothing about this store. Before the store existed, Editor refetched on
  // every mount, so navigating Schema -> Query always picked up an edit. A
  // cache keyed on (session, url) silently took that away: the guard matches,
  // the thunk returns early, and completion offers a schema the cluster no
  // longer has.
  it('picks up a predicate added on the schema page since the last mount', async () => {
    const showHint = jest
      .spyOn(CodeMirror, 'showHint')
      .mockImplementation(() => {})
    mockClient()
    const store = renderEditor()

    await waitFor(() => {
      CodeMirror.commands.autocomplete({})
      expect(latestOptions(showHint).predicates.length).toBeGreaterThan(0)
    })
    store.unmount()

    // The user adds `email` on the Schema page. Same server, same principal --
    // nothing here bumps the generation, so nothing invalidates the slice.
    mockClient({ schema: [...SCHEMA, { predicate: 'email', type: 'string' }] })
    renderEditor(store)

    await waitFor(() => {
      CodeMirror.commands.autocomplete({})
      expect(
        latestOptions(showHint).predicates.map((p) => p.predicate),
      ).toContain('email')
    })
  })

  // Dgraph rejects uid_in at the query root: it asks whether the node under
  // consideration has an edge to a uid, and at the root there is no node under
  // consideration yet -- the root function is what produces one.
  it('does not offer uid_in at the query root, where Dgraph rejects it', async () => {
    const list = await completionsAt('{ q(func: | }')

    expect(list).toContain('has')
    expect(list).not.toContain('uid_in')
  })

  it('offers uid_in inside @filter, where it is legal', async () => {
    const list = await completionsAt('{ q(func: has(name)) @filter(| }')

    expect(list).toContain('uid_in')
  })

  // `Person` is a type name, not a predicate. `q(func: type(Person)) { Person }`
  // is not a query with a redundant line in it; it is a syntax error.
  it('does not offer a type name as a bare body selection', async () => {
    const list = await completionsAt('{ q(func: has(title)) { | }')

    expect(list).toContain('name')
    expect(list).not.toContain('Person')
  })

  // CodeMirror.commands.autocomplete is a global. Whatever it closes over
  // outlives the component that installed it.
  it('drops the global autocomplete command when the editor unmounts', async () => {
    const showHint = jest
      .spyOn(CodeMirror, 'showHint')
      .mockImplementation(() => {})
    mockClient()
    const store = renderEditor()

    await waitFor(() => {
      CodeMirror.commands.autocomplete({})
      expect(latestOptions(showHint).predicates.length).toBeGreaterThan(0)
    })

    store.unmount()

    expect(CodeMirror.commands.autocomplete).toBeUndefined()
  })

  // The reducer clears the slice synchronously, inside the dispatch, and the
  // comment there claims the guardian's predicates are gone "before React
  // renders". That claim is only true of the store. If the thing that answers a
  // keystroke closes over a rendered value instead of reading the store, the
  // claim buys nothing: React 18 batches, so the re-render that would refresh
  // the closure has not happened when the dispatch returns.
  it('cannot offer the previous principal predicates once the session dispatch returns', async () => {
    const showHint = jest
      .spyOn(CodeMirror, 'showHint')
      .mockImplementation(() => {})
    mockClient()
    const store = renderEditor()

    await waitFor(() => {
      CodeMirror.commands.autocomplete({})
      expect(
        latestOptions(showHint).predicates.map((p) => p.predicate),
      ).toContain('name')
    })

    // Principal B's schema never arrives; the question is what is reachable in
    // the instant after the reducer clears. Deliberately not wrapped in act():
    // flushing effects here would test React's scheduler, not the wiring.
    getDgraphClient.mockResolvedValue({
      newTxn: () => ({ query: () => new Promise(() => {}) }),
      fetchUiKeywords: async () => ({ keywords: [] }),
    })
    store.dispatch({
      type: LOGIN_SUCCESS,
      url: store.getState().connection.serverHistory[0].url,
      refreshToken: 'b',
    })

    CodeMirror.commands.autocomplete({})
    expect(latestOptions(showHint).predicates).toEqual([])
  })

  // An open popup has already materialized principal A's predicate names into
  // the DOM. Clearing the store does not unpaint them.
  it('closes an open completion popup when the session turns over', async () => {
    mockClient()
    const store = renderEditor()

    await waitFor(() =>
      expect(store.getState().schema.predicates.length).toBeGreaterThan(0),
    )

    const cm = store.editor()
    act(() => {
      cm.setValue('{ q(func: has(title)) { nam }')
      cm.setCursor({ line: 0, ch: 27 })
      CodeMirror.commands.autocomplete(cm)
    })

    const popup = document.querySelector('.CodeMirror-hints')
    expect(popup).not.toBeNull()
    expect(popup.textContent).toContain('name')

    act(() => {
      store.dispatch({
        type: LOGIN_SUCCESS,
        url: store.getState().connection.serverHistory[0].url,
        refreshToken: 'b',
      })
    })

    expect(document.querySelector('.CodeMirror-hints')).toBeNull()
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
