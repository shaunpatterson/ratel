/*
 * SPDX-FileCopyrightText: © 2017-2026 Istari Digital, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

// Companion to AppProvider.test.js, split out because it needs the store to
// REALLY switch server. AppProvider.test.js stubs updateUrl to a no-op, which
// is fine for asserting "was the switch requested?" but structurally cannot
// see what happens AFTER the active server changes -- and that is exactly
// where the recipient's existing credentials are at risk.
//
// updateUrl here dispatches the genuine UPDATE_URL action, so the real
// reducer runs and serverHistory really is rewritten. Only its trailing
// fire-and-forget checkHealth() is dropped: that just probes the network for
// a version banner, and in jsdom its async continuations outlive the test and
// tear down on a null document.
//
// loginUser is stubbed so it records what bootstrap WOULD have sent, and to
// which cluster, rather than firing a real login at one.
jest.mock('actions/connection', () => {
  const actual = jest.requireActual('actions/connection')
  return {
    ...actual,
    updateUrl: jest.fn((url) => async (dispatch) => {
      dispatch({ type: actual.UPDATE_URL, url })
    }),
    loginUser: jest.fn(() => async () => {}),
  }
})

const HOME = 'https://home.example.com:8080'
const EVIL = 'https://evil.example.com:8080'
// An ACL refresh token for HOME. It is the recipient's credential for the
// recipient's own cluster; a link must never be able to relay it elsewhere.
const HOME_REFRESH_TOKEN = 'home-refresh-token-do-not-leak'

// Writes a redux-persist snapshot the way a returning user's browser would
// have one: already signed in to HOME, holding a refresh token for it.
function seedSignedInToHome() {
  window.localStorage.setItem(
    'persist:root',
    JSON.stringify({
      connection: JSON.stringify({
        serverHistory: [
          {
            url: HOME,
            refreshToken: HOME_REFRESH_TOKEN,
            queryTimeout: 20,
            slashApiKey: null,
          },
        ],
      }),
    }),
  )
}

async function openLink(url) {
  window.history.replaceState({}, '', url)

  let ctx
  jest.isolateModules(() => {
    ctx = {
      React: require('react'),
      rtl: require('@testing-library/react/pure'),
      useSelector: require('react-redux').useSelector,
      AppProvider: require('containers/AppProvider').default,
      connection: require('actions/connection'),
    }
  })

  const { React, rtl, useSelector, AppProvider } = ctx
  const observed = {}

  function Probe() {
    observed.serverUrl = useSelector((s) => s.connection.serverHistory[0].url)
    observed.refreshToken = useSelector(
      (s) => s.connection.serverHistory[0].refreshToken,
    )
    observed.authToken = useSelector(
      (s) => s.connection.serverHistory[0].authToken,
    )
    observed.homeAuthToken = useSelector(
      (s) => s.connection.serverHistory.find((r) => r.url === HOME)?.authToken,
    )
    return React.createElement('div', { 'data-testid': 'probe' })
  }

  rtl.render(React.createElement(AppProvider, { component: Probe }))
  await rtl.waitFor(() =>
    expect(rtl.screen.queryByTestId('probe')).not.toBeNull(),
  )

  return { observed, loginUser: ctx.connection.loginUser, cleanup: rtl.cleanup }
}

let lastCleanup = null

beforeEach(() => {
  jest.clearAllMocks()
  window.localStorage.clear()
})

afterEach(() => {
  if (lastCleanup) {
    lastCleanup()
    lastCleanup = null
  }
  jest.restoreAllMocks()
  window.history.replaceState({}, '', '/')
})

describe('credentials when a link repoints the cluster', () => {
  it('does not relay the previous cluster refresh token to the new cluster', async () => {
    jest.spyOn(window, 'confirm').mockReturnValue(true)
    seedSignedInToHome()

    const app = await openLink(
      `${window.location.origin}?addr=${encodeURIComponent(EVIL)}`,
    )
    lastCleanup = app.cleanup

    // The switch really happened -- this is the precondition that a stubbed
    // updateUrl would silently skip, making the assertion below vacuous.
    expect(app.observed.serverUrl).toBe(EVIL)
    expect(app.observed.refreshToken).toBeFalsy()

    // Bootstrap must not log in with HOME's token now that the active server
    // is EVIL: loginUser resolves its target from the CURRENT store, so any
    // call here posts the recipient's HOME credential to the attacker's host.
    const relayed = app.loginUser.mock.calls.filter((args) =>
      args.includes(HOME_REFRESH_TOKEN),
    )
    expect(relayed).toEqual([])
  })

  it('still resumes the session when the link does not repoint the cluster', async () => {
    seedSignedInToHome()

    const app = await openLink(`${window.location.origin}/`)
    lastCleanup = app.cleanup

    expect(app.observed.serverUrl).toBe(HOME)
    expect(app.loginUser).toHaveBeenCalledWith(
      undefined,
      undefined,
      undefined,
      HOME_REFRESH_TOKEN,
    )
  })
})

// An operator bootstrap link -- "here is my cluster, and the token for it" --
// is the only thing that ever produced these fragments. X-Dgraph-AuthToken has
// had no other way in since fac3dd1 removed the Auth Token field from
// ServerConnectionModal, so dropping the fragment silently retires the feature.
describe('a bootstrap token carried by a link', () => {
  const TOKEN = 'operator-supplied-auth-token'

  it('reaches the cluster the recipient accepted', async () => {
    jest.spyOn(window, 'confirm').mockReturnValue(true)
    seedSignedInToHome()

    const app = await openLink(
      `${window.location.origin}/#addr=${encodeURIComponent(
        EVIL,
      )}&authToken=${encodeURIComponent(TOKEN)}`,
    )
    lastCleanup = app.cleanup

    expect(app.observed.serverUrl).toBe(EVIL)
    expect(app.observed.authToken).toBe(TOKEN)
  })

  it('is discarded when the recipient declines the cluster', async () => {
    jest.spyOn(window, 'confirm').mockReturnValue(false)
    seedSignedInToHome()

    const app = await openLink(
      `${window.location.origin}/#addr=${encodeURIComponent(
        EVIL,
      )}&authToken=${encodeURIComponent(TOKEN)}`,
    )
    lastCleanup = app.cleanup

    expect(app.observed.serverUrl).toBe(HOME)
    expect(app.observed.authToken).toBeFalsy()
  })

  it('is discarded when the link names the cluster already in use', async () => {
    // No switch means no prompt, so there is no moment at which the recipient
    // agreed to anything. A link naming the cluster you are already on must not
    // be able to quietly rewrite the credentials on your own server record.
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(true)
    seedSignedInToHome()

    const app = await openLink(
      `${window.location.origin}/#addr=${encodeURIComponent(
        HOME,
      )}&authToken=${encodeURIComponent(TOKEN)}`,
    )
    lastCleanup = app.cleanup

    expect(confirmSpy).not.toHaveBeenCalled()
    expect(app.observed.serverUrl).toBe(HOME)
    expect(app.observed.authToken).toBeFalsy()
  })

  it('is discarded when the link names no cluster to attach it to', async () => {
    seedSignedInToHome()

    // SET_AUTH_TOKEN resolves the record by the url it is handed, so an
    // addr-less token currently lands on a throwaway object rather than on the
    // recipient's record. Pin that down: it is a no-op by accident, and the
    // accident stops holding as soon as the lookup gains a fallback.
    const app = await openLink(
      `${window.location.origin}/#authToken=${encodeURIComponent(TOKEN)}`,
    )
    lastCleanup = app.cleanup

    expect(app.observed.serverUrl).toBe(HOME)
    expect(app.observed.homeAuthToken).toBeFalsy()
  })
})
