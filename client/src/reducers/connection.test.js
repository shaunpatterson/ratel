/*
 * SPDX-FileCopyrightText: © 2017-2026 Istari Digital, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import { SET_ENVIRONMENT, setEnvironment, UPDATE_URL } from 'actions/connection'
import { ENV_NONE, getEnvironment } from 'lib/environments'
import connection from './connection'

const URL_A = 'http://server-a:8080'
const URL_B = 'http://server-b:8080'

const makeState = (servers) => ({
  serverHistory: servers,
})

describe('connection reducer - environment', () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.clearAllTimers()
    jest.useRealTimers()
  })

  it('initializes new server records with environment set to none', () => {
    const state = connection(undefined, { type: '@@INIT' })
    expect(state.serverHistory.length).toBeGreaterThan(0)
    state.serverHistory.forEach((s) => {
      expect(s.environment).toBe(ENV_NONE)
    })
  })

  it('sets the environment on the matching connection', () => {
    const state = makeState([
      { url: URL_A, environment: '' },
      { url: URL_B, environment: '' },
    ])

    const newState = connection(state, setEnvironment(URL_B, 'staging'))

    expect(newState.serverHistory[1].environment).toBe('staging')
    // Other connections are untouched.
    expect(newState.serverHistory[0].environment).toBe(ENV_NONE)
  })

  it('sets the environment on the active connection', () => {
    const state = makeState([{ url: URL_A, environment: '' }])

    const newState = connection(state, setEnvironment(URL_A, 'production'))

    expect(newState.serverHistory[0].environment).toBe('production')
    expect(getEnvironment(newState)).toBe('production')
  })

  it('falls back to none for invalid environment values', () => {
    const state = makeState([{ url: URL_A, environment: 'production' }])

    const newState = connection(state, {
      type: SET_ENVIRONMENT,
      url: URL_A,
      environment: 'not-a-real-env',
    })

    expect(newState.serverHistory[0].environment).toBe(ENV_NONE)
  })

  it('does not break on legacy connections without the environment field', () => {
    // Simulates redux-persist rehydrating state stored by an old version.
    const legacyState = makeState([{ url: URL_A }])

    const newState = connection(legacyState, { type: 'some/UNRELATED' })

    expect(newState.serverHistory[0].environment).toBeUndefined()
    expect(getEnvironment(newState)).toBe(ENV_NONE)

    // And setting an environment on a legacy record works.
    const updated = connection(legacyState, setEnvironment(URL_A, 'staging'))
    expect(getEnvironment(updated)).toBe('staging')
  })

  it('keeps the environment when switching between connections', () => {
    const state = makeState([
      { url: URL_A, environment: 'production' },
      { url: URL_B, environment: 'development' },
    ])

    const switched = connection(state, { type: UPDATE_URL, url: URL_B })
    expect(switched.serverHistory[0].url).toBe(URL_B)
    expect(getEnvironment(switched)).toBe('development')

    const switchedBack = connection(switched, { type: UPDATE_URL, url: URL_A })
    expect(switchedBack.serverHistory[0].url).toBe(URL_A)
    expect(getEnvironment(switchedBack)).toBe('production')
  })

  it('adds new connections with environment defaulting to none', () => {
    const state = makeState([{ url: URL_A, environment: 'production' }])

    const newState = connection(state, { type: UPDATE_URL, url: URL_B })

    expect(newState.serverHistory[0].url).toBe(URL_B)
    expect(newState.serverHistory[0].environment).toBe(ENV_NONE)
  })

  it('persists the environment in a JSON-serializable shape', () => {
    const state = makeState([{ url: URL_A, environment: '' }])
    const newState = connection(state, setEnvironment(URL_A, 'production'))

    // redux-persist serializes the connection store to localStorage.
    const roundTripped = JSON.parse(JSON.stringify(newState))
    expect(roundTripped.serverHistory[0].environment).toBe('production')
    expect(getEnvironment(roundTripped)).toBe('production')
  })
})
