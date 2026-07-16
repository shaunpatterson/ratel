/*
 * SPDX-FileCopyrightText: © 2017-2026 Istari Digital, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react'

const BUDGETS = [100, 500, 1000, 5000]

const DIRECTIONS = [
  ['out', 'Outgoing'],
  ['in', 'Incoming'],
  ['both', 'Both'],
]

// Everything double-click used to do implicitly, made explicit and bounded.
//
// The budget is a GLOBAL cap on the nodes the response may carry, not a
// per-predicate `first:` -- see lib/expandQuery for why that distinction is
// the whole point.
//
// Cancel stays live WHILE pending. It used to be disabled during the run,
// reasoned as: dgraph-js-http@21.3.1 exposes no AbortSignal, so cancelling
// could only hide the spinner while the response kept coming. That reasoning
// covers a single request and misses the loop -- expanding a multi-selection is
// one sequential RPC per node, and the ones still queued have not been sent.
// Cancel stops those, which is the difference between one wasted request and N.
export default function GraphExpandDialog({
  count,
  pending,
  error,
  predicates,
  onCancel,
  onExpand,
}) {
  const [budget, setBudget] = React.useState(500)
  const [direction, setDirection] = React.useState('out')

  const submit = (e) => {
    e.preventDefault()
    onExpand({ budget, direction })
  }

  const noPredicates = !predicates || predicates.length === 0

  return (
    <div className='graph-expand-backdrop'>
      <form
        aria-label='Expand nodes'
        className='graph-expand-dialog'
        onSubmit={submit}
        role='dialog'
      >
        <h5>
          Expand {count} node{count === 1 ? '' : 's'}
        </h5>

        <label htmlFor='expand-budget'>Max nodes to fetch</label>
        <select
          disabled={pending}
          id='expand-budget'
          onChange={(e) => setBudget(Number(e.target.value))}
          value={budget}
        >
          {BUDGETS.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </select>

        <label htmlFor='expand-direction'>Direction</label>
        <select
          disabled={pending}
          id='expand-direction'
          onChange={(e) => setDirection(e.target.value)}
          value={direction}
        >
          {DIRECTIONS.map(([value, text]) => (
            <option key={value} value={value}>
              {text}
            </option>
          ))}
        </select>

        {direction !== 'out' && (
          <p className='graph-expand-hint'>
            Incoming edges need @reverse on the predicate. Without it Dgraph
            rejects the query, and the error is shown here.
          </p>
        )}

        {noPredicates && (
          <p className='graph-expand-hint'>
            No predicates are known for this graph yet, so there is nothing to
            bound an expansion against.
          </p>
        )}

        {error && (
          <p className='graph-expand-error' role='alert'>
            {error}
          </p>
        )}

        <div className='graph-expand-actions'>
          <button onClick={onCancel} type='button'>
            Cancel
          </button>
          <button disabled={pending || noPredicates} type='submit'>
            {pending ? 'Expanding…' : 'Expand'}
          </button>
        </div>
      </form>
    </div>
  )
}
