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
import { MessageType, type OcppMessage } from './ocpp/types.js'
import { handleServerMessage } from './lib/serverHandler.js'
import { type LoadedCharger, setTransactionId, setConnectorStatus } from './lib/charger.js'
import { buildCommand, formatCallResult, isCommandError } from './commands.js'
import type { ChargePointStatus } from './ocpp/types.js'
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
  status: { usage: 'status <conn> <status>', description: 'Send StatusNotification' },
  authorize: { usage: 'authorize <idTag>', description: 'Send Authorize' },
  start: { usage: 'start <conn> <idTag> <meter>', description: 'Send StartTransaction' },
  stop: { usage: 'stop <txId> <meter>', description: 'Send StopTransaction' },
  meter: { usage: 'meter <conn> <txId> <wh> <w>', description: 'Send MeterValues' },
  data: { usage: 'data <vendorId> [msgId] [data]', description: 'Send DataTransfer' },
  disconnect: { usage: 'disconnect', description: 'Close WebSocket connection' },
  help: { usage: 'help', description: 'Show this help' },
  exit: { usage: 'exit', description: 'Disconnect and exit' }
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
      await executeCommand(command, args, connection, charger, rl)
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

/** Execute a single REPL command — handles REPL-only commands and delegates OCPP commands to buildCommand(). */
async function executeCommand(
  command: string,
  args: string[],
  connection: OcppConnection,
  charger: LoadedCharger,
  rl: Interface
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
    case 'exit':
    case 'quit': {
      output.status('Disconnecting...')
      await connection.disconnect()
      rl.close()
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
