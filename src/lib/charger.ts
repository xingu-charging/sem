/**
 * @file Charger template loader — reads JSON templates and produces a normalized
 * LoadedCharger with resolved URL, auth credentials, connector states, and
 * runtime state tracking (transactionId, config overrides).
 * @module @xingu-charging/sem
 * @license MIT
 *
 * Copyright (c) 2026 Xingu Charging
 * https://github.com/xingu-charging/sem
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { ChargePointStatus } from '../ocpp/types.js'
import type { ChargerConfig } from '../ocpp/serverMessages.js'

/** Raw charger template JSON structure. Supports both sim format (OCPP field names) and simplified format. */
interface ChargerTemplate {
  name?: string
  identity?: {
    vendor?: string
    model?: string
    serialNumber?: string
    firmwareVersion?: string
    chargeBoxSerialNumber?: string
    iccid?: string
    imsi?: string
    meterType?: string
    meterSerialNumber?: string
    // Sim format (OCPP field names)
    chargePointVendor?: string
    chargePointModel?: string
    chargePointSerialNumber?: string
  }
  connection?: {
    environments?: Record<string, string>
    defaultEnvironment?: string
    chargerId?: string
    protocol?: string
    username?: string
    password?: string
    authentication?: {
      username?: string
      password?: string
    }
  }
  capabilities?: {
    maxPower: number
    phases?: number
    voltage?: number
    maxCurrent?: number
    supportedProtocols?: string[]
    features?: string[]
  }
  connectors?: Array<{
    connectorId: number
    type: string
    format: string
    powerType: string
    maxPower: number
    maxVoltage: number
    maxAmperage: number
  }>
  meterValueConfig?: {
    sampleInterval: number
    measurands: string[]
  }
  ocppConfiguration?: Record<string, string>
}

/** Mutable runtime state of a charger session. */
export interface ChargerState {
  /** Whether the WebSocket is currently connected */
  connected: boolean
  /** Active transaction ID from StartTransaction, null when idle */
  transactionId: number | null
  /** Current status of each connector (connectorId -> ChargePointStatus) */
  connectorStates: Map<number, ChargePointStatus>
  /** OCPP configuration key overrides applied via ChangeConfiguration */
  configOverrides: Map<string, string>
}

/** A fully resolved charger ready for connection, with all template values normalized. */
export interface LoadedCharger {
  /** Display name from template or chargerId fallback */
  name: string
  /** Unique charger identifier, appended to the WebSocket URL */
  chargerId: string
  /** Fully resolved WebSocket URL including chargerId path segment */
  url: string
  /** OCPP protocol version */
  protocol: 'ocpp1.6' | 'ocpp2.0.1'
  /** Basic Auth credentials for WebSocket connection (optional) */
  auth?: { username: string; password: string }
  /** OCPP configuration (identity, capabilities, connectors, meter config) */
  config: ChargerConfig
  /** Mutable runtime state */
  state: ChargerState
}

/** Normalize protocol string variants to the canonical internal format. */
function normalizeProtocol(proto?: string): 'ocpp1.6' | 'ocpp2.0.1' {
  if (!proto) return 'ocpp1.6'
  if (proto === '2.0.1' || proto === 'ocpp2.0.1') return 'ocpp2.0.1'
  return 'ocpp1.6'
}

/**
 * Load a charger template JSON file and resolve all values into a ready-to-use LoadedCharger.
 *
 * Handles dual-format identity fields (sim vs simplified), environment-based URL resolution,
 * automatic chargerId URL appending, and Basic Auth credential extraction.
 *
 * @param path - Path to the charger JSON template file
 * @param envOverride - Override the default environment (staging, production, local)
 * @param urlOverride - Override the WebSocket URL entirely (bypasses template environments)
 * @returns Fully resolved LoadedCharger ready for OcppConnection.connect()
 * @throws If the template file cannot be read/parsed, or the environment is not found
 */
export function loadChargerTemplate(
  path: string,
  envOverride?: string,
  urlOverride?: string
): LoadedCharger {
  const fullPath = resolve(path)
  const raw = readFileSync(fullPath, 'utf-8')
  const template: ChargerTemplate = JSON.parse(raw)

  // Normalize identity (dual-format support)
  const identity = template.identity ?? {}
  const normalizedIdentity = {
    vendor: identity.chargePointVendor ?? identity.vendor ?? 'Unknown',
    model: identity.chargePointModel ?? identity.model ?? 'Unknown',
    serialNumber: identity.chargePointSerialNumber ?? identity.serialNumber ?? 'SN-001',
    firmwareVersion: identity.firmwareVersion ?? '1.0.0',
    chargeBoxSerialNumber: identity.chargeBoxSerialNumber,
    iccid: identity.iccid,
    imsi: identity.imsi,
    meterType: identity.meterType,
    meterSerialNumber: identity.meterSerialNumber
  }

  // Resolve charger ID
  const chargerId = template.connection?.chargerId ?? normalizedIdentity.serialNumber

  // Resolve URL
  let url: string
  if (urlOverride) {
    url = urlOverride
  } else {
    const conn = template.connection
    const envName = envOverride ?? conn?.defaultEnvironment ?? 'staging'
    const baseUrl = conn?.environments?.[envName]
    if (!baseUrl) {
      throw new Error(`Environment "${envName}" not found in charger template. Available: ${Object.keys(conn?.environments ?? {}).join(', ') || 'none'}`)
    }
    url = baseUrl
  }

  // Append chargerId to URL if not already there
  if (!url.endsWith(`/${chargerId}`)) {
    url = `${url.replace(/\/$/, '')}/${chargerId}`
  }

  // Resolve auth (dual-format support)
  const conn = template.connection
  const username = conn?.authentication?.username ?? conn?.username
  const password = conn?.authentication?.password ?? conn?.password
  const auth = username && password ? { username, password } : undefined

  // Build ChargerConfig for OCPP layer
  const config: ChargerConfig = {
    identity: normalizedIdentity,
    capabilities: template.capabilities,
    connectors: template.connectors,
    meterValueConfig: template.meterValueConfig,
    ocppConfiguration: template.ocppConfiguration
  }

  // Initialize connector states
  const connectorStates = new Map<number, ChargePointStatus>()
  const connectorCount = template.connectors?.length ?? 1
  for (let i = 1; i <= connectorCount; i++) {
    connectorStates.set(i, 'Available')
  }

  return {
    name: template.name ?? chargerId,
    chargerId,
    url,
    protocol: normalizeProtocol(template.connection?.protocol),
    auth,
    config,
    state: {
      connected: false,
      transactionId: null,
      connectorStates,
      configOverrides: new Map()
    }
  }
}

/** Update the active transaction ID (set from StartTransaction, cleared on StopTransaction). */
export function setTransactionId(charger: LoadedCharger, txId: number | null): void {
  charger.state.transactionId = txId
}

/** Update the cached status of a connector after sending StatusNotification. */
export function setConnectorStatus(charger: LoadedCharger, connectorId: number, status: ChargePointStatus): void {
  charger.state.connectorStates.set(connectorId, status)
}

/** Apply a configuration change from ChangeConfiguration. Updates both the override map and active config. */
export function applyConfigChange(charger: LoadedCharger, key: string, value: string): void {
  charger.state.configOverrides.set(key, value)
  // Also update the ocppConfiguration so GetConfiguration reflects changes
  if (!charger.config.ocppConfiguration) {
    charger.config.ocppConfiguration = {}
  }
  charger.config.ocppConfiguration[key] = value
}
