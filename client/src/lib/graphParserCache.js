/*
 * SPDX-FileCopyrightText: © 2017-2026 Istari Digital, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import SchemaGraphParser from 'lib/SchemaGraphParser'
import { GraphParser } from 'lib/graph'

// A GraphParser accumulates everything the user has explored in a frame: every
// expansion, every collapse. FrameSession unmounts whenever you switch result
// tabs or frames, so the parser cannot live in component state — it has to
// outlive the component or the exploration is lost on every tab click.
//
// This used to be a memoize-one, i.e. a cache of size ONE. Looking at a second
// graph frame evicted the first one's parser, and coming back silently rebuilt
// it from the original response with every expansion thrown away. Keyed by
// frame id instead, each frame keeps its own.
const parserCache = new Map()

// TODO: add support for custom name regex in UI
const NAME_REGEX = 'Name'

/**
 * Returns the GraphParser for a frame, building it on first use.
 *
 * The parser is rebuilt when the frame's response changes (a re-run produces a
 * new response object), since accumulated exploration belongs to the old result
 * and would be a lie against the new one.
 *
 * @param frameId - frame.id; the cache key, and the lifetime this parser is tied to
 * @param response - the frame's tabResult response, or a falsy value for an empty parser
 * @param isSchemaGraph - whether to parse as a schema graph
 */
export function getGraphParser(frameId, response, isSchemaGraph) {
  const cached = parserCache.get(frameId)
  if (
    cached &&
    cached.response === response &&
    cached.isSchemaGraph === isSchemaGraph
  ) {
    return cached.parser
  }

  const parser = isSchemaGraph ? new SchemaGraphParser() : new GraphParser()
  if (response) {
    parser.addResponseToQueue(response.data)
    parser.processQueue(NAME_REGEX)
  }

  parserCache.set(frameId, { response, isSchemaGraph, parser })
  return parser
}

/**
 * Drops a frame's parser. Called when the frame is discarded — without this the
 * cache would pin every parser (and its whole node/edge dataset) for the life of
 * the tab.
 */
export function releaseGraphParser(frameId) {
  parserCache.delete(frameId)
}
