/**
 * @file Daemon server — background process that maintains a persistent OCPP connection.
 * Accepts commands via Unix socket IPC, auto-handles server-initiated messages,
 * and writes all OCPP traffic to a log file.
 * @module @xingu-charging/sem
 * @license MIT
 *
 * Copyright (c) 2026 Xingu Charging
 * https://github.com/xingu-charging/sem
 */

import net from 'node:net'
import fs from 'node:fs'
import { OcppConnection } from '../ocpp/connection.js'
import { ConnectionState, MessageType, type OcppMessage } from '../ocpp/types.js'
import { loadChargerTemplate, setTransactionId, setConnectorStatus, type LoadedCharger } from '../lib/charger.js'
import { handleServerMessage } from '../lib/serverHandler.js'
import { buildCommand, formatCallResult, isCommandError } from '../commands.js'
import { createStatusNotification } from '../ocpp/messages.js'
import type { DaemonRequest, DaemonResponse, SessionMetadata } from './types.js'
import {
  SESSION_DIR,
  sessionSocketPath,
  sessionPidPath,
  sessionLogPath,
  sessionMetadataPath
} from './types.js'

/** Options passed to the daemon process via CLI arguments. */
interface DaemonOptions {
  /** Path to the charger JSON template file */
  charger: string
  /** Session ID (typically the chargerId from the template) */
  sessionId: string
  /** Environment override (staging, production, local) */
  env?: string
  /** WebSocket URL override */
  url?: string
  /** Whether to run the auto-boot sequence (BootNotification + StatusNotification) */
  boot: boolean
}

/** Tracks a pending OCPP response correlated by messageId. */
interface PendingResponse {
  resolve: (payload: Record<string, unknown>) => void
  reject: (error: Error) => void
  action: string
}

/** Maximum time to wait for an OCPP CALLRESULT before timing out. */
const COMMAND_TIMEOUT_MS = 10000

/**
 * Main daemon entry point. Called by the hidden `sem _daemon` subcommand.
 *
 * Lifecycle:
 * 1. Load charger template and connect to OCPP gateway
 * 2. Run auto-boot sequence (unless --no-boot)
 * 3. Create Unix socket server for IPC
 * 4. Write session files (metadata, PID)
 * 5. Signal parent process with "READY"
 * 6. Run indefinitely, handling IPC commands and server-initiated messages
 * 7. Clean up on SIGTERM/shutdown request
 */
export async function runDaemon(options: DaemonOptions): Promise<void> {
  const startedAt = new Date().toISOString()
  const logStream = createLogStream(options.sessionId)

  function log(message: string): void {
    const timestamp = new Date().toISOString()
    const line = `[${timestamp}] ${message}\n`
    logStream.write(line)
  }

  // Load charger template
  let charger: LoadedCharger
  try {
    charger = loadChargerTemplate(options.charger, options.env, options.url)
  } catch (err) {
    log(`Failed to load charger template: ${err}`)
    process.exit(1)
  }

  log(`Charger: ${charger.name} (${charger.chargerId})`)
  log(`URL: ${charger.url}`)
  log(`Protocol: ${charger.protocol}`)

  // Track pending OCPP responses
  const pendingMessages = new Map<string, PendingResponse>()

  // Create OCPP connection
  const connection = new OcppConnection()

  connection.on('stateChange', (state: ConnectionState) => {
    if (state === ConnectionState.CONNECTED) {
      charger.state.connected = true
      log('Connected to OCPP gateway')
    } else if (state === ConnectionState.DISCONNECTED) {
      charger.state.connected = false
      log('Disconnected from OCPP gateway')
    }
  })

  connection.on('messageSent', (message: OcppMessage) => {
    if (message[0] === MessageType.CALL) {
      log(`[->] ${message[2]}: ${JSON.stringify(message[3])}`)
    }
  })

  connection.on('message', async (message: OcppMessage) => {
    if (message[0] === MessageType.CALLRESULT) {
      const [, msgId, payload] = message
      const pending = pendingMessages.get(msgId)
      pendingMessages.delete(msgId)

      if (pending) {
        // Apply side effects from response
        const formatted = formatCallResult(pending.action, payload)
        if (formatted.startHeartbeat !== undefined) {
          connection.startHeartbeat(formatted.startHeartbeat)
        }
        if (formatted.transactionId !== undefined) {
          setTransactionId(charger, formatted.transactionId)
        }
        log(`[<-] ${formatted.response}`)
        pending.resolve(payload)
      } else {
        log(`[<-] Response: ${JSON.stringify(payload)}`)
      }
    } else if (message[0] === MessageType.CALL) {
      const [, msgId, action, payload] = message
      log(`[<-] Server: ${action}: ${JSON.stringify(payload)}`)
      await handleServerMessage(connection, msgId, action, payload, charger)
    } else if (message[0] === MessageType.CALLERROR) {
      const [, msgId, errorCode, errorDescription] = message
      const pending = pendingMessages.get(msgId)
      pendingMessages.delete(msgId)
      const actionName = pending?.action ?? 'Unknown'
      log(`[!] ${actionName} error: ${errorCode} - ${errorDescription}`)
      if (pending) {
        pending.reject(new Error(`${errorCode}: ${errorDescription}`))
      }
    }
  })

  connection.on('log', (logEntry) => {
    log(`[${logEntry.level}] ${logEntry.message}`)
  })

  // Connect to OCPP gateway
  log('Connecting...')
  try {
    await connection.connect({
      url: charger.url,
      protocol: charger.protocol,
      auth: charger.auth
    })
  } catch (err) {
    log(`Connection failed: ${err}`)
    process.exit(1)
  }

  // Auto-boot sequence
  if (options.boot) {
    log('Starting boot sequence...')
    try {
      await sendAndWait(connection, charger, pendingMessages, 'boot', [])
      // Send StatusNotification for each connector
      const connectorCount = charger.config.connectors?.length ?? 1
      for (let i = 1; i <= connectorCount; i++) {
        const statusMsg = createStatusNotification(i, 'Available')
        await sendAndWaitRaw(connection, pendingMessages, 'StatusNotification', statusMsg)
        setConnectorStatus(charger, i, 'Available')
        log(`[->] StatusNotification: connector=${i} status=Available`)
      }
      log('Boot sequence complete')
    } catch (err) {
      log(`Boot sequence failed: ${err}`)
      process.exit(1)
    }
  }

  // Ensure session directory exists
  fs.mkdirSync(SESSION_DIR, { recursive: true })

  // Write session files
  const metadata: SessionMetadata = {
    chargerId: charger.chargerId,
    name: charger.name,
    templatePath: options.charger,
    url: charger.url,
    protocol: charger.protocol,
    startedAt,
    pid: process.pid
  }
  fs.writeFileSync(sessionMetadataPath(options.sessionId), JSON.stringify(metadata, null, 2))
  fs.writeFileSync(sessionPidPath(options.sessionId), String(process.pid))

  // Create Unix socket server
  const socketPath = sessionSocketPath(options.sessionId)
  const server = net.createServer((socket) => {
    let buffer = ''

    socket.on('data', (data) => {
      buffer += data.toString()
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        if (!line.trim()) continue
        handleRequest(line.trim(), socket, connection, charger, pendingMessages, startedAt, log)
      }
    })

    socket.on('error', (err) => {
      log(`Socket client error: ${err.message}`)
    })
  })

  server.listen(socketPath, () => {
    log(`Socket server listening at ${socketPath}`)
    // Signal parent that we're ready by writing to stdout
    process.stdout.write('READY\n')
  })

  // Graceful shutdown
  async function shutdown(): Promise<void> {
    log('Shutting down...')
    server.close()
    await connection.disconnect()
    cleanupFiles(options.sessionId)
    logStream.end()
    process.exit(0)
  }

  process.on('SIGTERM', () => { void shutdown() })
  process.on('SIGINT', () => { void shutdown() })
}

/** Create an append-mode write stream for the session log file. */
function createLogStream(sessionId: string): fs.WriteStream {
  fs.mkdirSync(SESSION_DIR, { recursive: true })
  return fs.createWriteStream(sessionLogPath(sessionId), { flags: 'a' })
}

/** Remove socket, PID, and metadata files on shutdown. Log file is preserved. */
function cleanupFiles(sessionId: string): void {
  const paths = [
    sessionSocketPath(sessionId),
    sessionPidPath(sessionId),
    sessionMetadataPath(sessionId)
  ]
  for (const p of paths) {
    try { fs.unlinkSync(p) } catch { /* ignore */ }
  }
}

/** Parse and dispatch a single IPC request from a connected client. */
function handleRequest(
  raw: string,
  socket: net.Socket,
  connection: OcppConnection,
  charger: LoadedCharger,
  pendingMessages: Map<string, PendingResponse>,
  startedAt: string,
  log: (msg: string) => void
): void {
  let request: DaemonRequest
  try {
    request = JSON.parse(raw) as DaemonRequest
  } catch {
    sendResponse(socket, { type: 'error', message: 'Invalid JSON' })
    return
  }

  switch (request.type) {
    case 'command': {
      void handleCommandRequest(request.command, request.args, socket, connection, charger, pendingMessages, log)
      break
    }
    case 'status': {
      const connectorStates: Record<string, string> = {}
      for (const [id, status] of charger.state.connectorStates) {
        connectorStates[String(id)] = status
      }
      const response: DaemonResponse = {
        type: 'status',
        connected: charger.state.connected,
        chargerId: charger.chargerId,
        uptime: Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000),
        transactionId: charger.state.transactionId,
        connectorStates
      }
      sendResponse(socket, response)
      break
    }
    case 'shutdown': {
      sendResponse(socket, { type: 'result', success: true, output: ['Shutting down...'] })
      // Give response time to flush before exiting
      setTimeout(() => {
        process.emit('SIGTERM' as NodeJS.Signals)
      }, 100)
      break
    }
    default: {
      sendResponse(socket, { type: 'error', message: `Unknown request type` })
    }
  }
}

/** Execute an OCPP command via IPC and return the result to the client socket. */
async function handleCommandRequest(
  command: string,
  args: string[],
  socket: net.Socket,
  connection: OcppConnection,
  charger: LoadedCharger,
  pendingMessages: Map<string, PendingResponse>,
  log: (msg: string) => void
): Promise<void> {
  try {
    const lines = await sendAndWait(connection, charger, pendingMessages, command, args)
    sendResponse(socket, { type: 'result', success: true, output: lines })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log(`Command error: ${message}`)
    sendResponse(socket, { type: 'error', message })
  }
}

/**
 * Build, send, and wait for the OCPP response to a user command.
 * Applies side effects (heartbeat, transactionId, connector status) on success.
 * @returns Output lines containing the outgoing message and server response.
 */
async function sendAndWait(
  connection: OcppConnection,
  charger: LoadedCharger,
  pendingMessages: Map<string, PendingResponse>,
  command: string,
  args: string[]
): Promise<string[]> {
  const result = buildCommand(command, args, charger)
  if (isCommandError(result)) {
    throw new Error(result.error)
  }

  const { action, message } = result
  const msgId = message[1]
  const output: string[] = []
  output.push(`[->] ${result.outgoing}`)

  // Register pending handler before sending
  const responsePromise = new Promise<Record<string, unknown>>((resolve, reject) => {
    pendingMessages.set(msgId, { resolve, reject, action })
  })

  await connection.send(message)

  // Wait for response with timeout
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    setTimeout(() => {
      pendingMessages.delete(msgId)
      reject(new Error('OCPP response timeout'))
    }, COMMAND_TIMEOUT_MS)
  })

  const payload = await Promise.race([responsePromise, timeoutPromise])

  // Apply side effects
  const formatted = formatCallResult(action, payload)
  if (formatted.startHeartbeat !== undefined) {
    connection.startHeartbeat(formatted.startHeartbeat)
  }
  if (formatted.transactionId !== undefined) {
    setTransactionId(charger, formatted.transactionId)
  }
  if (action === 'StatusNotification' && args.length >= 2) {
    const connectorId = parseInt(args[0], 10)
    if (!isNaN(connectorId)) {
      setConnectorStatus(charger, connectorId, args[1] as import('../ocpp/types.js').ChargePointStatus)
    }
  }

  output.push(`[<-] ${formatted.response}`)
  return output
}

/** Send a pre-built OCPP message and wait for the correlated CALLRESULT. */
async function sendAndWaitRaw(
  connection: OcppConnection,
  pendingMessages: Map<string, PendingResponse>,
  action: string,
  message: import('../ocpp/types.js').OcppCallMessage
): Promise<Record<string, unknown>> {
  const msgId = message[1]

  const responsePromise = new Promise<Record<string, unknown>>((resolve, reject) => {
    pendingMessages.set(msgId, { resolve, reject, action })
  })

  await connection.send(message)

  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    setTimeout(() => {
      pendingMessages.delete(msgId)
      reject(new Error('OCPP response timeout'))
    }, COMMAND_TIMEOUT_MS)
  })

  return Promise.race([responsePromise, timeoutPromise])
}

/** Write a newline-delimited JSON response to the client socket. */
function sendResponse(socket: net.Socket, response: DaemonResponse): void {
  socket.write(JSON.stringify(response) + '\n')
}
