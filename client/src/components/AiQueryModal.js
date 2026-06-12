/*
 * SPDX-FileCopyrightText: © 2017-2026 Istari Digital, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react'
import Button from 'react-bootstrap/Button'
import Form from 'react-bootstrap/Form'
import Modal from 'react-bootstrap/Modal'

import { executeQuery } from 'lib/helpers'
import {
  generateDql,
  loadAiSettings,
  MODELS,
  saveAiSettings,
  schemaSummary,
} from 'lib/nl2dql'

// "Generate query with AI": natural language -> DQL, bring-your-own-key.
// The key is kept in localStorage and requests go straight from the
// browser to the model API.
export default function AiQueryModal({ show, onHide, onInsert }) {
  const [settings, setSettings] = React.useState(loadAiSettings)
  const [request, setRequest] = React.useState('')
  const [generated, setGenerated] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState(null)

  const updateSettings = (change) => {
    const next = { ...settings, ...change }
    setSettings(next)
    saveAiSettings(next)
  }

  const handleGenerate = async () => {
    setBusy(true)
    setError(null)
    setGenerated('')
    try {
      let schemaText = ''
      try {
        const schemaResponse = await executeQuery('schema {}', {
          action: 'query',
        })
        schemaText = schemaSummary(schemaResponse)
      } catch (e) {
        // Schema is optional context; generate without it.
      }

      const dql = await generateDql({
        apiKey: settings.apiKey,
        model: settings.model,
        schemaText,
        request,
      })
      setGenerated(dql)
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const handleInsert = () => {
    onInsert(generated)
    onHide()
  }

  return (
    <Modal show={show} onHide={onHide} size='lg'>
      <Modal.Header closeButton>
        <Modal.Title>Generate query with AI</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <Form.Group>
          <Form.Label>Anthropic API key</Form.Label>
          <Form.Control
            type='password'
            placeholder='sk-ant-...'
            value={settings.apiKey}
            onChange={(e) => updateSettings({ apiKey: e.target.value })}
          />
          <Form.Text className='text-muted'>
            Stored only in this browser. Requests go directly to the model
            API; your data never passes through the Ratel server.
          </Form.Text>
        </Form.Group>

        <Form.Group>
          <Form.Label>Model</Form.Label>
          <Form.Control
            as='select'
            value={settings.model}
            onChange={(e) => updateSettings({ model: e.target.value })}
          >
            {MODELS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Form.Control>
        </Form.Group>

        <Form.Group>
          <Form.Label>Describe the query you want</Form.Label>
          <Form.Control
            as='textarea'
            rows={3}
            placeholder='e.g. the 10 most recently added people and their friends'
            value={request}
            onChange={(e) => setRequest(e.target.value)}
            disabled={busy}
          />
          <Form.Text className='text-muted'>
            The current schema is sent along as context.
          </Form.Text>
        </Form.Group>

        {error && <div className='alert alert-danger'>{error}</div>}

        {generated && (
          <Form.Group>
            <Form.Label>Generated DQL</Form.Label>
            <Form.Control
              as='textarea'
              rows={8}
              value={generated}
              onChange={(e) => setGenerated(e.target.value)}
              style={{ fontFamily: 'monospace', fontSize: 13 }}
            />
          </Form.Group>
        )}
      </Modal.Body>
      <Modal.Footer>
        <Button variant='secondary' onClick={onHide}>
          Cancel
        </Button>
        <Button
          variant='primary'
          onClick={handleGenerate}
          disabled={busy || !request.trim() || !settings.apiKey}
        >
          {busy ? 'Generating…' : 'Generate'}
        </Button>
        <Button variant='success' onClick={handleInsert} disabled={!generated}>
          Insert into editor
        </Button>
      </Modal.Footer>
    </Modal>
  )
}
