/**
 * @file Script runner — parses and executes .sem script files for repeatable
 * test scenarios. Supports send, wait, expect, charge, and variable substitution.
 * @module @xingu-charging/sem
 * @license MIT
 *
 * Copyright (c) 2026 Xingu Charging
 * https://github.com/xingu-charging/sem
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { OcppConnection } from '../ocpp/connection.js'
import { MessageType, type OcppMessage, type OcppCallMessage } from '../ocpp/types.js'
import { buildCommand, formatCallResult, isCommandError } from '../commands.js'
import { type LoadedCharger, setTransactionId, setConnectorStatus } from './charger.js'
import { startChargeSession, type SendAndWaitFn } from './chargeSession.js'
import type { ChargePointStatus } from '../ocpp/types.js'
import * as output from './output.js'

/** A parsed script instruction. */
interface ScriptInstruction {
  /** Line number in the script file (1-based) */
  line: number
  /** Instruction type */
  type: 'send' | 'wait' | 'expect' | 'charge' | 'set'
  /** Arguments for the instruction */
  args: string[]
}

/** Variables available during script execution. */
interface ScriptVars {
  /** Transaction ID from the last StartTransaction response */
  txId: string
  /** Current accumulated energy in Wh */
  energy: string
  /** Custom variables set via 'set' instruction */
  [key: string]: string
}

/**
 * Parse a .sem script file into instructions.
 *
 * @param filePath - Path to the script file
 * @returns Array of parsed instructions
 */
export function parseScript(filePath: string): ScriptInstruction[] {
  const fullPath = resolve(filePath)
  const content = readFileSync(fullPath, 'utf-8')
  const lines = content.split('\n')
  const instructions: ScriptInstruction[] = []

  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1
    const raw = lines[i].trim()

    // Skip empty lines and comments
    if (!raw || raw.startsWith('#')) continue

    const parts = raw.split(/\s+/)
    const type = parts[0].toLowerCase()
    const args = parts.slice(1)

    switch (type) {
      case 'send':
      case 'wait':
      case 'expect':
      case 'charge':
      case 'set':
        instructions.push({ line: lineNum, type: type as ScriptInstruction['type'], args })
        break
      default:
        throw new Error(`Script error at line ${lineNum}: unknown instruction "${type}"`)
    }
  }

  return instructions
}

/**
 * Substitute variables in an argument string.
 * Replaces $txId, $energy, and $varName with their values.
 */
function substituteVars(arg: string, vars: ScriptVars): string {
  return arg.replace(/\$(\w+)/g, (match, name: string) => {
    if (name in vars) return vars[name]
    return match
  })
}

/**
 * Execute a parsed script against a live OCPP connection.
 *
 * @param instructions - Parsed script instructions
 * @param connection - Active OCPP connection
 * @param charger - Loaded charger with state
 */
export async function executeScript(
  instructions: ScriptInstruction[],
  connection: OcppConnection,
  charger: LoadedCharger
): Promise<void> {
  const vars: ScriptVars = {
    txId: '0',
    energy: '0'
  }

  // Create a sendAndWait function for this script execution
  const sendAndWait = createScriptSendAndWait(connection)

  output.status(`Running script: ${instructions.length} instructions`)

  for (const instruction of instructions) {
    if (connection.getState() !== 'connected') {
      output.error(`Script aborted at line ${instruction.line}: connection lost`)
      break
    }

    try {
      await executeInstruction(instruction, connection, charger, vars, sendAndWait)
    } catch (err) {
      output.error(`Script error at line ${instruction.line}: ${err instanceof Error ? err.message : err}`)
      break
    }
  }

  output.status('Script execution complete')
}

/** Create a sendAndWait function for script execution. */
function createScriptSendAndWait(connection: OcppConnection): SendAndWaitFn {
  return async (action: string, message: OcppCallMessage): Promise<Record<string, unknown>> => {
    const msgId = message[1]

    const responsePromise = new Promise<Record<string, unknown>>((resolve, reject) => {
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

    await connection.send(message)
    return responsePromise
  }
}

/** Execute a single script instruction. */
async function executeInstruction(
  instruction: ScriptInstruction,
  connection: OcppConnection,
  charger: LoadedCharger,
  vars: ScriptVars,
  sendAndWait: SendAndWaitFn
): Promise<void> {
  const args = instruction.args.map((a) => substituteVars(a, vars))

  switch (instruction.type) {
    case 'send': {
      if (args.length < 1) {
        throw new Error('send requires at least a command name')
      }
      const command = args[0]
      const cmdArgs = args.slice(1)

      const result = buildCommand(command, cmdArgs, charger)
      if (isCommandError(result)) {
        throw new Error(result.error)
      }

      const msgId = result.message[1]

      // Create a response promise
      const responsePromise = new Promise<Record<string, unknown>>((resolve, reject) => {
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

      await connection.send(result.message)
      output.outgoing(result.action, result.outgoing.includes(': ') ? result.outgoing.split(': ').slice(1).join(': ') : result.outgoing)

      const payload = await responsePromise

      // Apply side effects
      const formatted = formatCallResult(result.action, payload)
      output.incoming(result.action, formatted.response.includes(': ') ? formatted.response.split(': ').slice(1).join(': ') : formatted.response)

      if (formatted.startHeartbeat !== undefined) {
        connection.startHeartbeat(formatted.startHeartbeat)
      }
      if (formatted.transactionId !== undefined) {
        setTransactionId(charger, formatted.transactionId)
        if (formatted.transactionId !== null) {
          vars.txId = String(formatted.transactionId)
        }
      }
      if (command === 'status' && cmdArgs.length >= 2) {
        const connectorId = parseInt(cmdArgs[0], 10)
        if (!isNaN(connectorId)) {
          setConnectorStatus(charger, connectorId, cmdArgs[1] as ChargePointStatus)
        }
      }
      break
    }

    case 'wait': {
      if (args.length < 1) {
        throw new Error('wait requires a duration in seconds')
      }
      const seconds = parseFloat(args[0])
      if (isNaN(seconds) || seconds < 0) {
        throw new Error('wait duration must be a positive number')
      }
      output.info(`  waiting ${seconds}s...`)
      await new Promise((resolve) => setTimeout(resolve, seconds * 1000))
      break
    }

    case 'expect': {
      if (args.length < 1) {
        throw new Error('expect requires a message type')
      }
      const expectedAction = args[0]
      const timeoutSec = args[1] ? parseFloat(args[1]) : 30

      output.info(`  expecting ${expectedAction} (timeout ${timeoutSec}s)...`)

      await new Promise<void>((resolve, reject) => {
        const handler = (msg: OcppMessage): void => {
          if (msg[0] === MessageType.CALL && msg[2] === expectedAction) {
            connection.off('message', handler)
            output.serverInitiated(expectedAction, `received (expected)`)
            resolve()
          }
        }
        connection.on('message', handler)

        setTimeout(() => {
          connection.off('message', handler)
          reject(new Error(`Timeout waiting for ${expectedAction}`))
        }, timeoutSec * 1000)
      })
      break
    }

    case 'charge': {
      if (args.length < 2) {
        throw new Error('charge requires <connectorId> <idTag> [duration] [power]')
      }
      const connectorId = parseInt(args[0], 10)
      const idTag = args[1]
      const duration = args[2] ? parseInt(args[2], 10) : 60
      const powerW = args[3] ? parseInt(args[3], 10) : (charger.config.capabilities?.maxPower ?? 7000)

      const log = (msg: string): void => { output.info(`  [charge] ${msg}`) }

      const session = startChargeSession(connection, charger, sendAndWait, log, {
        connectorId,
        idTag,
        duration,
        powerW,
        meterInterval: 30,
        meterStart: 0
      })

      // Wait for session completion
      await session.completion
      break
    }

    case 'set': {
      if (args.length < 2) {
        throw new Error('set requires <variable> <value>')
      }
      vars[args[0]] = args.slice(1).join(' ')
      output.info(`  set $${args[0]} = ${vars[args[0]]}`)
      break
    }
  }
}
