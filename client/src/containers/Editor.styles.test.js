/*
 * SPDX-FileCopyrightText: © 2017-2026 Istari Digital, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'fs'
import path from 'path'

const SRC = path.resolve(__dirname, '..')

// Follows the import graph the bundler follows. A rule only reaches a browser if
// it lives in a stylesheet some module actually imports; a .scss file sitting in
// assets/css that nothing imports is not shipped, it is just a file. The hint
// styling was written into exactly such an orphan once, and every unit test
// stayed green because no test looks at CSS.
function scssImportedBy(modulePath) {
  const source = fs.readFileSync(modulePath, 'utf8')
  return [...source.matchAll(/^import\s+'([^']+\.scss)'/gm)].map((m) =>
    path.resolve(path.dirname(modulePath), m[1]),
  )
}

describe('Editor stylesheet wiring', () => {
  it('ships the DQL hint styling from a stylesheet Editor actually imports', () => {
    const sheets = scssImportedBy(path.join(SRC, 'containers/Editor.js'))
    expect(sheets.length).toBeGreaterThan(0)

    const css = sheets.map((f) => fs.readFileSync(f, 'utf8')).join('\n')

    // Without the flex rule the popup renders `titlestring · exact` -- the name
    // and its detail concatenated with no separator.
    expect(css).toMatch(/\.CodeMirror-hint\s*{/)
    expect(css).toMatch(/\.CodeMirror-hint-detail\s*{/)
  })

  it('does not leave the hint styling in an unimported stylesheet', () => {
    const imported = new Set(
      scssImportedBy(path.join(SRC, 'containers/Editor.js')),
    )
    const cssDir = path.join(SRC, 'assets/css')

    for (const file of fs.readdirSync(cssDir)) {
      if (!file.endsWith('.scss') || imported.has(path.join(cssDir, file))) {
        continue
      }
      const contents = fs.readFileSync(path.join(cssDir, file), 'utf8')
      expect(contents).not.toMatch(/\.CodeMirror-hint-detail/)
    }
  })
})
