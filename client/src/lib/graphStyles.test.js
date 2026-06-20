/*
 * SPDX-FileCopyrightText: © 2017-2026 Istari Digital, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  MAX_NODE_SIZE,
  MIN_NODE_SIZE,
  backgroundToColor,
  loadActivePresetId,
  loadBackground,
  loadPresets,
  loadStyleRules,
  sanitizePreset,
  sanitizeRule,
  sanitizeRules,
  saveActivePresetId,
  saveBackground,
  savePresets,
  saveStyleRules,
  updateRule,
} from './graphStyles'

const memoryStorage = () => {
  const data = {}
  return {
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => {
      data[k] = String(v)
    },
    removeItem: (k) => {
      delete data[k]
    },
  }
}

describe('sanitizeRule', () => {
  it('accepts valid color and size', () => {
    expect(sanitizeRule({ color: '#A1B2C3', size: 10 })).toEqual({
      color: '#a1b2c3',
      size: 10,
    })
  })

  it('rejects malformed colors', () => {
    expect(sanitizeRule({ color: 'red' })).toBe(null)
    expect(sanitizeRule({ color: '#fff' })).toBe(null)
    expect(sanitizeRule({ color: 'javascript:x' })).toBe(null)
  })

  it('clamps size to bounds', () => {
    expect(sanitizeRule({ size: 1 }).size).toBe(MIN_NODE_SIZE)
    expect(sanitizeRule({ size: 999 }).size).toBe(MAX_NODE_SIZE)
  })

  it('accepts known shape and labelPosition values', () => {
    expect(sanitizeRule({ shape: 'square', labelPosition: 'top' })).toEqual({
      shape: 'square',
      labelPosition: 'top',
    })
  })

  it('rejects unknown shape and labelPosition values', () => {
    expect(sanitizeRule({ shape: 'star', labelPosition: 'diagonal' })).toBe(
      null,
    )
  })

  it('returns null for empty/invalid input', () => {
    expect(sanitizeRule(null)).toBe(null)
    expect(sanitizeRule({})).toBe(null)
    expect(sanitizeRule({ size: 'abc' })).toBe(null)
  })
})

describe('sanitizeRules', () => {
  it('drops invalid groups and keeps valid ones', () => {
    expect(
      sanitizeRules({
        friend: { color: '#112233' },
        bad: { color: 'nope' },
      }),
    ).toEqual({ friend: { color: '#112233' } })
  })

  it('handles garbage input', () => {
    expect(sanitizeRules(null)).toEqual({})
    expect(sanitizeRules('x')).toEqual({})
  })
})

describe('load/save round trip', () => {
  it('persists and restores rules', () => {
    const storage = memoryStorage()
    saveStyleRules({ friend: { color: '#112233', size: 8 } }, storage)
    expect(loadStyleRules(storage)).toEqual({
      friend: { color: '#112233', size: 8 },
    })
  })

  it('returns empty object for corrupt storage', () => {
    const storage = memoryStorage()
    storage.setItem('ratel-graph-style-rules', '{not json')
    expect(loadStyleRules(storage)).toEqual({})
  })
})

describe('updateRule', () => {
  it('merges changes per group', () => {
    let rules = updateRule({}, 'friend', { color: '#112233' })
    rules = updateRule(rules, 'friend', { size: 12 })
    expect(rules.friend).toEqual({ color: '#112233', size: 12 })
  })

  it('removes a group when the rule becomes empty', () => {
    const rules = updateRule({ friend: { color: '#112233' } }, 'friend', {
      color: 'invalid',
    })
    expect(rules).toEqual({})
  })

  it('does not mutate the input', () => {
    const input = { friend: { color: '#112233' } }
    updateRule(input, 'friend', { size: 9 })
    expect(input).toEqual({ friend: { color: '#112233' } })
  })
})

describe('presets', () => {
  it('round-trips a saved preset list', () => {
    const storage = memoryStorage()
    const presets = [
      {
        id: 'p1',
        name: 'Bloom',
        rules: { friend: { color: '#445566', size: 9 } },
        background: 'dark',
        labelPosition: 'top',
      },
    ]
    savePresets(presets, storage)
    expect(loadPresets(storage)).toEqual(presets)
  })

  it('drops malformed entries on load', () => {
    const storage = memoryStorage()
    storage.setItem(
      'ratel-graph-style-presets',
      JSON.stringify([{ id: 'a', name: 'good', rules: {} }, { rules: {} }]),
    )
    expect(loadPresets(storage)).toEqual([
      expect.objectContaining({ id: 'a', name: 'good' }),
    ])
  })

  it('assigns an id when sanitising a nameless preset', () => {
    const out = sanitizePreset({ name: 'X', rules: {} })
    expect(out.id).toMatch(/^preset-/)
    expect(out.name).toBe('X')
  })

  it('rejects presets without a name', () => {
    expect(sanitizePreset({ rules: {} })).toBe(null)
    expect(sanitizePreset({ name: '   ' })).toBe(null)
  })

  it('tracks the active preset id separately', () => {
    const storage = memoryStorage()
    saveActivePresetId('p1', storage)
    expect(loadActivePresetId(storage)).toBe('p1')
    saveActivePresetId(null, storage)
    expect(loadActivePresetId(storage)).toBe(null)
  })
})

describe('background preference', () => {
  it('accepts hex colours and named preset ids', () => {
    expect(loadBackground({ getItem: () => '#abcdef' })).toBe('#abcdef')
    expect(loadBackground({ getItem: () => 'dark' })).toBe('dark')
    expect(loadBackground({ getItem: () => 'nope' })).toBe(null)
  })

  it('clears the key when given an invalid value', () => {
    const storage = memoryStorage()
    saveBackground('nope', storage)
    expect(storage.getItem('ratel-graph-background')).toBe(null)
  })

  it('resolves a preset id to its hex colour', () => {
    expect(backgroundToColor('dark')).toBe('#1a1a1a')
    expect(backgroundToColor('#abcdef')).toBe('#abcdef')
    expect(backgroundToColor('nope')).toBe(null)
  })
})
