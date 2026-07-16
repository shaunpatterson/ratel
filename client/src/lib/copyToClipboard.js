/*
 * SPDX-FileCopyrightText: © 2017-2026 Istari Digital, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Copy text to the clipboard on the origins Ratel actually gets deployed to.
 *
 * `navigator.clipboard` is undefined on every non-secure origin, and a plain
 * http:// Dgraph deployment is the ordinary case rather than the exotic one.
 * So the async API cannot be the only path: guarding on it and doing nothing
 * otherwise is a copy button that silently does nothing for a large share of
 * real users.
 *
 * execCommand('copy') is deprecated, and it is also the only thing that works
 * on http. It is the fallback rather than the primary because it needs a live
 * selection and steals focus for an instant.
 *
 * Rejects when the text did not make it to the clipboard. That matters: the
 * caller closes a menu on success, and reporting success while the clipboard
 * still holds whatever it held before is worse than reporting failure -- the
 * user pastes stale content and blames the paste.
 */
export async function copyToClipboard(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return
    } catch {
      // Permission denied, or the document is not focused. The legacy path
      // often still works, so fall through rather than give up here.
    }
  }

  if (!execCommandCopy(text)) {
    throw new Error('Could not copy to the clipboard.')
  }
}

// The textarea has to be in the document and selectable for execCommand to see
// it, so it is added, used, and removed within one synchronous block -- it can
// never be observed or left behind.
function execCommandCopy(text) {
  const textarea = document.createElement('textarea')
  textarea.value = text
  // Keep it out of sight and stop iOS zooming to it, without display:none,
  // which would make it unselectable and defeat the whole thing.
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.top = '-1000px'
  textarea.style.opacity = '0'

  document.body.appendChild(textarea)
  try {
    textarea.select()
    textarea.setSelectionRange(0, text.length)
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    document.body.removeChild(textarea)
  }
}
