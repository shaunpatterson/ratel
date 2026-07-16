/*
 * SPDX-FileCopyrightText: © 2017-2026 Istari Digital, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import { render, screen } from '@testing-library/react'
import React from 'react'
import { Provider } from 'react-redux'
import { createStore } from 'redux'

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

    // Whatever the shape of the link, the query must survive a round trip
    // through the URL parser the app uses on the receiving end.
    const url = new URL(input.value)
    const fromSearch = url.searchParams.get('query')
    const fromHash = new URLSearchParams(url.hash.replace(/^#/, '')).get(
      'query',
    )

    expect(fromSearch || fromHash).toBe(QUERY)
  })

  it('does not include the alpha address unless asked', () => {
    const input = renderSettings()

    expect(input.value).not.toContain('addr=')
  })
})
