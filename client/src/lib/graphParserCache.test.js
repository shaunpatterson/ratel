/*
 * SPDX-FileCopyrightText: © 2017-2026 Istari Digital, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import { discardFrame } from 'actions/frames'
import { getGraphParser } from 'lib/graphParserCache'

const response = { data: { q: [{ uid: '0x1', name: 'Alice' }] } }

// The cache is keyed by frame id and nothing else prunes it, so the release has
// to hang off the real discard path — asserting it via the action creator the
// close button dispatches, rather than by calling releaseGraphParser directly.
test('discarding a frame releases its parser', () => {
  const parser = getGraphParser('frame-x', response, false)
  expect(getGraphParser('frame-x', response, false)).toBe(parser)

  discardFrame('frame-x')

  expect(getGraphParser('frame-x', response, false)).not.toBe(parser)
})

test('discardFrame still emits the DISCARD_FRAME action', () => {
  expect(discardFrame('frame-y')).toEqual({
    type: 'frames/DISCARD_FRAME',
    frameId: 'frame-y',
  })
})

test('parsers are kept apart per frame', () => {
  const a = getGraphParser('frame-a', response, false)
  const b = getGraphParser('frame-b', response, false)
  expect(a).not.toBe(b)
  expect(getGraphParser('frame-a', response, false)).toBe(a)
  expect(getGraphParser('frame-b', response, false)).toBe(b)
})
