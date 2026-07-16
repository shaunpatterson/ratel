/*
 * SPDX-FileCopyrightText: © 2017-2026 Istari Digital, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import queryReducer from 'reducers/query'
import { openQueryInNewTab } from './drill'

// Drives the REAL reducer through the REAL thunk. A drill that dispatched into
// a mock store would pass while destroying the user's editor in production.
const runThunk = (thunk, initialState) => {
  let state = queryReducer(initialState, { type: '@@INIT' })
  const dispatch = (action) => {
    if (typeof action === 'function') {
      return action(dispatch, () => state)
    }
    state = queryReducer(state, action)
    return action
  }
  dispatch(thunk)
  return state
}

describe('openQueryInNewTab', () => {
  it('previews the derived query in a NEW tab', () => {
    const state = runThunk(
      openQueryInNewTab('{ drill(func: eq(a, "b")) {} }'),
      {
        query: '{ original }',
        action: 'query',
      },
    )

    expect(state.tabs).toHaveLength(2)
    expect(state.query).toBe('{ drill(func: eq(a, "b")) {} }')
    expect(state.activeTabId).toBe(state.tabs[1].id)
  })

  it('does NOT destroy the query the user already had open', () => {
    const state = runThunk(openQueryInNewTab('{ derived }'), {
      query: '{ precious unsaved work }',
      action: 'query',
    })

    const surviving = state.tabs.find(
      (t) => t.query === '{ precious unsaved work }',
    )
    expect(surviving).toBeDefined()
  })

  it('forces the query action, so a drill never lands in a mutate tab', () => {
    const state = runThunk(openQueryInNewTab('{ derived }'), {
      query: '{ set { <0x1> <a> "b" . } }',
      action: 'mutate',
    })
    expect(state.action).toBe('query')
    expect(state.query).toBe('{ derived }')
  })

  it('never auto-runs — it dispatches no frame-running action', () => {
    const dispatched = []
    const dispatch = (action) => {
      if (typeof action === 'function') {
        return action(dispatch, () => ({}))
      }
      dispatched.push(action)
      return action
    }
    dispatch(openQueryInNewTab('{ derived }'))

    // Running a query pushes a frame; a preview must not.
    expect(dispatched.some((a) => /frames\//.test(a.type || ''))).toBe(false)
    expect(dispatched.map((a) => a.type)).toEqual([
      'query/ADD_TAB',
      'query/UPDATE_QUERY_AND_ACTION',
    ])
  })
})
