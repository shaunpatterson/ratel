/*
 * SPDX-FileCopyrightText: © 2017-2026 Istari Digital, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react'
import { useSelector } from 'react-redux'

import { ENV_PRODUCTION, getEnvironment } from 'lib/environments'

import './EnvironmentBanner.scss'

export default function EnvironmentBanner() {
  const environment = useSelector((state) => getEnvironment(state.connection))

  if (!environment) {
    return null
  }

  return (
    <div
      className={`environment-banner environment-banner--${environment}`}
      title={`Connected to a ${environment} server`}
    >
      {environment === ENV_PRODUCTION && (
        <span className='environment-banner__label'>production</span>
      )}
    </div>
  )
}
