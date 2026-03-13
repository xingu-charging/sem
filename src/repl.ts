/**
 * @file Interactive REPL — readline-based command loop for direct terminal use.
 * @module @xingu-charging/sem
 * @license MIT
 *
 * Copyright (c) 2026 Xingu Charging
 * https://github.com/xingu-charging/sem
 */

import { createInterface, type Interface } from 'node:readline'
import { OcppConnection } from './ocpp/connection.js'
import { MessageType, type OcppMessage, type OcppCallMessage } from './ocpp/types.js'
import { handleServerMessage, setServerHandlerConfig } from './lib/serverHandler.js'
import { type LoadedCharger, setTransactionId, setConnectorStatus } from './lib/charger.js'
import { buildCommand, formatCallResult, isCommandError } from './commands.js'
import type { ChargePointStatus } from './ocpp/types.js'
import { startChargeSession, stopChargeSession, getActiveSession, gracefulShutdown, type SendAndWaitFn } from './lib/chargeSession.js'
import * as output from './lib/output.js'

/** Help text definition for a single REPL command. */
interface CommandDef {
  usage: string
  description: string
}

/** REPL command definitions displayed by the `help` command. */
const COMMANDS: Record<string, CommandDef> = {
  boot: { usage: 'boot', description: 'Send BootNotification' },
  heartbeat: { usage: 'heartbeat', description: 'Send Heartbeat' },
  status: { usage: 'status <conn> <status> [errorCode]', description: 'Send StatusNotification' },
  authorize: { usage: 'authorize <idTag>', description: 'Send Authorize' },
  start: { usage: 'start <conn> <idTag> <meter>', description: 'Send StartTransaction' },
  stop: { usage: 'stop <txId> <meter>', description: 'Send StopTransaction' },
  meter: { usage: 'meter <conn> <txId> <wh> <w>', description: 'Send MeterValues' },
  data: { usage: 'data <vendorId> [msgId] [data]', description: 'Send DataTransfer' },
  charge: { usage: 'charge <conn> <idTag> [duration] [power] [interval]', description: 'Run full charge session' },
  'stop-charge': { usage: 'stop-charge <conn>', description: 'Stop active charge session' },
  'firmware-status': { usage: 'firmware-status <status>', description: 'Send FirmwareStatusNotification' },
  'diagnostics-status': { usage: 'diagnostics-status <status>', description: 'Send DiagnosticsStatusNotification' },
  shutdown: { usage: 'shutdown', description: 'Graceful shutdown (stop sessions, set Unavailable, disconnect)' },
  disconnect: { usage: 'disconnect', description: 'Close WebSocket connection (no OCPP messages)' },
  help: { usage: 'help', description: 'Show this help' },
  exit: { usage: 'exit', description: 'Graceful shutdown and exit' }
}

/**
 * Start the interactive REPL loop.
 *
 * Wires up OCPP message event handlers for request/response correlation,
 * creates a readline interface for user input, and dispatches commands.
 * Handles graceful shutdown on EOF (stdin close) or the `exit` command.
 *
 * @param connection - Connected OcppConnection instance
 * @param charger - Loaded charger template with runtime state
 */
export function startRepl(
  connection: OcppConnection,
  charger: LoadedCharger
): void {
  const pendingMessages = new Map<string, string>()

  // Always configure server handler so RemoteStart/Stop/Reset etc. work
  const sendAndWait = createReplSendAndWait(connection, pendingMessages, charger)
  const log = (msg: string): void => { output.info(`[auto] ${msg}`) }
  setServerHandlerConfig({ autoCharge: true, sendAndWait, log })

  // Wire up message events for correlation
  connection.on('messageSent', (message: OcppMessage) => {
    if (message[0] === MessageType.CALL) {
      const [, msgId, action] = message
      pendingMessages.set(msgId, action)
      output.verbose(JSON.stringify(message))
    }
  })

  connection.on('message', async (message: OcppMessage) => {
    output.verbose(JSON.stringify(message))

    if (message[0] === MessageType.CALLRESULT) {
      const [, msgId, payload] = message
      const action = pendingMessages.get(msgId)
      pendingMessages.delete(msgId)

      if (action) {
        handleCallResult(action, payload, connection, charger)
      } else {
        output.incoming('Response', JSON.stringify(payload))
      }
    } else if (message[0] === MessageType.CALL) {
      const [, msgId, action, payload] = message
      await handleServerMessage(connection, msgId, action, payload, charger)
    } else if (message[0] === MessageType.CALLERROR) {
      const [, msgId, errorCode, errorDescription] = message
      const action = pendingMessages.get(msgId)
      pendingMessages.delete(msgId)
      output.error(`${action ?? 'Unknown'} error: ${errorCode} - ${errorDescription}`)
    }
  })

  connection.on('log', (log) => {
    if (log.level === 'error') {
      output.error(log.message)
    } else if (log.level === 'warn') {
      output.error(log.message)
    } else {
      output.info(log.message)
    }
  })

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: 'sem> '
  })

  rl.prompt()

  rl.on('line', async (line: string) => {
    const trimmed = line.trim()
    if (!trimmed) {
      rl.prompt()
      return
    }

    const parts = trimmed.split(/\s+/)
    const command = parts[0].toLowerCase()
    const args = parts.slice(1)

    try {
      await executeCommand(command, args, connection, charger, rl, pendingMessages)
    } catch (err) {
      output.error(`${err}`)
    }

    rl.prompt()
  })

  rl.on('close', () => {
    connection.disconnect().then(() => {
      process.exit(0)
    })
  })
}

/** Format and display a CALLRESULT, applying side effects (heartbeat, transactionId). */
function handleCallResult(
  action: string,
  payload: Record<string, unknown>,
  connection: OcppConnection,
  charger: LoadedCharger
): void {
  const formatted = formatCallResult(action, payload)
  output.incoming(action, formatted.response.includes(': ') ? formatted.response.split(': ').slice(1).join(': ') : formatted.response)

  if (formatted.startHeartbeat !== undefined) {
    connection.startHeartbeat(formatted.startHeartbeat)
  }
  if (formatted.transactionId !== undefined) {
    setTransactionId(charger, formatted.transactionId)
  }
}

/**
 * Create a sendAndWait function for use with charge sessions in REPL mode.
 * Registers a pending message, sends it, and waits for the correlated CALLRESULT.
 */
function createReplSendAndWait(
  connection: OcppConnection,
  pendingMessages: Map<string, string>,
  _charger: LoadedCharger
): SendAndWaitFn {
  return async (action: string, message: OcppCallMessage): Promise<Record<string, unknown>> => {
    const msgId = message[1]

    const responsePromise = new Promise<Record<string, unknown>>((resolve, reject) => {
      // Store a callback in the charger state for the REPL to resolve
      const handler = (msg: OcppMessage): void => {
        if (msg[0] === MessageType.CALLRESULT && msg[1] === msgId) {
          connection.off('message', handler)
          resolve(msg[2])
        } else if (msg[0] === MessageType.CALLERROR && msg[1] === msgId) {
          connection.off('message', handler)
          reject(new Error(`${msg[2]}: ${msg[3]}`))
        }
      }
      connection.on('message', handler)

      setTimeout(() => {
        connection.off('message', handler)
        reject(new Error('OCPP response timeout'))
      }, 10000)
    })

    pendingMessages.set(msgId, action)
    await connection.send(message)
    output.outgoing(action, `${action}`)

    const payload = await responsePromise
    // Side effects are already handled by the main message handler
    return payload
  }
}

/** Execute a single REPL command — handles REPL-only commands and delegates OCPP commands to buildCommand(). */
async function executeCommand(
  command: string,
  args: string[],
  connection: OcppConnection,
  charger: LoadedCharger,
  rl: Interface,
  pendingMessages: Map<string, string>
): Promise<void> {
  // Handle REPL-only commands
  switch (command) {
    case 'disconnect': {
      await connection.disconnect()
      output.status('Disconnected')
      return
    }
    case 'help': {
      printHelp()
      return
    }
    case 'shutdown': {
      const sendAndWait = createReplSendAndWait(connection, pendingMessages, charger)
      const log = (msg: string): void => { output.info(`[shutdown] ${msg}`) }
      output.status('Shutting down gracefully...')
      await gracefulShutdown(connection, charger, sendAndWait, log)
      output.status('Shutdown complete')
      return
    }
    case 'exit':
    case 'quit': {
      const sendAndWait = createReplSendAndWait(connection, pendingMessages, charger)
      const log = (msg: string): void => { output.info(`[shutdown] ${msg}`) }
      output.status('Shutting down gracefully...')
      await gracefulShutdown(connection, charger, sendAndWait, log)
      output.status('Shutdown complete')
      rl.close()
      return
    }
    case 'charge': {
      if (args.length < 2) {
        output.error('Usage: charge <connectorId> <idTag> [duration] [power] [interval] [socStart] [socEnd] [batteryWh]')
        return
      }
      const connectorId = parseInt(args[0], 10)
      const idTag = args[1]
      const duration = args[2] ? parseInt(args[2], 10) : 60
      const powerW = args[3] ? parseInt(args[3], 10) : (charger.config.capabilities?.maxPower ?? 7000)
      const meterInterval = args[4] ? parseInt(args[4], 10) : 30
      const socStart = args[5] ? parseInt(args[5], 10) : undefined
      const socEnd = args[6] ? parseInt(args[6], 10) : undefined
      const batteryCapacityWh = args[7] ? parseInt(args[7], 10) : undefined

      if (isNaN(connectorId) || isNaN(duration) || isNaN(powerW) || isNaN(meterInterval)) {
        output.error('Numeric arguments must be valid numbers')
        return
      }

      const sendAndWait = createReplSendAndWait(connection, pendingMessages, charger)
      const log = (msg: string): void => { output.info(`[charge] ${msg}`) }

      try {
        const session = startChargeSession(connection, charger, sendAndWait, log, {
          connectorId,
          idTag,
          duration,
          powerW,
          meterInterval,
          meterStart: 0,
          socStart,
          socEnd,
          batteryCapacityWh
        })
        output.status(`Charge session started on connector ${connectorId} (${duration}s, ${powerW}W)`)
        // Don't await completion — let it run in the background
        session.completion.catch((err) => {
          output.error(`Charge session error: ${err}`)
        })
      } catch (err) {
        output.error(`${err instanceof Error ? err.message : err}`)
      }
      return
    }
    case 'stop-charge': {
      if (args.length < 1) {
        output.error('Usage: stop-charge <connectorId>')
        return
      }
      const connectorId = parseInt(args[0], 10)
      if (isNaN(connectorId)) {
        output.error('connectorId must be a number')
        return
      }
      const session = getActiveSession(charger.chargerId, connectorId)
      if (!session) {
        output.error(`No active charge session on connector ${connectorId}`)
        return
      }
      const sendAndWait = createReplSendAndWait(connection, pendingMessages, charger)
      const log = (msg: string): void => { output.info(`[charge] ${msg}`) }
      await stopChargeSession(charger.chargerId, connectorId, connection, charger, sendAndWait, log)
      output.status(`Charge session on connector ${connectorId} stopped`)
      return
    }
  }

  // Use shared command building for OCPP commands
  const result = buildCommand(command, args, charger)
  if (isCommandError(result)) {
    output.error(result.error)
    return
  }

  await connection.send(result.message)
  output.outgoing(result.action, result.outgoing.includes(': ') ? result.outgoing.split(': ').slice(1).join(': ') : result.outgoing)

  // Apply immediate side effects for status command
  if (command === 'status' && args.length >= 2) {
    const connectorId = parseInt(args[0], 10)
    if (!isNaN(connectorId)) {
      setConnectorStatus(charger, connectorId, args[1] as ChargePointStatus)
    }
  }
}

/** Print the command help table to the terminal. */
function printHelp(): void {
  output.info('')
  output.info('Available commands:')
  output.info('')
  for (const [, cmd] of Object.entries(COMMANDS)) {
    const padded = cmd.usage.padEnd(40)
    output.info(`  ${padded} ${cmd.description}`)
  }
  output.info('')
}
