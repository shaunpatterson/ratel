/*
 * SPDX-FileCopyrightText: © 2017-2026 Istari Digital, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import { render, screen } from '@testing-library/react'
import React from 'react'
import { Provider } from 'react-redux'
import { createStore } from 'redux'

import { getQueryParam } from 'lib/helpers'

import SharingSettings from './SharingSettings'

const SERVER_URL = 'http://localhost:8080'
const QUERY = '{ me(func: uid(0x1)) { name } }'

function renderSettings() {
  const store = createStore(() => ({
    connection: { serverHistory: [{ url: SERVER_URL }] },
  }))
  render(
    <Provider store={store}>
      <SharingSettings title='Test' query={QUERY} />
    </Provider>,
  )
  return screen.getByRole('textbox')
}

describe('SharingSettings', () => {
  it('defaults the share target to this Ratel, not a public playground', () => {
    const input = renderSettings()

    expect(input.value.startsWith(window.location.origin)).toBe(true)
    expect(input.value).not.toContain('play.dgraph.io')
  })

  it('builds a link the receiver can actually parse', () => {
    const input = renderSettings()

    // Round-trip through the SAME parser the receiver runs, rather than a
    // hand-rolled one that could disagree with it about precedence.
    window.history.replaceState({}, '', input.value)

    expect(getQueryParam()).toBe(QUERY)
  })

  it('keeps the shared query out of the HTTP request line', () => {
    const input = renderSettings()

    // A search param travels to the Ratel host in the request line, so the
    // user's private DQL lands in its access logs, any proxy in front of it,
    // and Referer headers on every subsequent asset request. A fragment is
    // never sent over the wire. Sharing a query must not publish it.
    const url = new URL(input.value)

    expect(url.searchParams.get('query')).toBeNull()
    expect(url.search).toBe('')
  })

  it('does not include the alpha address unless asked', () => {
    const input = renderSettings()

    expect(input.value).not.toContain('addr=')
  })
})
