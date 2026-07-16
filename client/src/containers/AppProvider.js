/*
 * SPDX-FileCopyrightText: © 2017-2026 Istari Digital, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import produce from 'immer'
import React from 'react'
import { Provider } from 'react-redux'
import { applyMiddleware, compose, createStore } from 'redux'
import { createTransform, persistStore } from 'redux-persist'
import localStorage from 'redux-persist/lib/storage'
import ReduxThunk from 'redux-thunk'

import { loginUser, updateUrl } from 'actions/connection'
import { setResultsTab } from 'actions/frames'
import {
  migrateToHaveZeroUrl,
  migrateToServerConnection,
} from 'actions/migration'
import { updateAction, updateQuery } from 'actions/query'
import { getAddrParam, getQueryParam } from 'lib/helpers'
import makeRootReducer from 'reducers'

import {
  setCurrentServerQueryTimeout,
  setCurrentServerSlashApiKey,
  setCurrentServerUrl,
} from 'lib/helpers'

import 'bootstrap/dist/css/bootstrap.css'

const eraseApiKeys = createTransform(
  (state) =>
    produce(state, (draft) => {
      draft.serverHistory.forEach((rec) => {
        delete rec.slashApiKey
      })
    }),
  undefined,
  { whitelist: ['connection'] },
)

const config = {
  key: 'root',
  storage: localStorage,
  whitelist: ['backup', 'frames', 'connection', 'query', 'ui'],
  transforms: [eraseApiKeys],
}
const composeEnhancers = window.__REDUX_DEVTOOLS_EXTENSION_COMPOSE__ || compose
const store = createStore(
  makeRootReducer(config),
  undefined,
  composeEnhancers(applyMiddleware(ReduxThunk)),
)

store.subscribe(() => {
  const state = store.getState()
  if (!state.connection?.serverHistory) {
    console.warning(
      'Redux State is not ready. Waiting for connection.serverHistory',
    )
    return
  }
  setCurrentServerUrl(state.connection.serverHistory[0].url)
  setCurrentServerQueryTimeout(
    state.connection.serverHistory[0].queryTimeout || 20,
  )
  setCurrentServerSlashApiKey(state.connection.serverHistory[0].slashApiKey)
})

// Asks before letting a URL point this Ratel at a different Dgraph cluster.
// Staying silent is not an option here: the recipient would have no way to
// tell that the link they opened had swapped their server out from under them.
function confirmServerChange(addr) {
  const currentUrl = store.getState()?.connection?.serverHistory?.[0]?.url
  if (currentUrl === addr) {
    // Nothing would change -- e.g. a bookmark to the cluster already in use.
    return true
  }
  return window.confirm(
    `This link wants to point Ratel at a different Dgraph cluster:\n\n` +
      `${addr}\n\n` +
      `Queries you run, and any credentials you enter, would go to that ` +
      `server. Only continue if you trust whoever sent you this link.\n\n` +
      `Switch to this cluster?`,
  )
}

export default class AppProvider extends React.Component {
  state = {
    rehydrated: false,
    // ready is a boolean denoting if the app is ready to render.
    ready: false,
  }

  componentDidMount() {
    // Begin periodically persisting the store.
    persistStore(store, null, () => {
      this.setState({ rehydrated: true }, this.onRehydrated)
    })
  }

  onRehydrated = () => {
    const state = store.getState()

    store.dispatch(
      migrateToServerConnection({
        mainUrl: store.url?.url,
        urlHistory: store.url?.urlHistory,
      }),
    )
    store.dispatch(migrateToHaveZeroUrl())

    // A link can repoint Ratel at a cluster of the sender's choosing, which
    // is an exfiltration primitive: whatever the recipient types next goes to
    // that server. Require an explicit opt-in rather than a checkbox on the
    // sender's side. (getAddrParam covers both ?addr= and #addr=.)
    const addrParam = getAddrParam()
    if (addrParam && confirmServerChange(addrParam)) {
      store.dispatch(updateUrl(addrParam))
    }

    // Shared frames LOAD, they never RUN. The query arrives from a URL, so it
    // is attacker-controlled; auto-running it would execute a stranger's DQL
    // against the recipient's cluster under the recipient's own credentials.
    // updateAction('query') must stay ahead of updateQuery: the reducer resets
    // draft.query from allQueries on UPDATE_ACTION. It also pins the editor to
    // 'query', so a shared mutation cannot arrive pre-armed to mutate.
    const sharedQuery = getQueryParam()
    if (sharedQuery) {
      store.dispatch(updateAction('query'))
      store.dispatch(updateQuery(sharedQuery))
    }
    // Remove noise from the address bar
    window.location.hash = ''

    if (state?.connection?.serverHistory[0].refreshToken) {
      // Send stored refreshToken to the dgraph-js client lib.
      store.dispatch(
        loginUser(
          undefined,
          undefined,
          undefined,
          state.connection.serverHistory[0].refreshToken,
        ),
      )
    }

    if (state?.frames) {
      // HACK: setResultsTab will validate the tab name.
      store.dispatch(setResultsTab(state.frames.tab))
    }

    this.setState({ ready: true })
  }

  render() {
    const Component = this.props.component
    const { rehydrated, ready } = this.state

    if (!rehydrated || !ready) {
      return <div>Loading...</div>
    }

    return (
      <Provider store={store}>
        <Component />
      </Provider>
    )
  }
}
