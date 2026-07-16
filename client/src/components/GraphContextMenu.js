/*
 * SPDX-FileCopyrightText: © 2017-2026 Istari Digital, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react'

// The canvas had exactly two verbs before this: click to inspect, double-click
// to expand everything. Every other affordance was missing for want of a place
// to put it. This is that place.
//
// Deliberately NOT here: anything destructive. "Hide" sits one keystroke away
// from "Delete" in a list like this, and a mis-click on Hide costs a click to
// undo while a mis-click on Delete costs data. Destructive verbs stay out of
// the menu entirely; that ordering is the mitigation, not a nicety.
export default function GraphContextMenu({
  x,
  y,
  count,
  onExpand,
  onHide,
  onHideOthers,
  onCopy,
  onClose,
}) {
  const ref = React.useRef(null)

  React.useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }
    // A click anywhere else dismisses, matching every other context menu the
    // user has ever used. Capture phase so it fires before the click lands on
    // whatever is underneath.
    const onDocClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) {
        onClose()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('mousedown', onDocClick, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('mousedown', onDocClick, true)
    }
  }, [onClose])

  const items = [
    { label: 'Expand…', onClick: onExpand },
    { label: 'Hide', onClick: onHide },
    { label: 'Hide others', onClick: onHideOthers },
    { label: 'Copy value', onClick: onCopy },
  ]

  return (
    <div
      className='graph-context-menu'
      ref={ref}
      style={{ left: x, top: y }}
      role='menu'
    >
      <div className='graph-context-menu-header'>
        {count} node{count === 1 ? '' : 's'} selected
      </div>
      {items.map((item) => (
        <button
          className='graph-context-menu-item'
          key={item.label}
          onClick={item.onClick}
          role='menuitem'
          type='button'
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}
