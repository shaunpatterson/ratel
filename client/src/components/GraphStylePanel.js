/*
 * SPDX-FileCopyrightText: © 2017-2026 Istari Digital, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react'

import {
  BACKGROUND_PRESETS,
  LABEL_POSITIONS,
  MAX_NODE_SIZE,
  MIN_NODE_SIZE,
  NODE_SHAPES,
  backgroundToColor,
  loadPresets,
  sanitizePreset,
  updateRule,
} from '../lib/graphStyles'

import './GraphStylePanel.scss'

const SHAPE_ICONS = {
  circle: '●',
  square: '■',
  triangle: '▲',
  diamond: '◆',
}

const LABEL_POSITION_LABELS = {
  inside: 'Inside',
  top: 'Top',
  bottom: 'Bottom',
  left: 'Left',
  right: 'Right',
}

// Per-group style overrides (color / node size / shape / label
// position) plus a small preset manager: name the current ruleset,
// switch back to a previously-saved one, or delete a saved preset.
// The Neo4j Bloom-style group rules sit alongside the named presets
// so the user can A/B them without losing either.
export default function GraphStylePanel({
  groups,
  styleRules,
  onChange,
  onClose,
  background,
  onBackgroundChange,
  defaultLabelPosition,
  onDefaultLabelPositionChange,
}) {
  const [presets, setPresets] = React.useState(() => loadPresets())
  const [activePresetId, setActivePresetId] = React.useState(
    () => presets[0]?.id || null,
  )
  const [nameDraft, setNameDraft] = React.useState('')
  const customInputRef = React.useRef(null)

  const handleColor = (group, color) =>
    onChange(updateRule(styleRules, group, { color }))
  const handleSize = (group, size) =>
    onChange(updateRule(styleRules, group, { size: Number(size) }))
  const handleShape = (group, shape) =>
    onChange(updateRule(styleRules, group, { shape }))
  const handleLabelPosition = (group, labelPosition) =>
    onChange(updateRule(styleRules, group, { labelPosition }))
  const handleReset = (group) => {
    const next = { ...styleRules }
    delete next[group]
    onChange(next)
  }

  const handleSavePreset = () => {
    const name = nameDraft.trim()
    if (!name) return
    const preset = sanitizePreset({
      name,
      rules: styleRules,
      background,
      labelPosition: defaultLabelPosition,
    })
    if (!preset) return
    const next = presets.filter((p) => p.id !== preset.id)
    next.unshift(preset)
    setPresets(next)
    setActivePresetId(preset.id)
    setNameDraft('')
  }

  const handleApplyPreset = (id) => {
    const preset = presets.find((p) => p.id === id)
    if (!preset) return
    setActivePresetId(id)
    onChange(preset.rules)
    if (onBackgroundChange) onBackgroundChange(preset.background)
    if (
      onDefaultLabelPositionChange &&
      preset.labelPosition !== defaultLabelPosition
    ) {
      onDefaultLabelPositionChange(preset.labelPosition)
    }
  }

  const handleDeletePreset = (id) => {
    const next = presets.filter((p) => p.id !== id)
    setPresets(next)
    if (activePresetId === id) setActivePresetId(null)
  }

  const handlePickBackground = (value) => {
    onBackgroundChange(value)
  }

  const backgroundColor = backgroundToColor(background) || '#ffffff'

  return (
    <div className='graph-style-panel'>
      <div className='graph-style-panel__header'>
        <span>Graph styles</span>
        <button
          type='button'
          className='graph-style-panel__close'
          onClick={onClose}
          title='Close'
        >
          ×
        </button>
      </div>

      {/* Preset bar: pick / save / delete a named stylesheet. */}
      <div className='graph-style-panel__presets'>
        <select
          aria-label='Saved preset'
          className='graph-style-panel__preset-select'
          value={activePresetId || ''}
          onChange={(e) => {
            if (e.target.value === '__save__') return
            handleApplyPreset(e.target.value)
          }}
        >
          <option value='' disabled>
            {presets.length ? 'Select preset' : 'No presets yet'}
          </option>
          {presets.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        {activePresetId && (
          <button
            type='button'
            className='graph-style-panel__preset-delete'
            onClick={() => handleDeletePreset(activePresetId)}
            title='Delete preset'
          >
            ×
          </button>
        )}
        <input
          type='text'
          aria-label='New preset name'
          className='graph-style-panel__preset-name'
          placeholder='New preset…'
          value={nameDraft}
          onChange={(e) => setNameDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSavePreset()
          }}
        />
        <button
          type='button'
          className='graph-style-panel__preset-save'
          onClick={handleSavePreset}
          disabled={!nameDraft.trim()}
          title='Save current rules as a named preset'
        >
          Save
        </button>
      </div>

      {/* Background swatches: light/dark/paper/midnight + a free-form
          hex picker. The chosen value is persisted and re-applied to
          the canvas from GraphContainer. */}
      <div className='graph-style-panel__backgrounds'>
        <span className='graph-style-panel__sub-label'>Background</span>
        <div className='graph-style-panel__bg-row'>
          {BACKGROUND_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type='button'
              className={`graph-style-panel__bg-swatch ${
                background === preset.id ? 'active' : ''
              }`}
              style={{ background: preset.color }}
              onClick={() => handlePickBackground(preset.id)}
              title={preset.id}
              aria-label={`Background ${preset.id}`}
            />
          ))}
          <button
            type='button'
            className='graph-style-panel__bg-custom'
            onClick={() => customInputRef.current?.click()}
            title='Custom background colour'
          >
            +
          </button>
          <input
            ref={customInputRef}
            type='color'
            className='graph-style-panel__bg-input'
            value={backgroundColor}
            onChange={(e) => handlePickBackground(e.target.value)}
          />
        </div>
      </div>

      {/* Global default label position: applied to nodes whose group
          has no explicit rule. */}
      <div className='graph-style-panel__row graph-style-panel__row--inline'>
        <span className='graph-style-panel__name'>Labels</span>
        <select
          aria-label='Default label position'
          value={defaultLabelPosition || 'inside'}
          onChange={(e) => onDefaultLabelPositionChange(e.target.value)}
        >
          {LABEL_POSITIONS.map((pos) => (
            <option key={pos} value={pos}>
              {LABEL_POSITION_LABELS[pos]}
            </option>
          ))}
        </select>
      </div>

      {groups.length === 0 ? (
        <div className='graph-style-panel__empty'>No groups in this graph</div>
      ) : (
        groups.map(({ group, color }) => {
          const rule = styleRules[group] || {}
          return (
            <div className='graph-style-panel__row' key={group}>
              <span className='graph-style-panel__name' title={group}>
                {group}
              </span>
              <input
                type='color'
                aria-label={`Color for ${group}`}
                value={rule.color || color || '#cccccc'}
                onChange={(e) => handleColor(group, e.target.value)}
              />
              <input
                type='range'
                aria-label={`Node size for ${group}`}
                min={MIN_NODE_SIZE}
                max={MAX_NODE_SIZE}
                value={rule.size || 7}
                onChange={(e) => handleSize(group, e.target.value)}
              />
              <select
                aria-label={`Shape for ${group}`}
                className='graph-style-panel__shape'
                value={rule.shape || 'circle'}
                onChange={(e) => handleShape(group, e.target.value)}
                title='Node shape'
              >
                {NODE_SHAPES.map((s) => (
                  <option key={s} value={s}>
                    {SHAPE_ICONS[s]} {s}
                  </option>
                ))}
              </select>
              <select
                aria-label={`Label position for ${group}`}
                className='graph-style-panel__label-pos'
                value={rule.labelPosition || ''}
                onChange={(e) =>
                  handleLabelPosition(
                    group,
                    e.target.value === '' ? undefined : e.target.value,
                  )
                }
                title='Label position'
              >
                <option value=''>↳ default</option>
                {LABEL_POSITIONS.map((pos) => (
                  <option key={pos} value={pos}>
                    {LABEL_POSITION_LABELS[pos]}
                  </option>
                ))}
              </select>
              <button
                type='button'
                className='graph-style-panel__reset'
                onClick={() => handleReset(group)}
                disabled={!styleRules[group]}
                title='Reset to default'
              >
                ↺
              </button>
            </div>
          )
        })
      )}
    </div>
  )
}
