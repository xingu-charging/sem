/**
 * @file Daemon IPC types — request/response protocol and session file paths.
 * Shared between the daemon server and client processes.
 * @module @xingu-charging/sem
 * @license MIT
 *
 * Copyright (c) 2026 Xingu Charging
 * https://github.com/xingu-charging/sem
 */

/**
 * IPC Protocol: newline-delimited JSON over Unix socket.
 *
 * The client sends a single JSON line, the daemon processes it and
 * returns a single JSON line response. One request per connection.
 */

/**
 * Request sent from a client process (sem send/status/stop) to the daemon.
 * - `command`: execute an OCPP command and return the server response
 * - `status`: return current charger state (connected, uptime, connectors)
 * - `shutdown`: gracefully disconnect and exit the daemon process
 */
export type DaemonRequest =
  | { type: 'command'; command: string; args: string[] }
  | { type: 'status' }
  | { type: 'shutdown' }

/**
 * Response sent from the daemon back to the client.
 * - `result`: successful command execution with output lines
 * - `error`: command failed with a descriptive message
 * - `status`: current charger state snapshot
 */
export type DaemonResponse =
  | { type: 'result'; success: true; output: string[] }
  | { type: 'error'; message: string }
  | {
    type: 'status'
    connected: boolean
    chargerId: string
    uptime: number
    transactionId: number | null
    connectorStates: Record<string, string>
  }

/** Session metadata persisted to `<SESSION_DIR>/<id>.json` for discovery by `sem list`. */
export interface SessionMetadata {
  chargerId: string
  name: string
  templatePath: string
  url: string
  protocol: string
  startedAt: string
  pid: number
}

/** Session info returned by `listSessions()`, enriched with PID liveness check. */
export interface SessionInfo {
  chargerId: string
  name: string
  url: string
  protocol: string
  startedAt: string
  pid: number
  /** Whether the daemon process is still running */
  alive: boolean
}

/** Directory where all session files are stored. Wiped on container/system restart. */
export const SESSION_DIR = '/tmp/sem'

/** Unix socket path for IPC with the daemon. */
export function sessionSocketPath(id: string): string {
  return `${SESSION_DIR}/${id}.sock`
}

/** PID file path for the daemon process. */
export function sessionPidPath(id: string): string {
  return `${SESSION_DIR}/${id}.pid`
}

/** Plain-text log file path (no ANSI colors). */
export function sessionLogPath(id: string): string {
  return `${SESSION_DIR}/${id}.log`
}

/** JSON metadata file path for session discovery. */
export function sessionMetadataPath(id: string): string {
  return `${SESSION_DIR}/${id}.json`
}
