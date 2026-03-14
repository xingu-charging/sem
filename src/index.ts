/**
 * @file Programmatic API entry point for @xingu-charging/sem.
 * Re-exports daemon management functions and types for use by consuming packages
 * (e.g. Cypress tasks) without spawning CLI subprocesses.
 * @module @xingu-charging/sem
 * @license MIT
 *
 * Copyright (c) 2026 Xingu Charging
 * https://github.com/xingu-charging/sem
 */

export { startDaemon } from './daemon/manager.js'
export type { StartDaemonOptions, StartDaemonResult } from './daemon/manager.js'

export { sendCommand, getStatus, shutdown, cleanStaleSessions } from './daemon/client.js'

export { loadChargerTemplate } from './lib/charger.js'
export type { LoadedCharger } from './lib/charger.js'

export type { DaemonResponse, SessionMetadata } from './daemon/types.js'
