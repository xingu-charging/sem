/**
 * @file OCPP type definitions — message types, request/response interfaces, and enums
 * for OCPP 1.6 and 2.0.1 protocols.
 * @module @xingu-charging/sem
 * @license MIT
 *
 * Copyright (c) 2026 Xingu Charging
 * https://github.com/xingu-charging/sem
 */

// OCPP Message Types (JSON-RPC 2.0 over WebSocket)
export const MessageType = {
  CALL: 2,
  CALLRESULT: 3,
  CALLERROR: 4
} as const

export type MessageTypeId = typeof MessageType[keyof typeof MessageType]

// OCPP Call message: [2, "uniqueId", "Action", {payload}]
export type OcppCallMessage = [
  typeof MessageType.CALL,
  string, // messageId
  string, // action
  Record<string, unknown> // payload
]

// OCPP CallResult message: [3, "uniqueId", {payload}]
export type OcppCallResultMessage = [
  typeof MessageType.CALLRESULT,
  string, // messageId
  Record<string, unknown> // payload
]

// OCPP CallError message: [4, "uniqueId", "ErrorCode", "ErrorDescription", {errorDetails}]
export type OcppCallErrorMessage = [
  typeof MessageType.CALLERROR,
  string, // messageId
  string, // errorCode
  string, // errorDescription
  Record<string, unknown> // errorDetails
]

export type OcppMessage =
  | OcppCallMessage
  | OcppCallResultMessage
  | OcppCallErrorMessage

// Connection Configuration
export interface ConnectionConfig {
  url: string
  protocol: 'ocpp1.6' | 'ocpp2.0.1'
  auth?: {
    username: string
    password: string
  }
}

// Connection States
export enum ConnectionState {
  DISCONNECTED = 'disconnected',
  CONNECTING = 'connecting',
  CONNECTED = 'connected',
  ERROR = 'error'
}

// BootNotification Request (OCPP 1.6)
export interface BootNotificationRequest extends Record<string, unknown> {
  chargePointVendor: string
  chargePointModel: string
  chargePointSerialNumber?: string
  chargeBoxSerialNumber?: string
  firmwareVersion?: string
  iccid?: string
  imsi?: string
  meterType?: string
  meterSerialNumber?: string
}

// BootNotification Response (OCPP 1.6)
export interface BootNotificationResponse {
  status: 'Accepted' | 'Pending' | 'Rejected'
  currentTime: string
  interval: number
}

// Heartbeat Request (OCPP 1.6)
export type HeartbeatRequest = Record<string, never>

// Heartbeat Response (OCPP 1.6)
export interface HeartbeatResponse {
  currentTime: string
}

// =============================================================================
// OCPP 2.0.1 Types
// =============================================================================

// OCPP 2.0.1 BootNotification Reason
export type BootReasonType =
  | 'ApplicationReset'
  | 'FirmwareUpdate'
  | 'LocalReset'
  | 'PowerUp'
  | 'RemoteReset'
  | 'ScheduledReset'
  | 'Triggered'
  | 'Unknown'
  | 'Watchdog'

// OCPP 2.0.1 Modem (optional in ChargingStation)
export interface ModemType {
  iccid?: string
  imsi?: string
}

// OCPP 2.0.1 ChargingStation
export interface ChargingStationType {
  vendorName: string
  model: string
  serialNumber?: string
  firmwareVersion?: string
  modem?: ModemType
}

// OCPP 2.0.1 BootNotification Request
export interface BootNotificationRequest201 extends Record<string, unknown> {
  chargingStation: ChargingStationType
  reason: BootReasonType
}

// OCPP 2.0.1 StatusInfo (optional in responses)
export interface StatusInfoType {
  reasonCode: string
  additionalInfo?: string
}

// OCPP 2.0.1 Registration Status
export type RegistrationStatusType = 'Accepted' | 'Pending' | 'Rejected'

// OCPP 2.0.1 BootNotification Response
export interface BootNotificationResponse201 {
  currentTime: string
  interval: number
  status: RegistrationStatusType
  statusInfo?: StatusInfoType
}

// =============================================================================
// OCPP 1.6 Additional Message Types
// =============================================================================

// ChargePointErrorCode (OCPP 1.6)
export type ChargePointErrorCode =
  | 'ConnectorLockFailure'
  | 'EVCommunicationError'
  | 'GroundFailure'
  | 'HighTemperature'
  | 'InternalError'
  | 'LocalListConflict'
  | 'NoError'
  | 'OtherError'
  | 'OverCurrentFailure'
  | 'OverVoltage'
  | 'PowerMeterFailure'
  | 'PowerSwitchFailure'
  | 'ReaderFailure'
  | 'ResetFailure'
  | 'UnderVoltage'
  | 'WeakSignal'

// ChargePointStatus (OCPP 1.6)
export type ChargePointStatus =
  | 'Available'
  | 'Preparing'
  | 'Charging'
  | 'SuspendedEVSE'
  | 'SuspendedEV'
  | 'Finishing'
  | 'Reserved'
  | 'Unavailable'
  | 'Faulted'

// StatusNotification Request (OCPP 1.6)
export interface StatusNotificationRequest extends Record<string, unknown> {
  connectorId: number
  errorCode: ChargePointErrorCode
  status: ChargePointStatus
  info?: string
  timestamp?: string
  vendorId?: string
  vendorErrorCode?: string
}

// Authorize Request (OCPP 1.6)
export interface AuthorizeRequest extends Record<string, unknown> {
  idTag: string
}

// Authorize Response (OCPP 1.6)
export interface AuthorizeResponse {
  idTagInfo: {
    status: 'Accepted' | 'Blocked' | 'Expired' | 'Invalid' | 'ConcurrentTx'
    expiryDate?: string
    parentIdTag?: string
  }
}

// StartTransaction Request (OCPP 1.6)
export interface StartTransactionRequest extends Record<string, unknown> {
  connectorId: number
  idTag: string
  meterStart: number
  timestamp: string
  reservationId?: number
}

// StartTransaction Response (OCPP 1.6)
export interface StartTransactionResponse {
  transactionId: number
  idTagInfo: {
    status: 'Accepted' | 'Blocked' | 'Expired' | 'Invalid' | 'ConcurrentTx'
    expiryDate?: string
    parentIdTag?: string
  }
}

// SampledValue (OCPP 1.6)
export interface SampledValue {
  value: string
  context?: 'Interruption.Begin' | 'Interruption.End' | 'Sample.Clock' | 'Sample.Periodic' | 'Transaction.Begin' | 'Transaction.End' | 'Trigger' | 'Other'
  format?: 'Raw' | 'SignedData'
  measurand?: 'Energy.Active.Export.Register' | 'Energy.Active.Import.Register' | 'Energy.Reactive.Export.Register' | 'Energy.Reactive.Import.Register' | 'Energy.Active.Export.Interval' | 'Energy.Active.Import.Interval' | 'Energy.Reactive.Export.Interval' | 'Energy.Reactive.Import.Interval' | 'Power.Active.Export' | 'Power.Active.Import' | 'Power.Offered' | 'Power.Reactive.Export' | 'Power.Reactive.Import' | 'Power.Factor' | 'Current.Import' | 'Current.Export' | 'Current.Offered' | 'Voltage' | 'Frequency' | 'Temperature' | 'SoC' | 'RPM'
  phase?: 'L1' | 'L2' | 'L3' | 'N' | 'L1-N' | 'L2-N' | 'L3-N' | 'L1-L2' | 'L2-L3' | 'L3-L1'
  location?: 'Cable' | 'EV' | 'Inlet' | 'Outlet' | 'Body'
  unit?: 'Wh' | 'kWh' | 'varh' | 'kvarh' | 'W' | 'kW' | 'VA' | 'kVA' | 'var' | 'kvar' | 'A' | 'V' | 'K' | 'Celsius' | 'Fahrenheit' | 'Percent'
}

// MeterValue (OCPP 1.6)
export interface MeterValue {
  timestamp: string
  sampledValue: SampledValue[]
}

// MeterValues Request (OCPP 1.6)
export interface MeterValuesRequest extends Record<string, unknown> {
  connectorId: number
  transactionId?: number
  meterValue: MeterValue[]
}

// StopTransaction Reason (OCPP 1.6)
export type StopTransactionReason =
  | 'EmergencyStop'
  | 'EVDisconnected'
  | 'HardReset'
  | 'Local'
  | 'Other'
  | 'PowerLoss'
  | 'Reboot'
  | 'Remote'
  | 'SoftReset'
  | 'UnlockCommand'
  | 'DeAuthorized'

// StopTransaction Request (OCPP 1.6)
export interface StopTransactionRequest extends Record<string, unknown> {
  meterStop: number
  timestamp: string
  transactionId: number
  reason?: StopTransactionReason
  idTag?: string
  transactionData?: MeterValue[]
}

// =============================================================================
// OCPP 1.6 Server-Initiated Messages (Server -> Charger)
// =============================================================================

// GetConfiguration Request (OCPP 1.6) - Server asks charger for configuration
export interface GetConfigurationRequest {
  key?: string[]
}

// Configuration Key Value (OCPP 1.6)
export interface ConfigurationKeyValue {
  key: string
  readonly: boolean
  value?: string
}

// GetConfiguration Response (OCPP 1.6) - Charger responds with configuration
export interface GetConfigurationResponse {
  configurationKey?: ConfigurationKeyValue[]
  unknownKey?: string[]
}

// ChangeConfiguration Request (OCPP 1.6) - Server changes charger configuration
export interface ChangeConfigurationRequest {
  key: string
  value: string
}

// ChangeConfiguration Status
export type ConfigurationStatus = 'Accepted' | 'Rejected' | 'RebootRequired' | 'NotSupported'

// ChangeConfiguration Response (OCPP 1.6)
export interface ChangeConfigurationResponse {
  status: ConfigurationStatus
}

// Reset Type (OCPP 1.6)
export type ResetType = 'Hard' | 'Soft'

// Reset Request (OCPP 1.6)
export interface ResetRequest {
  type: ResetType
}

// Reset Status
export type ResetStatus = 'Accepted' | 'Rejected'

// Reset Response (OCPP 1.6)
export interface ResetResponse {
  status: ResetStatus
}

// RemoteStartTransaction Request (OCPP 1.6)
export interface RemoteStartTransactionRequest {
  connectorId?: number
  idTag: string
  chargingProfile?: Record<string, unknown>
}

// RemoteStartStop Status
export type RemoteStartStopStatus = 'Accepted' | 'Rejected'

// RemoteStartTransaction Response (OCPP 1.6)
export interface RemoteStartTransactionResponse {
  status: RemoteStartStopStatus
}

// RemoteStopTransaction Request (OCPP 1.6)
export interface RemoteStopTransactionRequest {
  transactionId: number
}

// RemoteStopTransaction Response (OCPP 1.6)
export interface RemoteStopTransactionResponse {
  status: RemoteStartStopStatus
}

// UnlockConnector Request (OCPP 1.6)
export interface UnlockConnectorRequest {
  connectorId: number
}

// UnlockConnector Status
export type UnlockStatus = 'Unlocked' | 'UnlockFailed' | 'NotSupported'

// UnlockConnector Response (OCPP 1.6)
export interface UnlockConnectorResponse {
  status: UnlockStatus
}

// TriggerMessage Request (OCPP 1.6)
export type MessageTrigger =
  | 'BootNotification'
  | 'DiagnosticsStatusNotification'
  | 'FirmwareStatusNotification'
  | 'Heartbeat'
  | 'MeterValues'
  | 'StatusNotification'

export interface TriggerMessageRequest {
  requestedMessage: MessageTrigger
  connectorId?: number
}

// TriggerMessage Status
export type TriggerMessageStatus = 'Accepted' | 'Rejected' | 'NotImplemented'

// TriggerMessageResponse (OCPP 1.6)
export interface TriggerMessageResponse {
  status: TriggerMessageStatus
}

// =============================================================================
// GetDiagnostics (Server -> Charger) - OCPP 1.6
// =============================================================================

// GetDiagnostics Request (OCPP 1.6)
export interface GetDiagnosticsRequest {
  location: string
  startTime?: string
  stopTime?: string
  retries?: number
  retryInterval?: number
}

// GetDiagnostics Response (OCPP 1.6)
export interface GetDiagnosticsResponse {
  fileName?: string
}

// =============================================================================
// DiagnosticsStatusNotification (Charger -> Server) - OCPP 1.6
// =============================================================================

// Diagnostics Status values
export type DiagnosticsStatus =
  | 'Idle'
  | 'Uploaded'
  | 'UploadFailed'
  | 'Uploading'

// DiagnosticsStatusNotification Request (OCPP 1.6)
export interface DiagnosticsStatusNotificationRequest extends Record<string, unknown> {
  status: DiagnosticsStatus
}

// DiagnosticsStatusNotification Response (OCPP 1.6) - Empty response
export type DiagnosticsStatusNotificationResponse = Record<string, never>

// =============================================================================
// UpdateFirmware (Server -> Charger) - OCPP 1.6
// =============================================================================

// UpdateFirmware Request (OCPP 1.6)
export interface UpdateFirmwareRequest {
  location: string
  retrieveDate: string
  retries?: number
  retryInterval?: number
}

// UpdateFirmware Response (OCPP 1.6) - Empty response
export type UpdateFirmwareResponse = Record<string, never>

// =============================================================================
// FirmwareStatusNotification (Charger -> Server) - OCPP 1.6
// =============================================================================

// Firmware Status values
export type FirmwareStatus =
  | 'Downloaded'
  | 'DownloadFailed'
  | 'Downloading'
  | 'Idle'
  | 'InstallationFailed'
  | 'Installing'
  | 'Installed'

// FirmwareStatusNotification Request (OCPP 1.6)
export interface FirmwareStatusNotificationRequest extends Record<string, unknown> {
  status: FirmwareStatus
}

// FirmwareStatusNotification Response (OCPP 1.6) - Empty response
export type FirmwareStatusNotificationResponse = Record<string, never>

// =============================================================================
// ChangeAvailability (Server -> Charger) - OCPP 1.6 & 2.0.1
// =============================================================================

// Availability/Operational Status (same values for 1.6 and 2.0.1)
export type AvailabilityType = 'Operative' | 'Inoperative'

// ChangeAvailability Request (OCPP 1.6)
export interface ChangeAvailabilityRequest {
  connectorId: number
  type: AvailabilityType
}

// EVSE Type for OCPP 2.0.1
export interface EVSE201 {
  id: number
  connectorId?: number
}

// ChangeAvailability Request (OCPP 2.0.1)
export interface ChangeAvailabilityRequest201 {
  operationalStatus: AvailabilityType
  evse?: EVSE201
}

// ChangeAvailability Status
export type AvailabilityStatus = 'Accepted' | 'Rejected' | 'Scheduled'

// ChangeAvailability Response (OCPP 1.6 & 2.0.1)
export interface ChangeAvailabilityResponse {
  status: AvailabilityStatus
}

// =============================================================================
// ClearCache (Server -> Charger) - OCPP 1.6
// =============================================================================

// ClearCache Request (OCPP 1.6) - Empty request
export type ClearCacheRequest = Record<string, never>

// ClearCache Status
export type ClearCacheStatus = 'Accepted' | 'Rejected'

// ClearCache Response (OCPP 1.6)
export interface ClearCacheResponse {
  status: ClearCacheStatus
}

// =============================================================================
// SetChargingProfile (Server -> Charger) - OCPP 1.6
// =============================================================================

// Charging Profile Purpose Type
export type ChargingProfilePurposeType =
  | 'ChargePointMaxProfile'
  | 'TxDefaultProfile'
  | 'TxProfile'

// Charging Profile Kind Type
export type ChargingProfileKindType =
  | 'Absolute'
  | 'Recurring'
  | 'Relative'

// Recurrency Kind Type
export type RecurrencyKindType = 'Daily' | 'Weekly'

// Charging Rate Unit Type
export type ChargingRateUnitType = 'A' | 'W'

// Charging Schedule Period
export interface ChargingSchedulePeriod {
  startPeriod: number
  limit: number
  numberPhases?: number
}

// Charging Schedule
export interface ChargingSchedule {
  duration?: number
  startSchedule?: string
  chargingRateUnit: ChargingRateUnitType
  chargingSchedulePeriod: ChargingSchedulePeriod[]
  minChargingRate?: number
}

// Charging Profile
export interface ChargingProfile {
  chargingProfileId: number
  transactionId?: number
  stackLevel: number
  chargingProfilePurpose: ChargingProfilePurposeType
  chargingProfileKind: ChargingProfileKindType
  recurrencyKind?: RecurrencyKindType
  validFrom?: string
  validTo?: string
  chargingSchedule: ChargingSchedule
}

// SetChargingProfile Request (OCPP 1.6)
export interface SetChargingProfileRequest {
  connectorId: number
  csChargingProfiles: ChargingProfile
}

// SetChargingProfile Status
export type ChargingProfileStatus = 'Accepted' | 'Rejected' | 'NotSupported'

// SetChargingProfile Response (OCPP 1.6)
export interface SetChargingProfileResponse {
  status: ChargingProfileStatus
}

// =============================================================================
// ReserveNow (Server -> Charger) - OCPP 1.6
// =============================================================================

// ReserveNow Request (OCPP 1.6)
export interface ReserveNowRequest {
  connectorId: number
  expiryDate: string
  idTag: string
  parentIdTag?: string
  reservationId: number
}

// Reservation Status
export type ReservationStatus =
  | 'Accepted'
  | 'Faulted'
  | 'Occupied'
  | 'Rejected'
  | 'Unavailable'

// ReserveNow Response (OCPP 1.6)
export interface ReserveNowResponse {
  status: ReservationStatus
}

// =============================================================================
// CancelReservation (Server -> Charger) - OCPP 1.6
// =============================================================================

// CancelReservation Request (OCPP 1.6)
export interface CancelReservationRequest {
  reservationId: number
}

// CancelReservation Status
export type CancelReservationStatus = 'Accepted' | 'Rejected'

// CancelReservation Response (OCPP 1.6)
export interface CancelReservationResponse {
  status: CancelReservationStatus
}
