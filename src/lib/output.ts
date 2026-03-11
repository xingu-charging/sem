/**
 * @file Terminal output — color-coded console output for OCPP message traffic.
 * Provides distinct visual styles for outgoing, incoming, server-initiated,
 * error, status, and verbose messages.
 * @module @xingu-charging/sem
 * @license MIT
 *
 * Copyright (c) 2026 Xingu Charging
 * https://github.com/xingu-charging/sem
 */

import chalk from 'chalk'

/** Controls output verbosity: quiet suppresses info, verbose adds raw JSON. */
interface OutputConfig {
  verbosity: 'quiet' | 'normal' | 'verbose'
}

let config: OutputConfig = {
  verbosity: 'normal'
}

/** Update output configuration (verbosity level). */
export function setOutputConfig(newConfig: Partial<OutputConfig>): void {
  config = { ...config, ...newConfig }
}

/** Print an outgoing OCPP message (charger -> server). Blue [->] prefix. */
export function outgoing(action: string, detail?: string): void {
  const prefix = chalk.blue('[->]')
  const msg = detail ? `${prefix} ${action}: ${detail}` : `${prefix} ${action}`
  console.log(msg)
}

/** Print an incoming OCPP response (server -> charger). Green [<-] prefix. */
export function incoming(action: string, detail?: string): void {
  const prefix = chalk.green('[<-]')
  const msg = detail ? `${prefix} ${action}: ${detail}` : `${prefix} ${action}`
  console.log(msg)
}

/** Print a server-initiated message (e.g., RemoteStartTransaction). Yellow prefix. */
export function serverInitiated(action: string, detail?: string): void {
  const prefix = chalk.yellow('[<-] Server:')
  const msg = detail ? `${prefix} ${action}: ${detail}` : `${prefix} ${action}`
  console.log(msg)
}

/** Print an error message. Red [!] prefix. Always shown regardless of verbosity. */
export function error(message: string): void {
  console.log(chalk.red(`[!] ${message}`))
}

/** Print a status/lifecycle message (connecting, disconnecting, etc.). Cyan. */
export function status(message: string): void {
  console.log(chalk.cyan(message))
}

/** Print raw OCPP JSON. Only shown in verbose mode. */
export function verbose(message: string): void {
  if (config.verbosity === 'verbose') {
    console.log(chalk.gray(message))
  }
}

/** Print informational text. Suppressed in quiet mode. */
export function info(message: string): void {
  if (config.verbosity !== 'quiet') {
    console.log(message)
  }
}
