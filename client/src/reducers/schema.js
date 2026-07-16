/*
 * SPDX-FileCopyrightText: © 2017-2026 Istari Digital, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import produce from 'immer'

import {
  DO_LOGOUT,
  LOGIN_ERROR,
  LOGIN_PENDING,
  LOGIN_SUCCESS,
  LOGIN_TIMEOUT,
  REMOVE_URL,
  SET_AUTH_TOKEN,
  SET_SLASH_API_KEY,
  SET_URL_AND_SLASH_API_KEY,
  UPDATE_URL,
} from 'actions/connection'
import {
  SCHEMA_FETCH_ERROR,
  SCHEMA_FETCH_PENDING,
  SCHEMA_FETCH_SUCCESS,
} from 'actions/schema'
import { FetchError, Fetching, OK } from 'lib/constants'

// `schema {}` is silently ACL-filtered: a guardian sees every predicate, a
// restricted user sees only what their groups permit, and both come back as
// HTTP 200 with no errors key. Nothing in the response says anything was
// withheld, so the response is only meaningful in the context of the session
// that asked for it.
//
// That makes (server URL + namespace) an unsound cache key. Log in as a
// restricted user right after a guardian on the same server and namespace and
// the key matches, so you would serve the guardian's predicates to someone who
// is not allowed to know they exist.
//
// This slice therefore holds ONE schema -- the current session's -- rather than
// a map keyed by anything. Every action that can change who we are talking to
// the cluster as bumps `generation`, which:
//
//   1. clears the held schema synchronously, inside the reducer, so it is gone
//      before React renders rather than after a refetch eventually lands; and
//   2. invalidates any request already on the wire, since a response carries
//      the generation it was issued under and is dropped if that no longer
//      matches.
//
// A single slot cannot leak across sessions the way a keyed cache can: there is
// no key to collide.
const SESSION_CHANGING_ACTIONS = [
  DO_LOGOUT,
  LOGIN_ERROR,
  LOGIN_PENDING,
  LOGIN_SUCCESS,
  LOGIN_TIMEOUT,
  REMOVE_URL,
  SET_AUTH_TOKEN,
  SET_SLASH_API_KEY,
  SET_URL_AND_SLASH_API_KEY,
  UPDATE_URL,
]

const defaultState = {
  // Opaque counter identifying the current auth session. Namespace is not
  // tracked separately because it is only ever settable by logging in, which
  // bumps this anyway.
  generation: 0,
  url: null,
  fetchState: null,
  predicates: [],
  types: [],
  error: null,
}

export const selectSchema = (state) => state.schema
export const selectSchemaPredicates = (state) => state.schema.predicates
export const selectSchemaTypes = (state) => state.schema.types
export const selectSchemaGeneration = (state) => state.schema.generation

export default (state = defaultState, action) =>
  produce(state, (draft) => {
    if (SESSION_CHANGING_ACTIONS.indexOf(action.type) >= 0) {
      draft.generation += 1
      draft.url = null
      draft.fetchState = null
      draft.predicates = []
      draft.types = []
      draft.error = null
      return
    }

    // A response issued under a session that has since ended is not ours to
    // trust; drop it rather than letting it repopulate the store.
    if (
      action.generation !== undefined &&
      action.generation !== draft.generation
    ) {
      return
    }

    switch (action.type) {
      case SCHEMA_FETCH_PENDING:
        draft.fetchState = Fetching
        draft.url = action.url
        draft.error = null
        break

      case SCHEMA_FETCH_SUCCESS:
        draft.fetchState = OK
        draft.url = action.url
        draft.predicates = action.predicates
        draft.types = action.types
        draft.error = null
        break

      case SCHEMA_FETCH_ERROR:
        draft.fetchState = FetchError
        draft.url = action.url
        draft.error = action.error
        break

      default:
        return
    }
  })
