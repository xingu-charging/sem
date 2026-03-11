/**
 * Server-Initiated Message Handlers
 *
 * This module handles OCPP messages initiated by the Central System (server)
 * and sent to the Charge Point (charger simulator). The charger must respond
 * with appropriate CALLRESULT messages.
 *
 * Flow: Server sends CALL [2, messageId, action, payload]
 *       Charger responds with CALLRESULT [3, messageId, responsePayload]
 */

import {
  MessageType,
  OcppCallResultMessage,
  GetConfigurationRequest,
  GetConfigurationResponse,
  ConfigurationKeyValue,
  ChangeConfigurationRequest,
  ConfigurationStatus,
  ResetStatus
} from './types.js'

// =============================================================================
// Charger Configuration Interface (from renderer types)
// =============================================================================

interface ChargerCapabilities {
  maxPower: number
  phases?: number
  voltage?: number
  maxCurrent?: number
  supportedProtocols?: string[]
  features?: string[]
}

interface ChargerConnector {
  connectorId: number
  type: string
  format: string
  powerType: string
  maxPower: number
  maxVoltage: number
  maxAmperage: number
}

interface MeterValueConfig {
  sampleInterval: number
  measurands: string[]
}

interface ChargerIdentity {
  vendor: string
  model: string
  serialNumber: string
  firmwareVersion: string
  chargeBoxSerialNumber?: string
  iccid?: string
  imsi?: string
  meterType?: string
  meterSerialNumber?: string
}

// User-configured OCPP configuration key values (RW keys)
interface OcppConfiguration {
  [key: string]: string
}

export interface ChargerConfig {
  identity: ChargerIdentity
  capabilities?: ChargerCapabilities
  connectors?: ChargerConnector[]
  meterValueConfig?: MeterValueConfig
  ocppConfiguration?: OcppConfiguration
}

// =============================================================================
// Configuration Value Builders
// =============================================================================

/**
 * Helper to get a configuration value, checking user-configured ocppConfiguration first
 */
function getConfigValue(
  config: ChargerConfig,
  key: string,
  defaultValue: string
): string {
  if (config.ocppConfiguration && config.ocppConfiguration[key] !== undefined) {
    return config.ocppConfiguration[key]
  }
  return defaultValue
}

/**
 * Build configuration key values based on charger configuration
 * Maps charger capabilities to OCPP configuration keys
 * User-configured values from ocppConfiguration take precedence over defaults
 */
export function buildConfigurationKeys(config: ChargerConfig): ConfigurationKeyValue[] {
  const keys: ConfigurationKeyValue[] = []

  const numberOfConnectors = config.connectors?.length ?? 1
  keys.push({
    key: 'NumberOfConnectors',
    readonly: true,
    value: String(numberOfConnectors)
  })

  keys.push({
    key: 'HeartbeatInterval',
    readonly: false,
    value: getConfigValue(config, 'HeartbeatInterval', '300')
  })

  keys.push({
    key: 'ConnectionTimeOut',
    readonly: false,
    value: getConfigValue(config, 'ConnectionTimeOut', '30')
  })

  const meterSampleInterval = config.meterValueConfig?.sampleInterval ?? 60
  keys.push({
    key: 'MeterValueSampleInterval',
    readonly: false,
    value: getConfigValue(config, 'MeterValueSampleInterval', String(meterSampleInterval))
  })

  const measurands = config.meterValueConfig?.measurands ?? [
    'Energy.Active.Import.Register',
    'Power.Active.Import'
  ]
  keys.push({
    key: 'MeterValuesSampledData',
    readonly: false,
    value: getConfigValue(config, 'MeterValuesSampledData', measurands.join(','))
  })

  keys.push({
    key: 'MeterValuesSampledDataMaxLength',
    readonly: true,
    value: '8'
  })

  const rawFeatures = config.capabilities?.features ?? []

  const normalizeFeature = (feature: string): string => {
    const mapping: Record<string, string> = {
      'TriggerMessage': 'RemoteTrigger',
      'RemoteStartStopTransaction': 'RemoteTrigger',
      'LocalAuthList': 'LocalAuthListManagement',
      'ChargingProfile': 'SmartCharging'
    }
    return mapping[feature] || feature
  }

  const features = rawFeatures.map(normalizeFeature)
  const profiles: string[] = ['Core']

  if (features.includes('RemoteTrigger')) {
    profiles.push('RemoteTrigger')
  }
  if (features.includes('SmartCharging')) {
    profiles.push('SmartCharging')
  }
  if (features.includes('LocalAuthListManagement')) {
    profiles.push('LocalAuthListManagement')
  }
  if (features.includes('Reservation')) {
    profiles.push('Reservation')
  }
  if (features.includes('FirmwareManagement')) {
    profiles.push('FirmwareManagement')
  }

  keys.push({
    key: 'SupportedFeatureProfiles',
    readonly: true,
    value: profiles.join(',')
  })

  if (config.connectors && config.connectors.length > 0) {
    const phaseRotations = config.connectors.map((c) => {
      const phases = config.capabilities?.phases ?? 3
      if (c.powerType === 'DC') {
        return `${c.connectorId}.NotApplicable`
      }
      if (phases === 1 || c.powerType === 'AC_1_PHASE') {
        return `${c.connectorId}.NotApplicable`
      }
      return `${c.connectorId}.RST`
    })
    keys.push({
      key: 'ConnectorPhaseRotation',
      readonly: true,
      value: phaseRotations.join(',')
    })
  }

  keys.push({
    key: 'ConnectorPhaseRotationMaxLength',
    readonly: true,
    value: String(numberOfConnectors)
  })

  keys.push({
    key: 'AuthorizeRemoteTxRequests',
    readonly: false,
    value: getConfigValue(config, 'AuthorizeRemoteTxRequests', 'true')
  })

  keys.push({
    key: 'LocalAuthorizeOffline',
    readonly: false,
    value: getConfigValue(config, 'LocalAuthorizeOffline', 'true')
  })

  keys.push({
    key: 'LocalPreAuthorize',
    readonly: false,
    value: getConfigValue(config, 'LocalPreAuthorize', 'false')
  })

  keys.push({
    key: 'AllowOfflineTxForUnknownId',
    readonly: false,
    value: getConfigValue(config, 'AllowOfflineTxForUnknownId', 'false')
  })

  keys.push({
    key: 'StopTransactionOnEVSideDisconnect',
    readonly: false,
    value: getConfigValue(config, 'StopTransactionOnEVSideDisconnect', 'true')
  })

  keys.push({
    key: 'StopTransactionOnInvalidId',
    readonly: false,
    value: getConfigValue(config, 'StopTransactionOnInvalidId', 'true')
  })

  keys.push({
    key: 'UnlockConnectorOnEVSideDisconnect',
    readonly: false,
    value: getConfigValue(config, 'UnlockConnectorOnEVSideDisconnect', 'true')
  })

  keys.push({
    key: 'TransactionMessageAttempts',
    readonly: false,
    value: getConfigValue(config, 'TransactionMessageAttempts', '3')
  })

  keys.push({
    key: 'TransactionMessageRetryInterval',
    readonly: false,
    value: getConfigValue(config, 'TransactionMessageRetryInterval', '60')
  })

  keys.push({
    key: 'ClockAlignedDataInterval',
    readonly: false,
    value: getConfigValue(config, 'ClockAlignedDataInterval', '0')
  })

  keys.push({
    key: 'MeterValuesAlignedData',
    readonly: false,
    value: getConfigValue(config, 'MeterValuesAlignedData', '')
  })

  keys.push({
    key: 'MeterValuesAlignedDataMaxLength',
    readonly: true,
    value: '8'
  })

  keys.push({
    key: 'StopTxnSampledData',
    readonly: false,
    value: getConfigValue(config, 'StopTxnSampledData', measurands.join(','))
  })

  keys.push({
    key: 'StopTxnSampledDataMaxLength',
    readonly: true,
    value: '8'
  })

  keys.push({
    key: 'StopTxnAlignedData',
    readonly: false,
    value: getConfigValue(config, 'StopTxnAlignedData', '')
  })

  keys.push({
    key: 'StopTxnAlignedDataMaxLength',
    readonly: true,
    value: '8'
  })

  keys.push({
    key: 'ResetRetries',
    readonly: false,
    value: getConfigValue(config, 'ResetRetries', '3')
  })

  keys.push({
    key: 'GetConfigurationMaxKeys',
    readonly: true,
    value: '50'
  })

  keys.push({
    key: 'WebSocketPingInterval',
    readonly: false,
    value: getConfigValue(config, 'WebSocketPingInterval', '60')
  })

  if (features.includes('LocalAuthListManagement')) {
    keys.push({
      key: 'LocalAuthListEnabled',
      readonly: false,
      value: getConfigValue(config, 'LocalAuthListEnabled', 'true')
    })
    keys.push({
      key: 'LocalAuthListMaxLength',
      readonly: true,
      value: '1000'
    })
    keys.push({
      key: 'SendLocalListMaxLength',
      readonly: true,
      value: '100'
    })
  }

  if (features.includes('Reservation')) {
    keys.push({
      key: 'ReserveConnectorZeroSupported',
      readonly: true,
      value: 'false'
    })
  }

  if (features.includes('SmartCharging')) {
    keys.push({
      key: 'ChargeProfileMaxStackLevel',
      readonly: true,
      value: '3'
    })
    keys.push({
      key: 'ChargingScheduleAllowedChargingRateUnit',
      readonly: true,
      value: 'A,W'
    })
    keys.push({
      key: 'ChargingScheduleMaxPeriods',
      readonly: true,
      value: '24'
    })
    keys.push({
      key: 'MaxChargingProfilesInstalled',
      readonly: true,
      value: '10'
    })

    const hasThreePhaseAC = config.connectors?.some(
      (c) => c.powerType === 'AC_3_PHASE'
    )
    if (hasThreePhaseAC && config.capabilities?.phases === 3) {
      keys.push({
        key: 'ConnectorSwitch3to1PhaseSupported',
        readonly: true,
        value: 'false'
      })
    }
  }

  keys.push({
    key: 'MinimumStatusDuration',
    readonly: false,
    value: getConfigValue(config, 'MinimumStatusDuration', '0')
  })

  keys.push({
    key: 'MaxEnergyOnInvalidId',
    readonly: false,
    value: getConfigValue(config, 'MaxEnergyOnInvalidId', '0')
  })

  keys.push({
    key: 'LightIntensity',
    readonly: false,
    value: getConfigValue(config, 'LightIntensity', '100')
  })

  keys.push({
    key: 'BlinkRepeat',
    readonly: false,
    value: getConfigValue(config, 'BlinkRepeat', '3')
  })

  keys.push({
    key: 'AuthorizationCacheEnabled',
    readonly: false,
    value: getConfigValue(config, 'AuthorizationCacheEnabled', 'false')
  })

  return keys
}

// =============================================================================
// GetConfiguration Response Builder
// =============================================================================

/**
 * Build GetConfiguration response based on charger configuration
 */
export function createGetConfigurationResponse(
  messageId: string,
  request: GetConfigurationRequest,
  chargerConfig: ChargerConfig
): OcppCallResultMessage {
  const allKeys = buildConfigurationKeys(chargerConfig)
  const keyMap = new Map(allKeys.map((k) => [k.key, k]))

  let configurationKey: ConfigurationKeyValue[]
  let unknownKey: string[] | undefined

  if (request.key && request.key.length > 0) {
    configurationKey = []
    unknownKey = []

    for (const requestedKey of request.key) {
      const keyValue = keyMap.get(requestedKey)
      if (keyValue) {
        configurationKey.push(keyValue)
      } else {
        unknownKey.push(requestedKey)
      }
    }

    if (unknownKey.length === 0) {
      unknownKey = undefined
    }
  } else {
    configurationKey = allKeys
  }

  const response: GetConfigurationResponse = {
    configurationKey,
    unknownKey
  }

  return [MessageType.CALLRESULT, messageId, response as Record<string, unknown>]
}

// =============================================================================
// Generic CALLRESULT Builder
// =============================================================================

/**
 * Create a generic CALLRESULT message
 */
export function createCallResult(
  messageId: string,
  payload: Record<string, unknown>
): OcppCallResultMessage {
  return [MessageType.CALLRESULT, messageId, payload]
}

/**
 * Create a CALLERROR message for unsupported actions
 */
export function createCallError(
  messageId: string,
  errorCode: string,
  errorDescription: string,
  errorDetails: Record<string, unknown> = {}
): [typeof MessageType.CALLERROR, string, string, string, Record<string, unknown>] {
  return [MessageType.CALLERROR, messageId, errorCode, errorDescription, errorDetails]
}

// =============================================================================
// ChangeConfiguration Response Builder
// =============================================================================

/**
 * Result of validating and applying a configuration change
 */
export interface ChangeConfigurationResult {
  status: ConfigurationStatus
  shouldSave: boolean
}

/**
 * Validate and determine the status for a ChangeConfiguration request
 */
export function validateChangeConfiguration(
  request: ChangeConfigurationRequest,
  chargerConfig: ChargerConfig
): ChangeConfigurationResult {
  const { key, value } = request

  const allKeys = buildConfigurationKeys(chargerConfig)
  const keyInfo = allKeys.find((k) => k.key === key)

  if (!keyInfo) {
    return { status: 'NotSupported', shouldSave: false }
  }

  if (keyInfo.readonly) {
    return { status: 'Rejected', shouldSave: false }
  }

  const numericKeys = [
    'HeartbeatInterval',
    'ConnectionTimeOut',
    'MeterValueSampleInterval',
    'TransactionMessageAttempts',
    'TransactionMessageRetryInterval',
    'ClockAlignedDataInterval',
    'ResetRetries',
    'WebSocketPingInterval',
    'MinimumStatusDuration',
    'MaxEnergyOnInvalidId',
    'LightIntensity',
    'BlinkRepeat'
  ]

  if (numericKeys.includes(key)) {
    const numValue = parseInt(value, 10)
    if (isNaN(numValue) || numValue < 0) {
      return { status: 'Rejected', shouldSave: false }
    }
  }

  const booleanKeys = [
    'AuthorizeRemoteTxRequests',
    'LocalAuthorizeOffline',
    'LocalPreAuthorize',
    'AllowOfflineTxForUnknownId',
    'StopTransactionOnEVSideDisconnect',
    'StopTransactionOnInvalidId',
    'UnlockConnectorOnEVSideDisconnect',
    'LocalAuthListEnabled',
    'AuthorizationCacheEnabled'
  ]

  if (booleanKeys.includes(key)) {
    const lowerValue = value.toLowerCase()
    if (lowerValue !== 'true' && lowerValue !== 'false') {
      return { status: 'Rejected', shouldSave: false }
    }
  }

  return { status: 'Accepted', shouldSave: true }
}

/**
 * Create ChangeConfiguration response
 */
export function createChangeConfigurationResponse(
  messageId: string,
  status: ConfigurationStatus
): OcppCallResultMessage {
  return [MessageType.CALLRESULT, messageId, { status }]
}

// =============================================================================
// Reset Response Builder
// =============================================================================

/**
 * Create Reset response
 */
export function createResetResponse(
  messageId: string,
  status: ResetStatus
): OcppCallResultMessage {
  return [MessageType.CALLRESULT, messageId, { status }]
}

// =============================================================================
// RemoteStartTransaction Response Builder
// =============================================================================

export type RemoteStartStopStatus = 'Accepted' | 'Rejected'

/**
 * Create RemoteStartTransaction response
 */
export function createRemoteStartTransactionResponse(
  messageId: string,
  status: RemoteStartStopStatus
): OcppCallResultMessage {
  return [MessageType.CALLRESULT, messageId, { status }]
}

// =============================================================================
// RemoteStopTransaction Response Builder
// =============================================================================

/**
 * Create RemoteStopTransaction response
 */
export function createRemoteStopTransactionResponse(
  messageId: string,
  status: RemoteStartStopStatus
): OcppCallResultMessage {
  return [MessageType.CALLRESULT, messageId, { status }]
}

// =============================================================================
// TriggerMessage Response Builder
// =============================================================================

export type TriggerMessageStatus = 'Accepted' | 'Rejected' | 'NotImplemented'

/**
 * Create TriggerMessage response
 */
export function createTriggerMessageResponse(
  messageId: string,
  status: TriggerMessageStatus
): OcppCallResultMessage {
  return [MessageType.CALLRESULT, messageId, { status }]
}

// =============================================================================
// GetDiagnostics Response Builder
// =============================================================================

/**
 * Create GetDiagnostics response
 */
export function createGetDiagnosticsResponse(
  messageId: string,
  fileName?: string
): OcppCallResultMessage {
  const response: { fileName?: string } = {}
  if (fileName) {
    response.fileName = fileName
  }
  return [MessageType.CALLRESULT, messageId, response]
}

// =============================================================================
// UpdateFirmware Response Builder
// =============================================================================

/**
 * Create UpdateFirmware response
 */
export function createUpdateFirmwareResponse(
  messageId: string
): OcppCallResultMessage {
  return [MessageType.CALLRESULT, messageId, {}]
}

// =============================================================================
// ChangeAvailability Response Builder
// =============================================================================

export type AvailabilityStatus = 'Accepted' | 'Rejected' | 'Scheduled'

/**
 * Create ChangeAvailability response
 */
export function createChangeAvailabilityResponse(
  messageId: string,
  status: AvailabilityStatus
): OcppCallResultMessage {
  return [MessageType.CALLRESULT, messageId, { status }]
}

// =============================================================================
// ClearCache Response Builder
// =============================================================================

export type ClearCacheStatus = 'Accepted' | 'Rejected'

/**
 * Create ClearCache response
 */
export function createClearCacheResponse(
  messageId: string,
  status: ClearCacheStatus
): OcppCallResultMessage {
  return [MessageType.CALLRESULT, messageId, { status }]
}

// =============================================================================
// UnlockConnector Response Builder
// =============================================================================

export type UnlockStatus = 'Unlocked' | 'UnlockFailed' | 'NotSupported'

/**
 * Create UnlockConnector response
 */
export function createUnlockConnectorResponse(
  messageId: string,
  status: UnlockStatus
): OcppCallResultMessage {
  return [MessageType.CALLRESULT, messageId, { status }]
}

// =============================================================================
// DataTransfer Response Builder
// =============================================================================

export type DataTransferStatus = 'Accepted' | 'Rejected' | 'UnknownMessageId' | 'UnknownVendorId'

export interface DataTransferRequest {
  vendorId: string
  messageId?: string
  data?: string
}

export interface DataTransferResponseData {
  status: DataTransferStatus
  data?: string
}

/**
 * Create DataTransfer response
 */
export function createDataTransferResponse(
  messageId: string,
  status: DataTransferStatus,
  data?: string
): OcppCallResultMessage {
  const response: Record<string, unknown> = { status }
  if (data !== undefined) {
    response.data = data
  }
  return [MessageType.CALLRESULT, messageId, response]
}
