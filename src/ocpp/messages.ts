import {
  MessageType,
  OcppCallMessage,
  BootNotificationRequest,
  BootNotificationRequest201,
  HeartbeatRequest,
  StatusNotificationRequest,
  AuthorizeRequest,
  StartTransactionRequest,
  MeterValuesRequest,
  StopTransactionRequest,
  ChargePointStatus,
  ChargePointErrorCode,
  StopTransactionReason,
  SampledValue,
  DiagnosticsStatus,
  DiagnosticsStatusNotificationRequest,
  FirmwareStatus,
  FirmwareStatusNotificationRequest
} from './types.js'

// Generate unique message ID
export function generateMessageId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
}

// Create BootNotification message (OCPP 1.6)
export function createBootNotification(
  params: BootNotificationRequest
): OcppCallMessage {
  return [MessageType.CALL, generateMessageId(), 'BootNotification', params]
}

// Create BootNotification message (OCPP 2.0.1)
export function createBootNotification201(
  params: BootNotificationRequest201
): OcppCallMessage {
  return [MessageType.CALL, generateMessageId(), 'BootNotification', params]
}

// Create Heartbeat message
export function createHeartbeat(): OcppCallMessage {
  const params: HeartbeatRequest = {}
  return [MessageType.CALL, generateMessageId(), 'Heartbeat', params]
}

// Create StatusNotification message (OCPP 1.6)
export function createStatusNotification(
  connectorId: number,
  status: ChargePointStatus,
  errorCode: ChargePointErrorCode = 'NoError'
): OcppCallMessage {
  const params: StatusNotificationRequest = {
    connectorId,
    errorCode,
    status,
    timestamp: new Date().toISOString()
  }
  return [MessageType.CALL, generateMessageId(), 'StatusNotification', params]
}

// Create Authorize message (OCPP 1.6)
export function createAuthorize(idTag: string): OcppCallMessage {
  const params: AuthorizeRequest = { idTag }
  return [MessageType.CALL, generateMessageId(), 'Authorize', params]
}

// Create StartTransaction message (OCPP 1.6)
export function createStartTransaction(
  connectorId: number,
  idTag: string,
  meterStart: number
): OcppCallMessage {
  const params: StartTransactionRequest = {
    connectorId,
    idTag,
    meterStart,
    timestamp: new Date().toISOString()
  }
  return [MessageType.CALL, generateMessageId(), 'StartTransaction', params]
}

// Optional meter value parameters
export interface MeterValueOptions {
  energyWh: number
  powerW: number
  currentA?: number
  voltageV?: number
  socPercent?: number
  temperatureC?: number
}

// Create MeterValues message (OCPP 1.6)
export function createMeterValues(
  connectorId: number,
  transactionId: number | undefined,
  options: MeterValueOptions
): OcppCallMessage {
  const sampledValue: SampledValue[] = [
    {
      value: String(Math.round(options.energyWh)),
      measurand: 'Energy.Active.Import.Register',
      unit: 'Wh'
    },
    {
      value: String(Math.round(options.powerW)),
      measurand: 'Power.Active.Import',
      unit: 'W'
    }
  ]

  if (options.currentA !== undefined) {
    sampledValue.push({
      value: options.currentA.toFixed(1),
      measurand: 'Current.Import',
      unit: 'A'
    })
  }

  if (options.voltageV !== undefined) {
    sampledValue.push({
      value: options.voltageV.toFixed(1),
      measurand: 'Voltage',
      unit: 'V'
    })
  }

  if (options.socPercent !== undefined) {
    sampledValue.push({
      value: String(Math.round(options.socPercent)),
      measurand: 'SoC',
      unit: 'Percent'
    })
  }

  if (options.temperatureC !== undefined) {
    sampledValue.push({
      value: options.temperatureC.toFixed(1),
      measurand: 'Temperature',
      unit: 'Celsius'
    })
  }

  const params: MeterValuesRequest = {
    connectorId,
    transactionId,
    meterValue: [
      {
        timestamp: new Date().toISOString(),
        sampledValue
      }
    ]
  }
  return [MessageType.CALL, generateMessageId(), 'MeterValues', params]
}

// Create StopTransaction message (OCPP 1.6)
export function createStopTransaction(
  transactionId: number,
  meterStop: number,
  reason: StopTransactionReason = 'Local',
  idTag?: string
): OcppCallMessage {
  const params: StopTransactionRequest = {
    transactionId,
    meterStop,
    timestamp: new Date().toISOString(),
    reason,
    idTag
  }
  return [MessageType.CALL, generateMessageId(), 'StopTransaction', params]
}

// Validate OCPP message format
export function isValidOcppMessage(data: unknown): data is OcppCallMessage {
  if (!Array.isArray(data)) return false
  if (data.length < 3) return false

  const [messageType] = data
  return (
    messageType === MessageType.CALL ||
    messageType === MessageType.CALLRESULT ||
    messageType === MessageType.CALLERROR
  )
}

// =============================================================================
// Diagnostics and Firmware Status Notifications (Charger -> Server)
// =============================================================================

// Create DiagnosticsStatusNotification message (OCPP 1.6)
export function createDiagnosticsStatusNotification(
  status: DiagnosticsStatus
): OcppCallMessage {
  const params: DiagnosticsStatusNotificationRequest = { status }
  return [MessageType.CALL, generateMessageId(), 'DiagnosticsStatusNotification', params]
}

// Create FirmwareStatusNotification message (OCPP 1.6)
export function createFirmwareStatusNotification(
  status: FirmwareStatus
): OcppCallMessage {
  const params: FirmwareStatusNotificationRequest = { status }
  return [MessageType.CALL, generateMessageId(), 'FirmwareStatusNotification', params]
}

// =============================================================================
// DataTransfer (Charger -> Server)
// =============================================================================

// DataTransfer request parameters
export interface DataTransferParams {
  vendorId: string
  messageId?: string
  data?: string
}

// Create DataTransfer message (OCPP 1.6)
export function createDataTransfer(params: DataTransferParams): OcppCallMessage {
  const payload: Record<string, unknown> = {
    vendorId: params.vendorId
  }
  if (params.messageId !== undefined) {
    payload.messageId = params.messageId
  }
  if (params.data !== undefined) {
    payload.data = params.data
  }
  return [MessageType.CALL, generateMessageId(), 'DataTransfer', payload]
}
