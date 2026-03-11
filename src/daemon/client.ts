/**
 * @file Daemon client — connects to a running daemon via Unix socket to send commands,
 * read logs, check status, list sessions, and request shutdown.
 * @module @xingu-charging/sem
 * @license MIT
 *
 * Copyright (c) 2026 Xingu Charging
 * https://github.com/xingu-charging/sem
 */

import net from 'node:net'
import fs from 'node:fs'
import type { DaemonRequest, DaemonResponse, SessionInfo, SessionMetadata } from './types.js'
import {
  SESSION_DIR,
  sessionSocketPath,
  sessionLogPath,
  sessionMetadataPath,
  sessionPidPath
} from './types.js'

/**
 * Connect to a daemon's Unix socket, send a request, and return the response.
 * Opens a new connection for each request and closes it after receiving the reply.
 */
function sendRequest(sessionId: string, request: DaemonRequest): Promise<DaemonResponse> {
  return new Promise((resolve, reject) => {
    const socketPath = sessionSocketPath(sessionId)

    if (!fs.existsSync(socketPath)) {
      reject(new Error(`Session "${sessionId}" not found or not running`))
      return
    }

    const socket = net.createConnection(socketPath)
    let buffer = ''

    socket.on('connect', () => {
      socket.write(JSON.stringify(request) + '\n')
    })

    socket.on('data', (data) => {
      buffer += data.toString()
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        if (!line.trim()) continue
        try {
          const response = JSON.parse(line) as DaemonResponse
          socket.end()
          resolve(response)
        } catch {
          reject(new Error('Invalid response from daemon'))
        }
      }
    })

    socket.on('error', (err) => {
      if ((err as NodeJS.ErrnoException).code === 'ECONNREFUSED' || (err as NodeJS.ErrnoException).code === 'ENOENT') {
        reject(new Error(`Session "${sessionId}" not found or not running`))
      } else {
        reject(new Error(`Connection error: ${err.message}`))
      }
    })

    socket.on('end', () => {
      if (buffer.trim()) {
        try {
          resolve(JSON.parse(buffer.trim()) as DaemonResponse)
        } catch {
          reject(new Error('Incomplete response from daemon'))
        }
      }
    })

    setTimeout(() => {
      socket.destroy()
      reject(new Error('Request timeout'))
    }, 15000)
  })
}

/** Send an OCPP command to a running daemon and return the response. Used by `sem send`. */
export async function sendCommand(sessionId: string, command: string, args: string[]): Promise<DaemonResponse> {
  return sendRequest(sessionId, { type: 'command', command, args })
}

/** Request current charger state from a running daemon. Used by `sem status`. */
export async function getStatus(sessionId: string): Promise<DaemonResponse> {
  return sendRequest(sessionId, { type: 'status' })
}

/** Request graceful shutdown of a running daemon. Used by `sem stop`. */
export async function shutdown(sessionId: string): Promise<DaemonResponse> {
  return sendRequest(sessionId, { type: 'shutdown' })
}

/**
 * Read the last N lines from a session's log file. Used by `sem logs`.
 * Works even after the daemon has stopped, since log files are preserved.
 */
export function readLogs(sessionId: string, lines: number): string[] {
  const logPath = sessionLogPath(sessionId)
  if (!fs.existsSync(logPath)) {
    throw new Error(`No logs found for session "${sessionId}"`)
  }

  const content = fs.readFileSync(logPath, 'utf-8')
  const allLines = content.split('\n').filter((l) => l.trim())
  return allLines.slice(-lines)
}

/** Check if a process is still running by sending signal 0. */
function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/**
 * Scan SESSION_DIR for metadata files and return all sessions with PID liveness status.
 * Used by `sem list`.
 */
export function listSessions(): SessionInfo[] {
  if (!fs.existsSync(SESSION_DIR)) {
    return []
  }

  const files = fs.readdirSync(SESSION_DIR).filter((f) => f.endsWith('.json'))
  const sessions: SessionInfo[] = []

  for (const file of files) {
    try {
      const raw = fs.readFileSync(`${SESSION_DIR}/${file}`, 'utf-8')
      const meta = JSON.parse(raw) as SessionMetadata
      const alive = isPidAlive(meta.pid)

      sessions.push({
        chargerId: meta.chargerId,
        name: meta.name,
        url: meta.url,
        protocol: meta.protocol,
        startedAt: meta.startedAt,
        pid: meta.pid,
        alive
      })
    } catch {
      // Skip corrupted metadata files
    }
  }

  return sessions
}

/** Remove session files for daemons whose PID is no longer alive (crashed or killed). */
export function cleanStaleSessions(): void {
  if (!fs.existsSync(SESSION_DIR)) {
    return
  }

  const files = fs.readdirSync(SESSION_DIR).filter((f) => f.endsWith('.json'))

  for (const file of files) {
    try {
      const metaPath = `${SESSION_DIR}/${file}`
      const raw = fs.readFileSync(metaPath, 'utf-8')
      const meta = JSON.parse(raw) as SessionMetadata
      if (!isPidAlive(meta.pid)) {
        const id = file.replace('.json', '')
        // Clean up all session files
        const paths = [
          sessionSocketPath(id),
          sessionPidPath(id),
          sessionLogPath(id),
          sessionMetadataPath(id)
        ]
        for (const p of paths) {
          try { fs.unlinkSync(p) } catch { /* ignore */ }
        }
      }
    } catch {
      // Skip corrupted files
    }
  }
}

/** Check if a session is currently active (socket exists and PID is alive). */
export function sessionExists(sessionId: string): boolean {
  const socketPath = sessionSocketPath(sessionId)
  if (!fs.existsSync(socketPath)) {
    return false
  }

  // Check if PID is alive
  const pidPath = sessionPidPath(sessionId)
  if (fs.existsSync(pidPath)) {
    try {
      const pid = parseInt(fs.readFileSync(pidPath, 'utf-8').trim(), 10)
      return isPidAlive(pid)
    } catch {
      return false
    }
  }

  return false
}
