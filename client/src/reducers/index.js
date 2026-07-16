/*
 * SPDX-FileCopyrightText: © 2017-2026 Istari Digital, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import { persistCombineReducers } from 'redux-persist'

import backup from './backup'
import cluster from './cluster'
import connection from './connection'
import frames from './frames'
import query from './query'
import savedQueries from './savedQueries'
import schema from './schema'
import ui from './ui'

export default function makeRootReducer(config) {
  return persistCombineReducers(config, {
    backup,
    cluster,
    connection,
    frames,
    savedQueries,
    query,
    schema,
    ui,
  })
}
