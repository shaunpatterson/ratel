/*
 * SPDX-FileCopyrightText: © 2017-2026 Istari Digital, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

// AppProvider owns its redux store at module scope and bootstraps it with
// persistStore(), whose callback only ever fires once per store. Every test
// therefore builds AppProvider in a fresh module registry and renders it
// exactly once. Everything is pulled out of that same registry so React,
// react-redux and react-dom stay a single consistent copy.
//
// Only the action creators are stubbed; the real AppProvider is rendered, so
// these assertions exercise the true componentDidMount -> onRehydrated path
// rather than calling a helper directly.
jest.mock('actions/connection', () => {
  const actual = jest.requireActual('actions/connection')
  return {
    ...actual,
    updateUrl: jest.fn(() => async () => {}),
    loginUser: jest.fn(() => async () => {}),
    setSlashApiKey: jest.fn(actual.setSlashApiKey),
    setAuthToken: jest.fn(actual.setAuthToken),
  }
})

jest.mock('actions/frames', () => {
  const actual = jest.requireActual('actions/frames')
  return {
    ...actual,
    // runQuery is the sole executor on this path; stub it so a regression is
    // recorded as a call instead of firing a live request at a cluster.
    runQuery: jest.fn(() => () => {}),
  }
})

jest.mock('actions/query', () => {
  const actual = jest.requireActual('actions/query')
  return {
    ...actual,
    updateQuery: jest.fn(actual.updateQuery),
  }
})

const SHARED_QUERY = '{ me(func: uid(0x1)) { name dgraph.type } }'
const SHARED_MUTATION = '{ set { <0x1> <name> "pwned" . } }'

// Opens `url` the way a recipient would: boots a pristine app against it and
// waits for it to finish rehydrating. Returns the observed store state plus
// the action-creator spies from this test's registry.
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
      frames: require('actions/frames'),
      query: require('actions/query'),
    }
  })

  const { React, rtl, useSelector, AppProvider } = ctx
  const observed = {}

  function Probe() {
    observed.query = useSelector((s) => s.query.query)
    observed.action = useSelector((s) => s.query.action)
    observed.serverUrl = useSelector((s) => s.connection.serverHistory[0].url)
    return React.createElement('div', { 'data-testid': 'probe' })
  }

  rtl.render(React.createElement(AppProvider, { component: Probe }))
  await rtl.waitFor(() =>
    expect(rtl.screen.queryByTestId('probe')).not.toBeNull(),
  )

  return {
    observed,
    updateUrl: ctx.connection.updateUrl,
    setSlashApiKey: ctx.connection.setSlashApiKey,
    setAuthToken: ctx.connection.setAuthToken,
    runQuery: ctx.frames.runQuery,
    updateQuery: ctx.query.updateQuery,
    cleanup: rtl.cleanup,
  }
}

let lastCleanup = null

beforeEach(() => {
  jest.clearAllMocks()
  window.localStorage.clear()
  jest.spyOn(window, 'confirm').mockReturnValue(false)
})

afterEach(() => {
  if (lastCleanup) {
    lastCleanup()
    lastCleanup = null
  }
  jest.restoreAllMocks()
  window.history.replaceState({}, '', '/')
})

describe('opening a share link', () => {
  it('loads the query from the ?query= URL SharingSettings actually builds', async () => {
    // Byte-for-byte the URL SharingSettings produces today: a *search* param.
    const app = await openLink(
      `${window.location.origin}?query=${encodeURIComponent(SHARED_QUERY)}`,
    )
    lastCleanup = app.cleanup

    expect(app.updateQuery).toHaveBeenCalledWith(SHARED_QUERY)
    expect(app.observed.query).toBe(SHARED_QUERY)
  })

  it('still loads the query from a #query= fragment', async () => {
    const app = await openLink(
      `${window.location.origin}#query=${encodeURIComponent(SHARED_QUERY)}`,
    )
    lastCleanup = app.cleanup

    expect(app.updateQuery).toHaveBeenCalledWith(SHARED_QUERY)
    expect(app.observed.query).toBe(SHARED_QUERY)
  })

  it('loads a shared mutation into the editor but never executes it', async () => {
    // A share link is attacker-controlled input; executing it would run under
    // the recipient's existing credentials.
    const app = await openLink(
      `${window.location.origin}?query=${encodeURIComponent(SHARED_MUTATION)}`,
    )
    lastCleanup = app.cleanup

    expect(app.observed.query).toBe(SHARED_MUTATION)
    expect(app.runQuery).not.toHaveBeenCalled()
  })

  it('never arms the editor for mutation from a URL', async () => {
    const app = await openLink(
      `${window.location.origin}?query=${encodeURIComponent(
        SHARED_MUTATION,
      )}&action=mutate`,
    )
    lastCleanup = app.cleanup

    expect(app.observed.action).toBe('query')
  })
})

describe('addr in a share link', () => {
  const EVIL = 'https://evil.example.com:8080'

  it('leaves the server alone when the link carries no addr', async () => {
    const app = await openLink(
      `${window.location.origin}?query=${encodeURIComponent(SHARED_QUERY)}`,
    )
    lastCleanup = app.cleanup

    expect(app.updateUrl).not.toHaveBeenCalled()
    expect(window.confirm).not.toHaveBeenCalled()
  })

  it('does not repoint the cluster when the user declines the confirm', async () => {
    window.confirm.mockReturnValue(false)

    const app = await openLink(
      `${window.location.origin}?addr=${encodeURIComponent(EVIL)}`,
    )
    lastCleanup = app.cleanup

    expect(window.confirm).toHaveBeenCalled()
    expect(app.updateUrl).not.toHaveBeenCalled()
  })

  it('repoints the cluster only after the user accepts the confirm', async () => {
    window.confirm.mockReturnValue(true)

    const app = await openLink(
      `${window.location.origin}?addr=${encodeURIComponent(EVIL)}`,
    )
    lastCleanup = app.cleanup

    expect(window.confirm).toHaveBeenCalled()
    expect(app.updateUrl).toHaveBeenCalledWith(EVIL)
  })
})

describe('credentials in a share link', () => {
  it('ignores slashApiKey and authToken carried in the fragment', async () => {
    window.confirm.mockReturnValue(true)

    const app = await openLink(
      `${window.location.origin}#slashApiKey=SECRET&authToken=SECRET`,
    )
    lastCleanup = app.cleanup

    // Nothing in the app builds such a link; honouring it only lets a crafted
    // link plant an attacker's credentials in the recipient's store.
    expect(app.setSlashApiKey).not.toHaveBeenCalled()
    expect(app.setAuthToken).not.toHaveBeenCalled()
  })
})
