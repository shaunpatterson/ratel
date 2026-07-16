/*
 * SPDX-FileCopyrightText: © 2017-2026 Istari Digital, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import { copyToClipboard } from './copyToClipboard'

// navigator.clipboard does not exist on a non-secure origin, and a plain
// http:// Dgraph/Ratel deployment is the ordinary case, not the exotic one.
// The old copy path was `if (navigator.clipboard) { ...writeText().catch(() =>
// {}) }` -- on http it did nothing at all, and when the promise rejected it
// swallowed that too. Either way the menu closed and the UI looked like it had
// worked.

const withClipboard = (writeText) => {
  Object.defineProperty(navigator, 'clipboard', {
    value: writeText ? { writeText } : undefined,
    configurable: true,
    writable: true,
  })
}

let execCommand

beforeEach(() => {
  execCommand = jest.fn(() => true)
  document.execCommand = execCommand
})

afterEach(() => {
  withClipboard(undefined)
})

test('uses the async clipboard API when it is available', async () => {
  const writeText = jest.fn(() => Promise.resolve())
  withClipboard(writeText)

  await copyToClipboard('alice')

  expect(writeText).toHaveBeenCalledWith('alice')
  expect(execCommand).not.toHaveBeenCalled()
})

test('falls back to execCommand when there is no clipboard API at all', async () => {
  // The http:// deployment. This is the case that silently did nothing.
  withClipboard(undefined)

  await copyToClipboard('alice')

  expect(execCommand).toHaveBeenCalledWith('copy')
})

test('falls back to execCommand when the clipboard API rejects', async () => {
  // Permission denied, or the document is not focused.
  withClipboard(jest.fn(() => Promise.reject(new Error('denied'))))

  await copyToClipboard('alice')

  expect(execCommand).toHaveBeenCalledWith('copy')
})

test('the fallback offers the real text to the clipboard', async () => {
  withClipboard(undefined)
  // Read what is actually in the document at the moment execCommand fires --
  // that selection is what the browser would copy.
  let copied = null
  document.execCommand = jest.fn(() => {
    const textarea = document.querySelector('textarea')
    copied = textarea && textarea.value
    return true
  })

  await copyToClipboard('alice\nbob')

  expect(copied).toBe('alice\nbob')
})

test('the fallback leaves no textarea behind in the DOM', async () => {
  withClipboard(undefined)

  await copyToClipboard('alice')

  expect(document.querySelectorAll('textarea')).toHaveLength(0)
})

test('rejects when nothing could copy, so the caller can say so', async () => {
  withClipboard(undefined)
  document.execCommand = jest.fn(() => false)

  // The whole point: reporting success while the clipboard still holds
  // whatever it held before is worse than reporting failure.
  await expect(copyToClipboard('alice')).rejects.toThrow(/copy/i)
})

test('rejects when execCommand throws outright', async () => {
  withClipboard(undefined)
  document.execCommand = jest.fn(() => {
    throw new Error('nope')
  })

  await expect(copyToClipboard('alice')).rejects.toThrow(/copy/i)
})
