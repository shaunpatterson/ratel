/*
 * SPDX-FileCopyrightText: © 2017-2026 Istari Digital, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react'
import Button from 'react-bootstrap/Button'
import Table from 'react-bootstrap/Table'
import { useDispatch } from 'react-redux'

import { openQueryInNewTab } from 'actions/drill'
import { buildFilterQuery } from 'lib/drillQuery'
import { useDrillSchema } from 'lib/drillSchema'
import { executeQuery } from 'lib/helpers'
import {
  buildDeleteMutation,
  buildSetMutation,
  coerceValue,
  isSafePredicate,
} from 'lib/mutations'

import '../assets/css/NodeProperties.scss'

const isEditable = (value) =>
  ['string', 'number', 'boolean'].includes(typeof value)

export default function NodeProperties({ node, onCollapseNode, onExpandNode }) {
  const dispatch = useDispatch()
  const drillSchema = useDrillSchema()
  const [editingKey, setEditingKey] = React.useState(null)
  const [draft, setDraft] = React.useState('')
  const [confirmingDelete, setConfirmingDelete] = React.useState(null)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState(null)
  const [savedAt, setSavedAt] = React.useState(null)
  // Local bump to re-render after we mutate the (shared) node object.
  const [, setVersion] = React.useState(0)

  const [adding, setAdding] = React.useState(false)
  const [newPred, setNewPred] = React.useState('')
  const [newValue, setNewValue] = React.useState('')

  React.useEffect(() => {
    // Selected node changed - drop any in-progress edit state.
    setEditingKey(null)
    setConfirmingDelete(null)
    setError(null)
    setAdding(false)
  }, [node])

  if (!node) {
    return null
  }

  const { attrs, facets } = node.properties

  const runMutation = async (mutation, applyLocally) => {
    setBusy(true)
    setError(null)
    try {
      await executeQuery(mutation, { action: 'mutate' })
      applyLocally()
      setSavedAt(Date.now())
      setEditingKey(null)
      setConfirmingDelete(null)
      setAdding(false)
      setVersion((v) => v + 1)
    } catch (e) {
      setError(e?.errors?.[0]?.message || e?.message || 'Mutation failed')
    } finally {
      setBusy(false)
    }
  }

  const handleSave = (key) => {
    let value
    try {
      value = coerceValue(draft, attrs[key])
    } catch (e) {
      setError(e.message)
      return
    }
    runMutation(buildSetMutation(node.uid, key, value), () => {
      attrs[key] = value
    })
  }

  const handleDelete = (key) => {
    runMutation(buildDeleteMutation(node.uid, key, attrs[key]), () => {
      delete attrs[key]
    })
  }

  const handleAdd = () => {
    const pred = newPred.trim()
    if (!isSafePredicate(pred)) {
      setError(`"${pred}" is not a valid predicate name`)
      return
    }
    runMutation(buildSetMutation(node.uid, pred, newValue), () => {
      attrs[pred] = newValue
      setNewPred('')
      setNewValue('')
    })
  }

  // The drill is offered against the SOURCE PREDICATE. In this panel the key is
  // the predicate — the graph parser keyed these attrs off the response's own
  // predicate names — which is why NodeProperties is a safe surface for it and
  // an arbitrary rendered JSON key is not.
  const renderDrillButton = (key, value) => {
    // uid is on every node and is never drillable; a permanently-greyed button
    // on every row is noise, so omit it rather than explain it every time.
    if (!isEditable(value) || key === 'uid') {
      return null
    }
    const result = buildFilterQuery({
      predicate: key,
      value,
      schema: drillSchema,
    })

    // A predicate with no usable tokenizer gets a disabled button carrying the
    // reason, not a hidden one: silently omitting it teaches the user nothing,
    // and emitting a query anyway would surface as "Predicate X is not indexed"
    // from the cluster — a button that lied.
    if (!result.ok) {
      // aria-disabled rather than the disabled attribute: browsers suppress
      // title tooltips on disabled controls, and the reason IS the feature here
      // — a refusal the user can't read is just a dead button.
      return (
        <button
          type='button'
          className='row-action row-action--muted'
          title={result.reason}
          aria-disabled='true'
        >
          <i className='fas fa-search' />
        </button>
      )
    }

    return (
      <button
        type='button'
        className='row-action'
        title={`${result.label} — opens a new query tab`}
        disabled={busy}
        onClick={() => dispatch(openQueryInNewTab(result.query))}
      >
        <i className='fas fa-search' />
      </button>
    )
  }

  const renderValueCell = (key) => {
    const value = attrs[key]

    if (editingKey !== key) {
      return (
        <td className='value-cell'>
          <span className='value-text'>{JSON.stringify(value)}</span>
          {node.uid && isEditable(value) && (
            <span className='row-actions'>
              {renderDrillButton(key, value)}
              <button
                type='button'
                className='row-action'
                title={`Edit ${key}`}
                disabled={busy}
                onClick={() => {
                  setEditingKey(key)
                  setConfirmingDelete(null)
                  setDraft(String(value))
                  setError(null)
                }}
              >
                <i className='fas fa-pencil-alt' />
              </button>
              {confirmingDelete === key ? (
                <button
                  type='button'
                  className='row-action row-action--danger'
                  title={`Really delete ${key}?`}
                  disabled={busy}
                  onClick={() => handleDelete(key)}
                >
                  sure?
                </button>
              ) : (
                <button
                  type='button'
                  className='row-action'
                  title={`Delete ${key}`}
                  disabled={busy}
                  onClick={() => setConfirmingDelete(key)}
                >
                  <i className='fas fa-trash-alt' />
                </button>
              )}
            </span>
          )}
        </td>
      )
    }

    return (
      <td className='value-cell'>
        {typeof value === 'boolean' ? (
          <select
            value={draft}
            disabled={busy}
            onChange={(e) => setDraft(e.target.value)}
          >
            <option value='true'>true</option>
            <option value='false'>false</option>
          </select>
        ) : (
          <input
            type={typeof value === 'number' ? 'number' : 'text'}
            value={draft}
            disabled={busy}
            autoFocus
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                handleSave(key)
              }
              if (e.key === 'Escape') {
                setEditingKey(null)
              }
            }}
          />
        )}
        <span className='row-actions'>
          <button
            type='button'
            className='row-action'
            title='Save'
            disabled={busy}
            onClick={() => handleSave(key)}
          >
            <i className='fas fa-check' />
          </button>
          <button
            type='button'
            className='row-action'
            title='Cancel'
            disabled={busy}
            onClick={() => setEditingKey(null)}
          >
            <i className='fas fa-times' />
          </button>
        </span>
      </td>
    )
  }

  return (
    <div className='node-properties'>
      <label>uid: {node.uid}</label>
      <div
        className='btn-toolbar mb-2'
        role='toolbar'
        aria-label='Node Options'
      >
        <Button
          className='mr-2'
          variant='info'
          size='sm'
          onClick={() =>
            !node.expanded ? onExpandNode(node.uid) : onCollapseNode(node.uid)
          }
        >
          {!node.expanded ? 'Expand' : 'Collapse'}
        </Button>
      </div>

      {error && <div className='alert alert-danger px-2 py-1'>{error}</div>}

      <Table striped bordered size='sm' hover>
        <thead>
          <tr>
            <th>pred.</th>
            <th>value</th>
          </tr>
        </thead>
        <tbody>
          {attrs
            ? Object.keys(attrs).map((k) => (
                <tr key={k}>
                  <td>{k}</td>
                  {renderValueCell(k)}
                </tr>
              ))
            : null}
          {adding && (
            <tr>
              <td>
                <input
                  type='text'
                  placeholder='predicate'
                  value={newPred}
                  disabled={busy}
                  autoFocus
                  onChange={(e) => setNewPred(e.target.value)}
                />
              </td>
              <td className='value-cell'>
                <input
                  type='text'
                  placeholder='value'
                  value={newValue}
                  disabled={busy}
                  onChange={(e) => setNewValue(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
                />
                <span className='row-actions'>
                  <button
                    type='button'
                    className='row-action'
                    title='Save new value'
                    disabled={busy}
                    onClick={handleAdd}
                  >
                    <i className='fas fa-check' />
                  </button>
                  <button
                    type='button'
                    className='row-action'
                    title='Cancel'
                    disabled={busy}
                    onClick={() => setAdding(false)}
                  >
                    <i className='fas fa-times' />
                  </button>
                </span>
              </td>
            </tr>
          )}
        </tbody>
      </Table>

      {node.uid && !adding && (
        <Button
          variant='outline-secondary'
          size='sm'
          disabled={busy}
          onClick={() => {
            setAdding(true)
            setError(null)
          }}
        >
          + Add value
        </Button>
      )}
      {savedAt && Date.now() - savedAt < 4000 && (
        <span className='ml-2 text-success'>✓ saved</span>
      )}

      {facets && Object.keys(facets).length ? (
        <Table striped bordered size='sm' hover>
          <thead>
            <tr>
              <th>facet</th>
              <th>value</th>
            </tr>
          </thead>
          <tbody>
            {Object.keys(facets).map((k) => (
              <tr key={k}>
                <td>{k}</td>
                <td>{String(facets[k])}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      ) : null}
    </div>
  )
}
