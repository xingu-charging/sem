/**
 * @file Server message dispatcher — routes incoming server-initiated OCPP actions
 * to the appropriate response builder and sends the reply. Handles GetConfiguration,
 * ChangeConfiguration, Reset, RemoteStart/StopTransaction, TriggerMessage, and more.
 * @module @xingu-charging/sem
 * @license MIT
 *
 * Copyright (c) 2026 Xingu Charging
 * https://github.com/xingu-charging/sem
 */

import { OcppConnection } from '../ocpp/connection.js'
import type {
  GetConfigurationRequest,
  ChangeConfigurationRequest,
  ResetRequest,
  RemoteStartTransactionRequest,
  RemoteStopTransactionRequest,
  TriggerMessageRequest,
  GetDiagnosticsRequest,
  UpdateFirmwareRequest,
  ChangeAvailabilityRequest,
  UnlockConnectorRequest
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
  createCallError
} from '../ocpp/serverMessages.js'
import type { DataTransferRequest } from '../ocpp/serverMessages.js'
import { type LoadedCharger, applyConfigChange } from './charger.js'
import * as output from './output.js'

/**
 * Dispatch and respond to a server-initiated OCPP message.
 *
 * Receives a CALL from the Central System, builds the appropriate CALLRESULT
 * (or CALLERROR for unsupported actions), sends it back, and logs the event.
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
      break
    }

    case 'RemoteStartTransaction': {
      const request = payload as unknown as RemoteStartTransactionRequest
      const response = createRemoteStartTransactionResponse(messageId, 'Accepted')
      await connection.send(response)
      output.serverInitiated('RemoteStartTransaction', `connector=${request.connectorId ?? 'any'} idTag=${request.idTag}`)
      break
    }

    case 'RemoteStopTransaction': {
      const request = payload as unknown as RemoteStopTransactionRequest
      const response = createRemoteStopTransactionResponse(messageId, 'Accepted')
      await connection.send(response)
      output.serverInitiated('RemoteStopTransaction', `transactionId=${request.transactionId}`)
      break
    }

    case 'TriggerMessage': {
      const request = payload as unknown as TriggerMessageRequest
      const response = createTriggerMessageResponse(messageId, 'Accepted')
      await connection.send(response)
      output.serverInitiated('TriggerMessage', `requested=${request.requestedMessage}`)
      break
    }

    case 'GetDiagnostics': {
      const request = payload as unknown as GetDiagnosticsRequest
      const fileName = `diagnostics-${charger.chargerId}-${Date.now()}.log`
      const response = createGetDiagnosticsResponse(messageId, fileName)
      await connection.send(response)
      output.serverInitiated('GetDiagnostics', `location=${request.location}`)
      break
    }

    case 'UpdateFirmware': {
      const request = payload as unknown as UpdateFirmwareRequest
      const response = createUpdateFirmwareResponse(messageId)
      await connection.send(response)
      output.serverInitiated('UpdateFirmware', `location=${request.location}`)
      break
    }

    case 'ChangeAvailability': {
      const request = payload as unknown as ChangeAvailabilityRequest
      const response = createChangeAvailabilityResponse(messageId, 'Accepted')
      await connection.send(response)
      output.serverInitiated('ChangeAvailability', `connector=${request.connectorId} type=${request.type}`)
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
