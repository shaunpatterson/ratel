/*
 * SPDX-FileCopyrightText: © 2017-2026 Istari Digital, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

// Natural language -> DQL generation. Bring-your-own-key: the key is
// stored in localStorage only and requests go directly from the browser
// to the model API; nothing passes through the Ratel server.

const SETTINGS_KEY = 'ratel-ai-settings'

export const DEFAULT_MODEL = 'claude-haiku-4-5-20251001'
export const MODELS = [
  ['claude-haiku-4-5-20251001', 'Claude Haiku 4.5 (fast)'],
  ['claude-sonnet-4-6', 'Claude Sonnet 4.6 (capable)'],
]

export function loadAiSettings(storage = window.localStorage) {
  try {
    const parsed = JSON.parse(storage.getItem(SETTINGS_KEY)) || {}
    return {
      apiKey: typeof parsed.apiKey === 'string' ? parsed.apiKey : '',
      model: MODELS.some(([m]) => m === parsed.model)
        ? parsed.model
        : DEFAULT_MODEL,
    }
  } catch (e) {
    return { apiKey: '', model: DEFAULT_MODEL }
  }
}

export function saveAiSettings(settings, storage = window.localStorage) {
  try {
    storage.setItem(
      SETTINGS_KEY,
      JSON.stringify({
        apiKey: settings.apiKey || '',
        model: settings.model || DEFAULT_MODEL,
      }),
    )
  } catch (e) {
    // Ignore - the user just re-enters the key next time.
  }
}

// Compact, prompt-friendly rendering of a `schema {}` response.
export function schemaSummary(schemaResponse) {
  const data = (schemaResponse && schemaResponse.data) || schemaResponse || {}
  const lines = []

  ;(data.schema || []).forEach((p) => {
    if (p.predicate && p.predicate.startsWith('dgraph.')) {
      return
    }
    const parts = [`${p.predicate}: ${p.type}`]
    if (p.list) {
      parts.push('@list')
    }
    if (p.index && p.tokenizer) {
      parts.push(`@index(${p.tokenizer.join(', ')})`)
    }
    if (p.reverse) {
      parts.push('@reverse')
    }
    lines.push(parts.join(' '))
  })
  ;(data.types || []).forEach((t) => {
    if (t.name && t.name.startsWith('dgraph.')) {
      return
    }
    const fields = (t.fields || []).map((f) => f.name).join(', ')
    lines.push(`type ${t.name} { ${fields} }`)
  })

  return lines.join('\n')
}

export function buildPrompt(schemaText, request) {
  const system = [
    'You translate natural language into Dgraph DQL (GraphQL+-) queries.',
    'Reply with a single DQL query in a ```dql code block and nothing else.',
    'Rules:',
    '- Use only predicates and types that exist in the provided schema.',
    '- Prefer func: type(...) or indexed predicates for the root function.',
    '- Include uid and a human-readable name predicate in results when available.',
    '- Use pagination (first: 100) unless the user asks otherwise.',
  ].join('\n')

  const user = [
    'Schema:',
    '```',
    schemaText || '(schema unavailable)',
    '```',
    '',
    'Request: ' + request,
  ].join('\n')

  return { system, user }
}

// Pulls the DQL out of a model response: prefers fenced code blocks,
// falls back to the raw text.
export function extractDql(text) {
  if (!text) {
    return ''
  }
  const fence = text.match(/```(?:dql|graphql)?\s*\n([\s\S]*?)```/)
  if (fence) {
    return fence[1].trim()
  }
  return text.trim()
}

export async function generateDql({
  apiKey,
  model,
  schemaText,
  request,
  fetchFn = fetch,
}) {
  if (!apiKey) {
    throw new Error('API key is required')
  }
  const { system, user } = buildPrompt(schemaText, request)

  const res = await fetchFn('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      // Explicit opt-in to browser-side calls; the key is the user's own.
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: model || DEFAULT_MODEL,
      max_tokens: 1024,
      system,
      messages: [{ role: 'user', content: user }],
    }),
  })

  if (!res.ok) {
    let detail = `${res.status}`
    try {
      const body = await res.json()
      detail = body.error?.message || detail
    } catch (e) {
      // Keep the status code.
    }
    throw new Error(`Model request failed: ${detail}`)
  }

  const body = await res.json()
  const text = (body.content || [])
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n')

  const dql = extractDql(text)
  if (!dql) {
    throw new Error('The model returned no query')
  }
  return dql
}
