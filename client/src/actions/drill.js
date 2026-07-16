/*
 * SPDX-FileCopyrightText: © 2017-2026 Istari Digital, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import { addTab, updateQueryAndAction } from './query'

// Opens a derived query for REVIEW, without running it.
//
// Deliberately not reusing App's handleExternalQuery: that helper runs the query
// immediately and overwrites the active tab. Both are wrong for a drill. A drill
// is a guess built from one clicked datum — the user must be able to read it,
// and correct it, before it hits the cluster. And silently replacing whatever
// they were editing would destroy unsaved work.
//
// ADD_TAB saves the active tab before loading the new one, so the previous
// query survives in its own tab; UPDATE_QUERY_AND_ACTION then writes into the
// new (now active) tab.
export const openQueryInNewTab = (query) => (dispatch) => {
  dispatch(addTab())
  dispatch(updateQueryAndAction(query, 'query'))
}
