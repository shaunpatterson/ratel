/*
 * SPDX-FileCopyrightText: © 2017-2026 Istari Digital, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import { DQL_KEYWORDS, dqlMode } from './dqlMode'

// Minimal stand-in for CodeMirror's StringStream, implementing only the
// methods used by the dqlMode tokenizer.
class MockStream {
  constructor(string) {
    this.string = string
    this.start = 0
    this.pos = 0
  }
  eatSpace() {
    const start = this.pos
    while (/[\s ]/.test(this.string.charAt(this.pos))) {
      this.pos++
    }
    return this.pos > start
  }
  match(pattern) {
    const rest = this.string.slice(this.pos)
    const found = rest.match(pattern)
    if (found && found.index === 0) {
      this.pos += found[0].length
      return found
    }
    return null
  }
  skipToEnd() {
    this.pos = this.string.length
  }
  next() {
    if (this.pos < this.string.length) {
      return this.string.charAt(this.pos++)
    }
  }
  current() {
    return this.string.slice(this.start, this.pos)
  }
}

// Tokenizes a single line, returning [text, style] pairs.
function tokenize(line) {
  const stream = new MockStream(line)
  const state = dqlMode.startState()
  const tokens = []
  while (stream.pos < line.length) {
    stream.start = stream.pos
    const style = dqlMode.token(stream, state)
    if (stream.pos === stream.start) {
      throw new Error(`Tokenizer did not advance at position ${stream.pos}`)
    }
    tokens.push([stream.current(), style])
  }
  return tokens
}

const stylesOf = (line) =>
  Object.fromEntries(tokenize(line).map(([text, style]) => [text, style]))

describe('dqlMode tokenizer', () => {
  it('highlights comments to the end of the line', () => {
    expect(tokenize('# fetch all people')).toEqual([
      ['# fetch all people', 'comment'],
    ])
  })

  it('highlights strings, including escaped quotes', () => {
    expect(stylesOf('eq(name, "Alice \\"A\\"")')['"Alice \\"A\\""']).toBe(
      'string',
    )
  })

  it('highlights numbers', () => {
    expect(stylesOf('first: 10')['10']).toBe('number')
    expect(stylesOf('lat: -33.8688')['-33.8688']).toBe('number')
  })

  it('highlights directives', () => {
    expect(stylesOf('name @filter(has(age))')['@filter']).toBe('meta')
  })

  it('highlights GraphQL variables', () => {
    expect(stylesOf('eq(name, $name)')['$name']).toBe('variable-2')
  })

  it('highlights angle-bracketed predicates', () => {
    expect(stylesOf('{ <dgraph.type> }')['<dgraph.type>']).toBe('atom')
  })

  it('highlights DQL keywords but not plain predicates', () => {
    const styles = stylesOf('q(func: has(name))')
    expect(styles.func).toBe('keyword')
    expect(styles.has).toBe('keyword')
    expect(styles.name).toBe('variable')
    expect(styles.q).toBe('variable')
  })

  it('highlights brackets and operators', () => {
    const styles = stylesOf('{ uid <= 5 }')
    expect(styles['{']).toBe('bracket')
    expect(styles['}']).toBe('bracket')
    expect(styles['<=']).toBe('operator')
  })

  it('treats whitespace as plain text', () => {
    expect(tokenize('  {')).toEqual([
      ['  ', null],
      ['{', 'bracket'],
    ])
  })

  it('never stalls on unexpected characters', () => {
    expect(() => tokenize('!?;,%^&')).not.toThrow()
  })

  it('exposes common DQL functions as keywords', () => {
    for (const kw of ['func', 'has', 'uid', 'eq', 'allofterms', 'regexp']) {
      expect(DQL_KEYWORDS.has(kw)).toBe(true)
    }
  })
})
