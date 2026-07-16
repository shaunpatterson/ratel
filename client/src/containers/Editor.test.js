/*
 * SPDX-FileCopyrightText: © 2017-2026 Istari Digital, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import { render, waitFor } from '@testing-library/react'
import React from 'react'
import { Provider } from 'react-redux'
import { combineReducers, createStore } from 'redux'

import ui from 'reducers/ui'
import { installCodeMirrorJsdomPolyfill } from 'testUtils/jsdomCodeMirror'

jest.mock('lib/helpers', () => ({
  ...jest.requireActual('lib/helpers'),
  getDgraphClient: jest.fn(),
}))

import { getDgraphClient } from 'lib/helpers'
import CodeMirror from './CodeMirror'
import Editor from './Editor'

const SCHEMA = [
  { predicate: 'name', type: 'string' },
  { predicate: 'title', type: 'string', index: true, tokenizer: ['exact'] },
]
const TYPES = [{ name: 'Person' }]

function mockClient({ schema = SCHEMA, types = TYPES } = {}) {
  getDgraphClient.mockResolvedValue({
    newTxn: () => ({ query: async () => ({ data: { schema, types } }) }),
    fetchUiKeywords: async () => ({ keywords: [{ name: 'func' }] }),
  })
}

function renderEditor() {
  const store = createStore(combineReducers({ ui }))
  return render(
    <Provider store={store}>
      <Editor query='' mode='graphql' onUpdateQuery={() => {}} />
    </Provider>,
  )
}

describe('Editor schema completion wiring', () => {
  beforeAll(installCodeMirrorJsdomPolyfill)

  beforeEach(() => jest.restoreAllMocks())

  // Captures the options Editor actually hands to CodeMirror.showHint, i.e. the
  // real production call path rather than a helper called directly.
  async function captureHintOptions() {
    const showHint = jest
      .spyOn(CodeMirror, 'showHint')
      .mockImplementation(() => {})
    mockClient()
    renderEditor()

    await waitFor(() => {
      CodeMirror.commands.autocomplete({})
      expect(showHint).toHaveBeenCalled()
      const opts = showHint.mock.calls[showHint.mock.calls.length - 1][2]
      expect(opts.words).toEqual(expect.arrayContaining(['name']))
    })

    return showHint.mock.calls[showHint.mock.calls.length - 1][2]
  }

  it('offers each predicate exactly once, not as both `name` and `<name>`', async () => {
    const opts = await captureHintOptions()

    const nameEntries = opts.words.filter((w) => w === 'name' || w === '<name>')
    expect(nameEntries).toEqual(['name'])
  })

  it('never offers an angle-bracketed predicate for any predicate', async () => {
    const opts = await captureHintOptions()

    const bracketed = opts.words.filter(
      (w) => typeof w === 'string' && w.startsWith('<'),
    )
    expect(bracketed).toEqual([])
  })
})
