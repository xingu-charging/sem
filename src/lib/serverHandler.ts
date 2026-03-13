/**
 * @file Server message dispatcher — routes incoming server-initiated OCPP actions
 * to the appropriate response builder and sends the reply. When side effects are
 * enabled (autoCharge mode), commands like RemoteStart/Stop, Reset, TriggerMessage,
 * and ChangeAvailability execute real state transitions and message sequences.
 * @module @xingu-charging/sem
 * @license MIT
 *
 * Copyright (c) 2026 Xingu Charging
 * https://github.com/xingu-charging/sem
 */

import { OcppConnection } from '../ocpp/connection.js'
import type {
  OcppCallMessage,
  GetConfigurationRequest,
  ChangeConfigurationRequest,
  ResetRequest,
  RemoteStartTransactionRequest,
  RemoteStopTransactionRequest,
  TriggerMessageRequest,
  GetDiagnosticsRequest,
  UpdateFirmwareRequest,
  ChangeAvailabilityRequest,
  UnlockConnectorRequest,
  SetChargingProfileRequest,
  ReserveNowRequest,
  CancelReservationRequest,
  ChargePointStatus
} from '../ocpp/types.js'
import {
  createGetConfigurationResponse,
  validateChangeConfiguration,
  createChangeConfigurationResponse,
  createResetResponse,
  createRemoteStartTransactionResponse,
  createRemoteStopTransactionResponse,
  createTriggerMessageResponse,
  createGetDiagnosticsResponse,
  createUpdateFirmwareResponse,
  createChangeAvailabilityResponse,
  createClearCacheResponse,
  createUnlockConnectorResponse,
  createDataTransferResponse,
  createCallError,
  createSetChargingProfileResponse,
  createReserveNowResponse,
  createCancelReservationResponse
} from '../ocpp/serverMessages.js'
import type { DataTransferRequest } from '../ocpp/serverMessages.js'
import {
  createBootNotification,
  createHeartbeat,
  createStatusNotification,
  createMeterValues,
  createDiagnosticsStatusNotification,
  createFirmwareStatusNotification
} from '../ocpp/messages.js'
import {
  type LoadedCharger,
  applyConfigChange,
  setConnectorStatus,
  addChargingProfile,
  addReservation,
  removeReservation,
  getReservation
} from './charger.js'
import {
  startChargeSession,
  stopChargeSession,
  getActiveSession,
  findSessionByTransactionId,
  type SendAndWaitFn,
  type ChargeLogFn
} from './chargeSession.js'
import * as output from './output.js'

/** Configuration for server handler side effects. */
export interface ServerHandlerConfig {
  /** When true, RemoteStart triggers full charge flow, Reset triggers reconnect, etc. */
  autoCharge: boolean
  /** SendAndWait function for sending messages and waiting for responses */
  sendAndWait?: SendAndWaitFn
  /** Logger function for side effect events */
  log?: ChargeLogFn
}

/** Default config: no side effects (legacy behavior) */
const defaultConfig: ServerHandlerConfig = {
  autoCharge: false
}

/** Active handler config, set via setServerHandlerConfig() */
let handlerConfig: ServerHandlerConfig = { ...defaultConfig }

/** Configure server handler behavior. Call this to enable auto-charge mode. */
export function setServerHandlerConfig(config: ServerHandlerConfig): void {
  handlerConfig = config
}

/** Get the current server handler config. */
export function getServerHandlerConfig(): ServerHandlerConfig {
  return handlerConfig
}

/**
 * Dispatch and respond to a server-initiated OCPP message.
 *
 * Receives a CALL from the Central System, builds the appropriate CALLRESULT
 * (or CALLERROR for unsupported actions), sends it back, and logs the event.
 * When autoCharge is enabled, triggers side effects (charge flows, reconnects, etc.).
 *
 * @param connection - Active OCPP WebSocket connection
 * @param messageId - The CALL messageId to correlate the response
 * @param action - The OCPP action name (e.g., 'GetConfiguration', 'Reset')
 * @param payload - The CALL payload from the server
 * @param charger - Loaded charger with config and state
 */
export async function handleServerMessage(
  connection: OcppConnection,
  messageId: string,
  action: string,
  payload: Record<string, unknown>,
  charger: LoadedCharger
): Promise<void> {
  switch (action) {
    case 'GetConfiguration': {
      const request = payload as unknown as GetConfigurationRequest
      const response = createGetConfigurationResponse(messageId, request, charger.config)
      await connection.send(response)
      const keyCount = request.key?.length ?? 'all'
      output.serverInitiated('GetConfiguration', `requested ${keyCount} keys`)
      break
    }

    case 'ChangeConfiguration': {
      const request = payload as unknown as ChangeConfigurationRequest
      const result = validateChangeConfiguration(request, charger.config)
      const response = createChangeConfigurationResponse(messageId, result.status)
      await connection.send(response)
      if (result.shouldSave) {
        applyConfigChange(charger, request.key, request.value)
      }
      output.serverInitiated('ChangeConfiguration', `${request.key}=${request.value} -> ${result.status}`)
      break
    }

    case 'Reset': {
      const request = payload as unknown as ResetRequest
      const response = createResetResponse(messageId, 'Accepted')
      await connection.send(response)
      output.serverInitiated('Reset', `type=${request.type}`)

      if (handlerConfig.autoCharge) {
        void executeReset(connection, charger, request.type === 'Hard')
      }
      break
    }

    case 'RemoteStartTransaction': {
      const request = payload as unknown as RemoteStartTransactionRequest
      const response = createRemoteStartTransactionResponse(messageId, 'Accepted')
      await connection.send(response)
      output.serverInitiated('RemoteStartTransaction', `connector=${request.connectorId ?? 'any'} idTag=${request.idTag}`)

      if (handlerConfig.autoCharge && handlerConfig.sendAndWait) {
        const connectorId = request.connectorId ?? 1
        const log = handlerConfig.log ?? ((msg: string) => output.info(`[auto] ${msg}`))

        // Check AuthorizeRemoteTxRequests — when false, skip Authorize for remote starts
        const authorizeRemoteTx = charger.config.ocppConfiguration?.['AuthorizeRemoteTxRequests']
        const skipAuthorize = authorizeRemoteTx === 'false'

        try {
          const session = startChargeSession(connection, charger, handlerConfig.sendAndWait, log, {
            connectorId,
            idTag: request.idTag,
            duration: 0, // Run until stopped externally (RemoteStop, app, console)
            powerW: charger.config.capabilities?.maxPower ?? 7000,
            meterInterval: 30,
            meterStart: 0,
            skipAuthorize
          })
          session.completion.catch((err) => {
            log(`Remote start charge session error: ${err}`)
          })
        } catch (err) {
          const logFn = handlerConfig.log ?? ((msg: string) => output.info(`[auto] ${msg}`))
          logFn(`Failed to start charge session: ${err instanceof Error ? err.message : err}`)
        }
      }
      break
    }

    case 'RemoteStopTransaction': {
      const request = payload as unknown as RemoteStopTransactionRequest
      const response = createRemoteStopTransactionResponse(messageId, 'Accepted')
      await connection.send(response)
      output.serverInitiated('RemoteStopTransaction', `transactionId=${request.transactionId}`)

      if (handlerConfig.autoCharge && handlerConfig.sendAndWait) {
        const log = handlerConfig.log ?? ((msg: string) => output.info(`[auto] ${msg}`))
        const txId = Number(request.transactionId)
        const match = findSessionByTransactionId(txId)

        if (match) {
          await stopChargeSession(charger.chargerId, match.connectorId, connection, charger, handlerConfig.sendAndWait, log, 'Remote')
        } else {
          log(`No active session found for transactionId=${txId}`)
        }
      }
      break
    }

    case 'TriggerMessage': {
      const request = payload as unknown as TriggerMessageRequest
      const response = createTriggerMessageResponse(messageId, 'Accepted')
      await connection.send(response)
      output.serverInitiated('TriggerMessage', `requested=${request.requestedMessage}`)

      // Actually send the triggered message
      await executeTriggerMessage(connection, charger, request.requestedMessage, request.connectorId)
      break
    }

    case 'GetDiagnostics': {
      const request = payload as unknown as GetDiagnosticsRequest
      const fileName = `diagnostics-${charger.chargerId}-${Date.now()}.log`
      const response = createGetDiagnosticsResponse(messageId, fileName)
      await connection.send(response)
      output.serverInitiated('GetDiagnostics', `location=${request.location}`)

      if (handlerConfig.autoCharge) {
        void executeDiagnosticsFlow(connection)
      }
      break
    }

    case 'UpdateFirmware': {
      const request = payload as unknown as UpdateFirmwareRequest
      const response = createUpdateFirmwareResponse(messageId)
      await connection.send(response)
      output.serverInitiated('UpdateFirmware', `location=${request.location}`)

      if (handlerConfig.autoCharge) {
        void executeFirmwareUpdateFlow(connection, charger)
      }
      break
    }

    case 'ChangeAvailability': {
      const request = payload as unknown as ChangeAvailabilityRequest
      const response = createChangeAvailabilityResponse(messageId, 'Accepted')
      await connection.send(response)
      output.serverInitiated('ChangeAvailability', `connector=${request.connectorId} type=${request.type}`)

      // Always execute the status change
      const newStatus: ChargePointStatus = request.type === 'Inoperative' ? 'Unavailable' : 'Available'
      const statusMsg = createStatusNotification(request.connectorId, newStatus)
      await connection.send(statusMsg)
      setConnectorStatus(charger, request.connectorId, newStatus)
      output.outgoing('StatusNotification', `connector=${request.connectorId} status=${newStatus}`)
      break
    }

    case 'ClearCache': {
      const response = createClearCacheResponse(messageId, 'Accepted')
      await connection.send(response)
      output.serverInitiated('ClearCache', 'accepted')
      break
    }

    case 'UnlockConnector': {
      const request = payload as unknown as UnlockConnectorRequest
      const response = createUnlockConnectorResponse(messageId, 'Unlocked')
      await connection.send(response)
      output.serverInitiated('UnlockConnector', `connector=${request.connectorId}`)
      break
    }

    case 'DataTransfer': {
      const request = payload as unknown as DataTransferRequest
      const response = createDataTransferResponse(messageId, 'Accepted')
      await connection.send(response)
      output.serverInitiated('DataTransfer', `vendorId=${request.vendorId}${request.messageId ? ` messageId=${request.messageId}` : ''}`)
      break
    }

    case 'SetChargingProfile': {
      const request = payload as unknown as SetChargingProfileRequest
      addChargingProfile(charger, request.connectorId, request.csChargingProfiles)
      const response = createSetChargingProfileResponse(messageId, 'Accepted')
      await connection.send(response)
      output.serverInitiated('SetChargingProfile', `connector=${request.connectorId} profileId=${request.csChargingProfiles.chargingProfileId} purpose=${request.csChargingProfiles.chargingProfilePurpose}`)
      break
    }

    case 'ReserveNow': {
      const request = payload as unknown as ReserveNowRequest
      const connectorStatus = charger.state.connectorStates.get(request.connectorId)

      // Check if connector is available for reservation
      if (connectorStatus !== 'Available') {
        const status = connectorStatus === 'Faulted' ? 'Faulted' as const : 'Occupied' as const
        const response = createReserveNowResponse(messageId, status)
        await connection.send(response)
        output.serverInitiated('ReserveNow', `connector=${request.connectorId} -> ${status} (connector not available)`)
        break
      }

      // Store reservation and update status
      addReservation(charger, {
        reservationId: request.reservationId,
        connectorId: request.connectorId,
        idTag: request.idTag,
        expiryDate: request.expiryDate,
        parentIdTag: request.parentIdTag
      })
      const response = createReserveNowResponse(messageId, 'Accepted')
      await connection.send(response)

      // Send StatusNotification Reserved
      const statusMsg = createStatusNotification(request.connectorId, 'Reserved')
      await connection.send(statusMsg)
      setConnectorStatus(charger, request.connectorId, 'Reserved')
      output.serverInitiated('ReserveNow', `connector=${request.connectorId} reservationId=${request.reservationId} idTag=${request.idTag}`)
      output.outgoing('StatusNotification', `connector=${request.connectorId} status=Reserved`)
      break
    }

    case 'CancelReservation': {
      const request = payload as unknown as CancelReservationRequest
      const reservation = getReservation(charger, request.reservationId)

      if (!reservation) {
        const response = createCancelReservationResponse(messageId, 'Rejected')
        await connection.send(response)
        output.serverInitiated('CancelReservation', `reservationId=${request.reservationId} -> Rejected (not found)`)
        break
      }

      removeReservation(charger, request.reservationId)
      const response = createCancelReservationResponse(messageId, 'Accepted')
      await connection.send(response)

      // Send StatusNotification Available
      const statusMsg = createStatusNotification(reservation.connectorId, 'Available')
      await connection.send(statusMsg)
      setConnectorStatus(charger, reservation.connectorId, 'Available')
      output.serverInitiated('CancelReservation', `reservationId=${request.reservationId} connector=${reservation.connectorId}`)
      output.outgoing('StatusNotification', `connector=${reservation.connectorId} status=Available`)
      break
    }

    default: {
      const errorResponse = createCallError(
        messageId,
        'NotImplemented',
        `Action "${action}" is not supported`
      )
      await connection.send(errorResponse)
      output.serverInitiated(action, 'not implemented (CALLERROR sent)')
      break
    }
  }
}

// =============================================================================
// Side Effect Executors
// =============================================================================

/** Execute a TriggerMessage by actually sending the requested message. */
async function executeTriggerMessage(
  connection: OcppConnection,
  charger: LoadedCharger,
  requestedMessage: string,
  connectorId?: number
): Promise<void> {
  let message: OcppCallMessage

  switch (requestedMessage) {
    case 'BootNotification': {
      const identity = charger.config.identity
      message = createBootNotification({
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
      break
    }
    case 'Heartbeat': {
      message = createHeartbeat()
      break
    }
    case 'StatusNotification': {
      const connId = connectorId ?? 1
      const status = charger.state.connectorStates.get(connId) ?? 'Available'
      message = createStatusNotification(connId, status)
      break
    }
    case 'MeterValues': {
      const connId = connectorId ?? 1
      const txId = charger.state.transactionId ?? undefined
      message = createMeterValues(connId, txId, { energyWh: 0, powerW: 0 })
      break
    }
    case 'DiagnosticsStatusNotification': {
      message = createDiagnosticsStatusNotification('Idle')
      break
    }
    case 'FirmwareStatusNotification': {
      message = createFirmwareStatusNotification('Idle')
      break
    }
    default: {
      output.error(`TriggerMessage: unknown message type "${requestedMessage}"`)
      return
    }
  }

  await connection.send(message)
  output.outgoing(requestedMessage, `triggered ${requestedMessage}`)
}

/** Execute a Reset by disconnecting, waiting, and reconnecting with a boot sequence. */
async function executeReset(
  connection: OcppConnection,
  charger: LoadedCharger,
  isHard: boolean
): Promise<void> {
  const log = handlerConfig.log ?? ((msg: string) => output.info(`[reset] ${msg}`))
  const delayMs = isHard ? 5000 : 2000

  log(`${isHard ? 'Hard' : 'Soft'} reset: disconnecting in ${delayMs / 1000}s...`)

  // Stop any active sessions
  for (const [connId] of charger.state.connectorStates) {
    const session = getActiveSession(charger.chargerId, connId)
    if (session && handlerConfig.sendAndWait) {
      await stopChargeSession(charger.chargerId, connId, connection, charger, handlerConfig.sendAndWait, log, 'Local')
    }
  }

  await delay(delayMs)

  // Disconnect and reconnect
  log('Disconnecting...')
  await connection.disconnect()

  await delay(1000)

  log('Reconnecting...')
  try {
    await connection.connect({
      url: charger.url,
      protocol: charger.protocol,
      auth: charger.auth
    })

    // Re-send BootNotification
    const identity = charger.config.identity
    const bootMsg = createBootNotification({
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
    await connection.send(bootMsg)
    output.outgoing('BootNotification', `vendor=${identity.vendor} model=${identity.model}`)

    // Send StatusNotification for all connectors
    const connectorCount = charger.config.connectors?.length ?? 1
    for (let i = 1; i <= connectorCount; i++) {
      const statusMsg = createStatusNotification(i, 'Available')
      await connection.send(statusMsg)
      setConnectorStatus(charger, i, 'Available')
      output.outgoing('StatusNotification', `connector=${i} status=Available`)
    }

    log('Reset complete')
  } catch (err) {
    log(`Reset reconnection failed: ${err instanceof Error ? err.message : err}`)
  }
}

/** Execute a firmware update flow with status notifications. */
async function executeFirmwareUpdateFlow(
  connection: OcppConnection,
  charger: LoadedCharger
): Promise<void> {
  const log = handlerConfig.log ?? ((msg: string) => output.info(`[firmware] ${msg}`))

  await delay(2000)
  log('Downloading firmware...')
  const downloadingMsg = createFirmwareStatusNotification('Downloading')
  await connection.send(downloadingMsg)
  output.outgoing('FirmwareStatusNotification', 'status=Downloading')

  await delay(5000)
  log('Firmware downloaded')
  const downloadedMsg = createFirmwareStatusNotification('Downloaded')
  await connection.send(downloadedMsg)
  output.outgoing('FirmwareStatusNotification', 'status=Downloaded')

  await delay(3000)
  log('Installing firmware...')
  const installingMsg = createFirmwareStatusNotification('Installing')
  await connection.send(installingMsg)
  output.outgoing('FirmwareStatusNotification', 'status=Installing')

  await delay(3000)
  log('Firmware installed')
  const installedMsg = createFirmwareStatusNotification('Installed')
  await connection.send(installedMsg)
  output.outgoing('FirmwareStatusNotification', 'status=Installed')

  // Reboot after install
  log('Rebooting after firmware install...')
  await executeReset(connection, charger, false)
}

/** Execute a diagnostics upload flow with status notifications. */
async function executeDiagnosticsFlow(
  connection: OcppConnection
): Promise<void> {
  const log = handlerConfig.log ?? ((msg: string) => output.info(`[diagnostics] ${msg}`))

  await delay(2000)
  log('Uploading diagnostics...')
  const uploadingMsg = createDiagnosticsStatusNotification('Uploading')
  await connection.send(uploadingMsg)
  output.outgoing('DiagnosticsStatusNotification', 'status=Uploading')

  await delay(5000)
  log('Diagnostics uploaded')
  const uploadedMsg = createDiagnosticsStatusNotification('Uploaded')
  await connection.send(uploadedMsg)
  output.outgoing('DiagnosticsStatusNotification', 'status=Uploaded')
}

/** Simple delay helper. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
