/*
 * SPDX-FileCopyrightText: © 2017-2026 Istari Digital, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import { persistConfig } from './AppProvider'

describe('redux-persist configuration', () => {
  // The schema slice holds ACL-filtered `schema {}` output. Persisting it makes
  // it outlive both logout and a page reload, which turns a transient
  // per-session cache into a durable cross-principal disclosure in localStorage.
  // Any change that adds 'schema' here must be treated as a security change.
  it('does not persist the schema slice', () => {
    expect(persistConfig.whitelist).not.toContain('schema')
  })

  it('still persists the slices that are genuinely user state', () => {
    expect(persistConfig.whitelist).toEqual([
      'backup',
      'frames',
      'connection',
      'query',
      'ui',
    ])
  })
})
