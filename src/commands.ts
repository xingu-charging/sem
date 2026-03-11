/**
 * @file Shared command building — parses user input into OCPP messages and formats responses.
 * Used by both the interactive REPL and daemon mode.
 * @module @xingu-charging/sem
 * @license MIT
 *
 * Copyright (c) 2026 Xingu Charging
 * https://github.com/xingu-charging/sem
 */

import type { OcppCallMessage, ChargePointStatus } from './ocpp/types.js'
import {
  createBootNotification,
  createHeartbeat,
  createStatusNotification,
  createAuthorize,
  createStartTransaction,
  createStopTransaction,
  createMeterValues,
  createDataTransfer
} from './ocpp/messages.js'
import type { LoadedCharger } from './lib/charger.js'

const VALID_STATUSES: ChargePointStatus[] = [
  'Available', 'Preparing', 'Charging', 'SuspendedEVSE',
  'SuspendedEV', 'Finishing', 'Reserved', 'Unavailable', 'Faulted'
]

/** Successful command build result containing the OCPP message ready to send. */
export interface CommandResult {
  /** OCPP action name (e.g., 'BootNotification', 'StartTransaction') */
  action: string
  /** The constructed OCPP CALL message array */
  message: OcppCallMessage
  /** Human-readable description of the outgoing message */
  outgoing: string
}

/** Returned when command parsing or validation fails. */
export interface CommandError {
  /** Human-readable error message with usage hint */
  error: string
}

/**
 * Parse a user command and build the corresponding OCPP CALL message.
 *
 * Handles argument validation, type coercion, and message construction.
 * Does not send the message or apply side effects — the caller is responsible
 * for sending via OcppConnection and updating charger state.
 *
 * @param command - Command name (boot, heartbeat, status, authorize, start, stop, meter, data)
 * @param args - Command arguments as string tokens
 * @param charger - Loaded charger template with identity and config
 * @returns CommandResult with the OCPP message, or CommandError with usage hint
 */
export function buildCommand(
  command: string,
  args: string[],
  charger: LoadedCharger
): CommandResult | CommandError {
  switch (command) {
    case 'boot': {
      const identity = charger.config.identity
      const message = createBootNotification({
        chargePointVendor: identity.vendor,
        chargePointModel: identity.model,
        chargePointSerialNumber: identity.serialNumber,
        chargeBoxSerialNumber: identity.chargeBoxSerialNumber,
        firmwareVersion: identity.firmwareVersion,
        iccid: identity.iccid,
        imsi: identity.imsi,
        meterType: identity.meterType,
        meterSerialNumber: identity.meterSerialNumber
      })
      return {
        action: 'BootNotification',
        message,
        outgoing: `BootNotification: vendor=${identity.vendor} model=${identity.model}`
      }
    }

    case 'heartbeat': {
      const message = createHeartbeat()
      return {
        action: 'Heartbeat',
        message,
        outgoing: 'Heartbeat'
      }
    }

    case 'status': {
      if (args.length < 2) {
        return { error: `Usage: status <connectorId> <status>\n  Valid statuses: ${VALID_STATUSES.join(', ')}` }
      }
      const connectorId = parseInt(args[0], 10)
      const statusValue = args[1] as ChargePointStatus
      if (isNaN(connectorId)) {
        return { error: 'connectorId must be a number' }
      }
      if (!VALID_STATUSES.includes(statusValue)) {
        return { error: `Invalid status. Valid: ${VALID_STATUSES.join(', ')}` }
      }
      const message = createStatusNotification(connectorId, statusValue)
      return {
        action: 'StatusNotification',
        message,
        outgoing: `StatusNotification: connector=${connectorId} status=${statusValue}`
      }
    }

    case 'authorize': {
      if (args.length < 1) {
        return { error: 'Usage: authorize <idTag>' }
      }
      const message = createAuthorize(args[0])
      return {
        action: 'Authorize',
        message,
        outgoing: `Authorize: idTag=${args[0]}`
      }
    }

    case 'start': {
      if (args.length < 3) {
        return { error: 'Usage: start <connectorId> <idTag> <meterStart>' }
      }
      const connectorId = parseInt(args[0], 10)
      const idTag = args[1]
      const meterStart = parseInt(args[2], 10)
      if (isNaN(connectorId) || isNaN(meterStart)) {
        return { error: 'connectorId and meterStart must be numbers' }
      }
      const message = createStartTransaction(connectorId, idTag, meterStart)
      return {
        action: 'StartTransaction',
        message,
        outgoing: `StartTransaction: connector=${connectorId} idTag=${idTag} meter=${meterStart}Wh`
      }
    }

    case 'stop': {
      if (args.length < 2) {
        return { error: 'Usage: stop <transactionId> <meterStop>' }
      }
      const txId = parseInt(args[0], 10)
      const meterStop = parseInt(args[1], 10)
      if (isNaN(txId) || isNaN(meterStop)) {
        return { error: 'transactionId and meterStop must be numbers' }
      }
      const message = createStopTransaction(txId, meterStop)
      return {
        action: 'StopTransaction',
        message,
        outgoing: `StopTransaction: txId=${txId} meter=${meterStop}Wh`
      }
    }

    case 'meter': {
      if (args.length < 4) {
        return { error: 'Usage: meter <connectorId> <transactionId> <energyWh> <powerW>' }
      }
      const connectorId = parseInt(args[0], 10)
      const txId = parseInt(args[1], 10)
      const energyWh = parseInt(args[2], 10)
      const powerW = parseInt(args[3], 10)
      if (isNaN(connectorId) || isNaN(txId) || isNaN(energyWh) || isNaN(powerW)) {
        return { error: 'All arguments must be numbers' }
      }
      const message = createMeterValues(connectorId, txId, { energyWh, powerW })
      return {
        action: 'MeterValues',
        message,
        outgoing: `MeterValues: connector=${connectorId} txId=${txId} energy=${energyWh}Wh power=${powerW}W`
      }
    }

    case 'data': {
      if (args.length < 1) {
        return { error: 'Usage: data <vendorId> [messageId] [data]' }
      }
      const vendorId = args[0]
      const messageId = args[1]
      const data = args.slice(2).join(' ') || undefined
      const message = createDataTransfer({ vendorId, messageId, data })
      return {
        action: 'DataTransfer',
        message,
        outgoing: `DataTransfer: vendorId=${vendorId}${messageId ? ` messageId=${messageId}` : ''}`
      }
    }

    default:
      return { error: `Unknown command: ${command}. Valid commands: boot, heartbeat, status, authorize, start, stop, meter, data` }
  }
}

/** Type guard to distinguish CommandError from CommandResult. */
export function isCommandError(result: CommandResult | CommandError): result is CommandError {
  return 'error' in result
}

/** Formatted CALLRESULT with optional side-effect instructions for the caller. */
export interface CallResultFormatted {
  /** Human-readable response string */
  response: string
  /** If set, caller should start heartbeat at this interval (seconds) */
  startHeartbeat?: number
  /** If set, caller should update charger transactionId (null = clear) */
  transactionId?: number | null
}

/**
 * Format an OCPP CALLRESULT payload into a human-readable string and extract
 * side-effect instructions (heartbeat start, transactionId updates).
 *
 * @param action - The OCPP action name that was originally sent
 * @param payload - The CALLRESULT payload from the server
 * @returns Formatted response with optional side-effect flags
 */
export function formatCallResult(
  action: string,
  payload: Record<string, unknown>
): CallResultFormatted {
  switch (action) {
    case 'BootNotification': {
      const status = payload.status as string
      const interval = payload.interval as number
      const result: CallResultFormatted = {
        response: `BootNotification: status=${status} interval=${interval}s`
      }
      if (status === 'Accepted' && interval > 0) {
        result.startHeartbeat = interval
      }
      return result
    }
    case 'Heartbeat': {
      const time = payload.currentTime as string
      return { response: `Heartbeat: serverTime=${time}` }
    }
    case 'StatusNotification': {
      return { response: 'StatusNotification: accepted' }
    }
    case 'Authorize': {
      const idTagInfo = payload.idTagInfo as Record<string, unknown>
      return { response: `Authorize: status=${idTagInfo?.status}` }
    }
    case 'StartTransaction': {
      const txId = payload.transactionId as number
      const idTagInfo = payload.idTagInfo as Record<string, unknown>
      return {
        response: `StartTransaction: transactionId=${txId} status=${idTagInfo?.status}`,
        transactionId: txId
      }
    }
    case 'StopTransaction': {
      const idTagInfo = payload.idTagInfo as Record<string, unknown> | undefined
      return {
        response: `StopTransaction: status=${idTagInfo?.status ?? 'accepted'}`,
        transactionId: null
      }
    }
    case 'MeterValues': {
      return { response: 'MeterValues: accepted' }
    }
    case 'DataTransfer': {
      const status = payload.status as string
      const data = payload.data as string | undefined
      return { response: `DataTransfer: status=${status}${data ? ` data=${data}` : ''}` }
    }
    default: {
      return { response: `${action}: ${JSON.stringify(payload)}` }
    }
  }
}
