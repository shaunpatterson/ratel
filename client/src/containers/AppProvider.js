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

import {
  loginUser,
  setAuthToken,
  setSlashApiKey,
  updateUrl,
} from 'actions/connection'
import { setResultsTab } from 'actions/frames'
import {
  migrateToHaveZeroUrl,
  migrateToServerConnection,
} from 'actions/migration'
import { updateAction, updateQuery } from 'actions/query'
import { getAddrParam, getHashParams, getQueryParam } from 'lib/helpers'
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
// True means the recipient was asked and agreed -- nothing else. Callers rely
// on that: it is what authorises the link's credentials to be applied.
function confirmServerChange(addr) {
  const currentUrl = store.getState()?.connection?.serverHistory?.[0]?.url
  if (currentUrl === addr) {
    // Nothing would change -- e.g. a bookmark to the cluster already in use.
    // Report no consent rather than fake one: there was no prompt, so a link
    // naming the server you are already on must not thereby earn the right to
    // rewrite its credentials. UPDATE_URL would no-op on this url anyway, and
    // Sidebar health-checks on mount regardless, so nothing else is skipped.
    return false
  }
  return window.confirm(
    `This link wants to point Ratel at a different Dgraph cluster:\n\n` +
      `${addr}\n\n` +
      `Queries you run, and any credentials you enter, would go to that ` +
      `server. Only continue if you trust whoever sent you this link.\n\n` +
      `Switch to this cluster?`,
  )
}

// Applies credentials a link carried in its fragment. Only ever call this for
// an addr the recipient has just accepted, and only after updateUrl has made
// it the active server: these fragments exist to serve an operator's bootstrap
// link -- "here is my cluster, and the token for it" -- and outside that pairing
// they are indefensible. X-Dgraph-AuthToken in particular has had no other way
// in since fac3dd1 dropped the Auth Token field from ServerConnectionModal, so
// refusing them outright would silently retire the feature.
//
// The addr gate is what makes this safe, and it is doing real work: the SET_*
// reducers assign to whichever server is ACTIVE and only consult the url they
// are handed to decide whether to set the outgoing header. Honouring an
// addr-less token would therefore plant it on the recipient's OWN cluster
// record. The url is re-read from the store rather than reused from the link so
// it matches the sanitized record, which is what that header check compares.
function applyLinkCredentials() {
  const activeUrl = store.getState()?.connection?.serverHistory?.[0]?.url
  if (!activeUrl) {
    return
  }
  const { slashApiKey, authToken } = getHashParams()
  if (slashApiKey) {
    store.dispatch(setSlashApiKey(activeUrl, slashApiKey))
  }
  if (authToken) {
    store.dispatch(setAuthToken(activeUrl, authToken))
  }
}

// Takes the link's payload back out of the address bar once it has been
// consumed. Clearing only the fragment is not enough: links in the wild carry
// ?query= in the search string, which survives, so a refresh silently replays
// the sender's query over whatever the recipient has typed since and discards
// their work. replaceState also keeps the payload out of the back button.
// Params this app never reads are not ours to drop, so they are preserved;
// the fragment only ever carries bootstrap params, so it goes whole.
function clearLinkParams() {
  const url = new URL(window.location.href)
  url.searchParams.delete('query')
  url.searchParams.delete('addr')
  url.hash = ''
  window.history.replaceState({}, '', url.toString())
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
      applyLinkCredentials()
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
    clearLinkParams()

    // Resume the session only with the ACTIVE server's own token. `state` was
    // read before the addr switch above, and loginUser resolves its target
    // from the live store -- so replaying that snapshot here would post the
    // recipient's credential for their OWN cluster to whichever cluster the
    // link just selected. Re-read instead: a server the recipient has never
    // used starts with refreshToken null, so no login fires at all.
    const activeServer = store.getState()?.connection?.serverHistory?.[0]
    if (activeServer?.refreshToken) {
      // Send stored refreshToken to the dgraph-js client lib.
      store.dispatch(
        loginUser(undefined, undefined, undefined, activeServer.refreshToken),
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
