/**
 * @file Session manager — spawns daemon processes and manages session lifecycle.
 * Handles starting new sessions, detecting duplicates, and cleaning stale sessions.
 * @module @xingu-charging/sem
 * @license MIT
 *
 * Copyright (c) 2026 Xingu Charging
 * https://github.com/xingu-charging/sem
 */

import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { sessionExists, cleanStaleSessions } from './client.js'

/** Options for starting a new daemon session. */
interface StartDaemonOptions {
  /** Path to the charger JSON template file */
  chargerPath: string
  /** Environment override (staging, production, local) */
  env?: string
  /** WebSocket URL override */
  url?: string
  /** If true, skip the auto-boot sequence */
  noBoot: boolean
}

/** Result returned after a daemon has been successfully spawned and is ready. */
interface StartDaemonResult {
  /** The session ID (chargerId from the template) */
  sessionId: string
  /** PID of the spawned daemon process */
  pid: number
}

/**
 * Spawn a new daemon process as a detached child.
 *
 * Loads the charger template to determine the session ID, cleans any stale sessions,
 * spawns `sem _daemon` as a detached child process, and waits for the "READY" signal
 * on stdout before returning. If the daemon fails to start within 30s, throws an error.
 *
 * @param options - Charger template path and connection overrides
 * @returns Session ID and PID of the running daemon
 * @throws If the session is already active, or the daemon fails to start
 */
export async function startDaemon(options: StartDaemonOptions): Promise<StartDaemonResult> {
  // Resolve the CLI entry point
  const currentFile = fileURLToPath(import.meta.url)
  const cliPath = path.resolve(path.dirname(currentFile), '..', 'cli.js')

  // Determine session ID from template
  // We need to parse the charger template to get the chargerId
  const { loadChargerTemplate } = await import('../lib/charger.js')
  const charger = loadChargerTemplate(options.chargerPath, options.env, options.url)
  const sessionId = charger.chargerId

  // Clean stale sessions first
  cleanStaleSessions()

  // Check for existing session
  if (sessionExists(sessionId)) {
    throw new Error(`Session "${sessionId}" is already active. Use "sem stop ${sessionId}" first.`)
  }

  // Build args for the hidden _daemon command
  const args = [
    cliPath,
    '_daemon',
    '--charger', options.chargerPath,
    '--session-id', sessionId
  ]
  if (options.env) {
    args.push('--env', options.env)
  }
  if (options.url) {
    args.push('--url', options.url)
  }
  if (options.noBoot) {
    args.push('--no-boot')
  }

  // Spawn detached daemon process
  const child = spawn(process.execPath, args, {
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe']
  })

  const pid = child.pid
  if (!pid) {
    throw new Error('Failed to start daemon process')
  }

  // Wait for READY signal or early exit
  return new Promise<StartDaemonResult>((resolve, reject) => {
    let stderr = ''
    const timeout = setTimeout(() => {
      child.unref()
      reject(new Error('Daemon startup timeout (30s). Check logs with: sem logs ' + sessionId))
    }, 30000)

    child.stdout!.on('data', (data: Buffer) => {
      const text = data.toString()
      if (text.includes('READY')) {
        clearTimeout(timeout)
        child.stdout!.removeAllListeners()
        child.stderr!.removeAllListeners()
        child.removeAllListeners('exit')
        child.unref()
        resolve({ sessionId, pid })
      }
    })

    child.stderr!.on('data', (data: Buffer) => {
      stderr += data.toString()
    })

    child.on('exit', (code) => {
      clearTimeout(timeout)
      reject(new Error(`Daemon exited with code ${code}${stderr ? `: ${stderr.trim()}` : ''}`))
    })
  })
}
