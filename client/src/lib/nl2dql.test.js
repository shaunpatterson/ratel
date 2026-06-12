/*
 * SPDX-FileCopyrightText: © 2017-2026 Istari Digital, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  buildPrompt,
  DEFAULT_MODEL,
  extractDql,
  generateDql,
  loadAiSettings,
  saveAiSettings,
  schemaSummary,
} from './nl2dql'

const memoryStorage = () => {
  const data = {}
  return {
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => (data[k] = String(v)),
  }
}

describe('settings', () => {
  it('round-trips and defaults the model', () => {
    const storage = memoryStorage()
    saveAiSettings({ apiKey: 'sk-test' }, storage)
    expect(loadAiSettings(storage)).toEqual({
      apiKey: 'sk-test',
      model: DEFAULT_MODEL,
    })
  })

  it('rejects unknown models and corrupt storage', () => {
    const storage = memoryStorage()
    storage.setItem('ratel-ai-settings', '{"model":"gpt-99","apiKey":1}')
    expect(loadAiSettings(storage)).toEqual({ apiKey: '', model: DEFAULT_MODEL })
    storage.setItem('ratel-ai-settings', 'not json')
    expect(loadAiSettings(storage)).toEqual({ apiKey: '', model: DEFAULT_MODEL })
  })
})

describe('schemaSummary', () => {
  it('renders predicates with index/list/reverse and types', () => {
    const summary = schemaSummary({
      data: {
        schema: [
          {
            predicate: 'name',
            type: 'string',
            index: true,
            tokenizer: ['term', 'exact'],
          },
          { predicate: 'friend', type: 'uid', list: true, reverse: true },
          { predicate: 'dgraph.type', type: 'string' },
        ],
        types: [
          { name: 'Person', fields: [{ name: 'name' }, { name: 'friend' }] },
          { name: 'dgraph.graphql', fields: [] },
        ],
      },
    })
    expect(summary).toContain('name: string @index(term, exact)')
    expect(summary).toContain('friend: uid @list @reverse')
    expect(summary).toContain('type Person { name, friend }')
    expect(summary).not.toContain('dgraph.')
  })

  it('handles empty responses', () => {
    expect(schemaSummary(null)).toBe('')
    expect(schemaSummary({ data: {} })).toBe('')
  })
})

describe('buildPrompt', () => {
  it('includes schema and request', () => {
    const { system, user } = buildPrompt('name: string', 'find all people')
    expect(system).toContain('DQL')
    expect(user).toContain('name: string')
    expect(user).toContain('Request: find all people')
  })

  it('notes missing schema', () => {
    expect(buildPrompt('', 'x').user).toContain('(schema unavailable)')
  })
})

describe('extractDql', () => {
  it('prefers fenced blocks', () => {
    expect(extractDql('Here:\n```dql\n{ q(func: has(name)) { uid } }\n```')).toBe(
      '{ q(func: has(name)) { uid } }',
    )
    expect(extractDql('```\n{ x }\n```')).toBe('{ x }')
  })

  it('falls back to raw text', () => {
    expect(extractDql('  { q { uid } }  ')).toBe('{ q { uid } }')
    expect(extractDql('')).toBe('')
  })
})

describe('generateDql', () => {
  const okResponse = (text) => ({
    ok: true,
    json: async () => ({ content: [{ type: 'text', text }] }),
  })

  it('calls the API with key, model and prompt; returns extracted DQL', async () => {
    const fetchFn = jest.fn(async () =>
      okResponse('```dql\n{ q(func: type(Person)) { uid name } }\n```'),
    )
    const dql = await generateDql({
      apiKey: 'sk-test',
      model: 'claude-sonnet-4-6',
      schemaText: 'name: string',
      request: 'all people',
      fetchFn,
    })

    expect(dql).toBe('{ q(func: type(Person)) { uid name } }')
    const [url, opts] = fetchFn.mock.calls[0]
    expect(url).toContain('api.anthropic.com')
    expect(opts.headers['x-api-key']).toBe('sk-test')
    expect(opts.headers['anthropic-dangerous-direct-browser-access']).toBe(
      'true',
    )
    const body = JSON.parse(opts.body)
    expect(body.model).toBe('claude-sonnet-4-6')
    expect(body.messages[0].content).toContain('all people')
    expect(body.system).toContain('DQL')
  })

  it('requires an API key', async () => {
    await expect(generateDql({ apiKey: '', request: 'x' })).rejects.toThrow(
      'API key',
    )
  })

  it('surfaces API error messages', async () => {
    const fetchFn = jest.fn(async () => ({
      ok: false,
      status: 401,
      json: async () => ({ error: { message: 'invalid x-api-key' } }),
    }))
    await expect(
      generateDql({ apiKey: 'bad', request: 'x', fetchFn }),
    ).rejects.toThrow('invalid x-api-key')
  })

  it('throws when the model returns no query', async () => {
    const fetchFn = jest.fn(async () => okResponse(''))
    await expect(
      generateDql({ apiKey: 'sk', request: 'x', fetchFn }),
    ).rejects.toThrow('no query')
  })
})
