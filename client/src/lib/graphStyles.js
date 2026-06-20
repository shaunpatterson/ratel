/*
 * SPDX-FileCopyrightText: © 2017-2026 Istari Digital, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

// Persistence for per-group graph style rules (Neo4j Bloom-style
// "perspectives") and named presets that bundle a rule set the user can
// quickly switch between. Both are kept in localStorage so a developer's
// viewing preferences survive reloads.

const RULES_KEY = 'ratel-graph-style-rules'
const PRESETS_KEY = 'ratel-graph-style-presets'
const ACTIVE_PRESET_KEY = 'ratel-graph-style-active-preset'
const BG_KEY = 'ratel-graph-background'

export const MIN_NODE_SIZE = 4
export const MAX_NODE_SIZE = 20

// Sigma v4 supports these node shapes out of the box. We expose them by
// name so the style panel can pick one per group.
export const NODE_SHAPES = ['circle', 'square', 'triangle', 'diamond']
export const LABEL_POSITIONS = ['inside', 'top', 'bottom', 'left', 'right']
export const BACKGROUND_PRESETS = [
  { id: 'light', color: '#ffffff' },
  { id: 'dark', color: '#1a1a1a' },
  { id: 'paper', color: '#f5f3ec' },
  { id: 'midnight', color: '#0d1117' },
]

export function sanitizeRule(rule) {
  if (!rule || typeof rule !== 'object') {
    return null
  }
  const out = {}
  if (typeof rule.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(rule.color)) {
    out.color = rule.color.toLowerCase()
  }
  const size = Number(rule.size)
  if (Number.isFinite(size)) {
    out.size = Math.min(MAX_NODE_SIZE, Math.max(MIN_NODE_SIZE, size))
  }
  if (typeof rule.shape === 'string' && NODE_SHAPES.includes(rule.shape)) {
    out.shape = rule.shape
  }
  if (
    typeof rule.labelPosition === 'string' &&
    LABEL_POSITIONS.includes(rule.labelPosition)
  ) {
    out.labelPosition = rule.labelPosition
  }
  return Object.keys(out).length ? out : null
}

export function sanitizeRules(rules) {
  if (!rules || typeof rules !== 'object') {
    return {}
  }
  const out = {}
  Object.keys(rules).forEach((group) => {
    const rule = sanitizeRule(rules[group])
    if (rule) {
      out[group] = rule
    }
  })
  return out
}

export function loadStyleRules(storage = window.localStorage) {
  try {
    return sanitizeRules(JSON.parse(storage.getItem(RULES_KEY)))
  } catch {
    return {}
  }
}

export function saveStyleRules(rules, storage = window.localStorage) {
  try {
    storage.setItem(RULES_KEY, JSON.stringify(sanitizeRules(rules)))
  } catch {
    // Storage full or unavailable - styling is cosmetic, ignore.
  }
}

// Merges a single field change into the rule set, dropping empty rules.
export function updateRule(rules, group, change) {
  const next = { ...rules }
  const merged = sanitizeRule({ ...next[group], ...change })
  if (merged) {
    next[group] = merged
  } else {
    delete next[group]
  }
  return next
}

// --- Saved presets ----------------------------------------------------
//
// A preset is a named snapshot of `styleRules` plus the background
// colour and global label position. They live next to the live rules
// in localStorage, and one of them can be marked "active" so we can
// re-apply the same view across sessions.

function sanitizeBackground(value) {
  if (typeof value !== 'string') {
    return null
  }
  if (/^#[0-9a-fA-F]{6}$/i.test(value)) {
    return value.toLowerCase()
  }
  const match = BACKGROUND_PRESETS.find((p) => p.id === value)
  return match ? match.id : null
}

function sanitizeLabelPosition(value) {
  return LABEL_POSITIONS.includes(value) ? value : null
}

export function sanitizePreset(preset) {
  if (!preset || typeof preset !== 'object') {
    return null
  }
  const name = typeof preset.name === 'string' ? preset.name.trim() : ''
  if (!name) {
    return null
  }
  return {
    id:
      typeof preset.id === 'string' && preset.id
        ? preset.id
        : `preset-${Date.now().toString(36)}-${Math.random()
            .toString(36)
            .slice(2, 8)}`,
    name,
    rules: sanitizeRules(preset.rules),
    background: sanitizeBackground(preset.background),
    labelPosition: sanitizeLabelPosition(preset.labelPosition),
  }
}

export function loadPresets(storage = window.localStorage) {
  try {
    const raw = JSON.parse(storage.getItem(PRESETS_KEY))
    if (!Array.isArray(raw)) {
      return []
    }
    return raw.map(sanitizePreset).filter(Boolean)
  } catch {
    return []
  }
}

export function savePresets(presets, storage = window.localStorage) {
  try {
    storage.setItem(
      PRESETS_KEY,
      JSON.stringify(presets.map(sanitizePreset).filter(Boolean)),
    )
  } catch {
    // Ignore - cosmetic.
  }
}

export function loadActivePresetId(storage = window.localStorage) {
  try {
    return storage.getItem(ACTIVE_PRESET_KEY) || null
  } catch {
    return null
  }
}

export function saveActivePresetId(id, storage = window.localStorage) {
  try {
    if (id) {
      storage.setItem(ACTIVE_PRESET_KEY, id)
    } else {
      storage.removeItem(ACTIVE_PRESET_KEY)
    }
  } catch {
    // Ignore.
  }
}

// --- Background colour preference --------------------------------------

export function loadBackground(storage = window.localStorage) {
  try {
    return sanitizeBackground(storage.getItem(BG_KEY))
  } catch {
    return null
  }
}

export function saveBackground(background, storage = window.localStorage) {
  try {
    const value = sanitizeBackground(background)
    if (value) {
      storage.setItem(BG_KEY, value)
    } else {
      storage.removeItem(BG_KEY)
    }
  } catch {
    // Ignore.
  }
}

export function backgroundToColor(value) {
  if (!value) {
    return null
  }
  if (typeof value === 'string' && /^#[0-9a-fA-F]{6}$/i.test(value)) {
    return value
  }
  const match = BACKGROUND_PRESETS.find((p) => p.id === value)
  return match ? match.color : null
}
