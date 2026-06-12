/*
 * SPDX-FileCopyrightText: © 2017-2026 Istari Digital, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

// The empty string means "no environment label".
export const ENV_NONE = ''
export const ENV_DEVELOPMENT = 'development'
export const ENV_STAGING = 'staging'
export const ENV_PRODUCTION = 'production'

// All valid values for a connection's `environment` field.
export const ENVIRONMENTS = [
  ENV_NONE,
  ENV_DEVELOPMENT,
  ENV_STAGING,
  ENV_PRODUCTION,
]

export const ENV_COLORS = {
  [ENV_DEVELOPMENT]: '#28a745',
  [ENV_STAGING]: '#fd7e14',
  [ENV_PRODUCTION]: '#dc3545',
}

// Returns the environment of a single server record. Legacy records
// (persisted before the field existed) and unknown values map to ENV_NONE.
export function getServerEnvironment(server) {
  const env = server?.environment
  return ENV_COLORS[env] ? env : ENV_NONE
}

// Returns the environment of the active connection given the `connection`
// slice of the Redux store ({ serverHistory: [...] }).
export function getEnvironment(connectionState) {
  return getServerEnvironment(connectionState?.serverHistory?.[0])
}

// Returns the CSS color for an environment, or null when there is none.
export function getEnvironmentColor(environment) {
  return ENV_COLORS[environment] || null
}
