/*
 * SPDX-FileCopyrightText: © 2017-2026 Istari Digital, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  ENV_COLORS,
  ENV_DEVELOPMENT,
  ENV_NONE,
  ENV_PRODUCTION,
  ENV_STAGING,
  ENVIRONMENTS,
  getEnvironment,
  getEnvironmentColor,
  getServerEnvironment,
} from './environments'

describe('ENVIRONMENTS / ENV_COLORS', () => {
  it('lists none, development, staging and production', () => {
    expect(ENVIRONMENTS).toEqual([
      ENV_NONE,
      ENV_DEVELOPMENT,
      ENV_STAGING,
      ENV_PRODUCTION,
    ])
  })

  it('has a color for every environment except none', () => {
    expect(ENV_COLORS[ENV_DEVELOPMENT]).toBe('#28a745')
    expect(ENV_COLORS[ENV_STAGING]).toBe('#fd7e14')
    expect(ENV_COLORS[ENV_PRODUCTION]).toBe('#dc3545')
    expect(ENV_COLORS[ENV_NONE]).toBeUndefined()
  })
})

describe('getServerEnvironment', () => {
  it('returns the environment of a server record', () => {
    expect(getServerEnvironment({ environment: 'production' })).toBe(
      'production',
    )
  })

  it('defaults to none for legacy records without the field', () => {
    expect(getServerEnvironment({ url: 'http://localhost:8080' })).toBe(
      ENV_NONE,
    )
  })

  it('defaults to none for unknown values and missing servers', () => {
    expect(getServerEnvironment({ environment: 'gibberish' })).toBe(ENV_NONE)
    expect(getServerEnvironment(undefined)).toBe(ENV_NONE)
    expect(getServerEnvironment(null)).toBe(ENV_NONE)
  })
})

describe('getEnvironment', () => {
  it('returns the environment of the active (first) connection', () => {
    const connectionState = {
      serverHistory: [
        { url: 'http://prod:8080', environment: 'production' },
        { url: 'http://dev:8080', environment: 'development' },
      ],
    }
    expect(getEnvironment(connectionState)).toBe('production')
  })

  it('returns none for legacy state where connections lack the field', () => {
    const legacyState = {
      serverHistory: [{ url: 'http://localhost:8080' }],
    }
    expect(getEnvironment(legacyState)).toBe(ENV_NONE)
  })

  it('returns none for empty or missing state', () => {
    expect(getEnvironment(undefined)).toBe(ENV_NONE)
    expect(getEnvironment({})).toBe(ENV_NONE)
    expect(getEnvironment({ serverHistory: [] })).toBe(ENV_NONE)
  })
})

describe('getEnvironmentColor', () => {
  it('maps each environment to its color', () => {
    expect(getEnvironmentColor(ENV_DEVELOPMENT)).toBe('#28a745')
    expect(getEnvironmentColor(ENV_STAGING)).toBe('#fd7e14')
    expect(getEnvironmentColor(ENV_PRODUCTION)).toBe('#dc3545')
  })

  it('returns null for none or unknown environments', () => {
    expect(getEnvironmentColor(ENV_NONE)).toBeNull()
    expect(getEnvironmentColor('gibberish')).toBeNull()
    expect(getEnvironmentColor(undefined)).toBeNull()
  })
})
