import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { ChargePointStatus } from '../ocpp/types.js'
import type { ChargerConfig } from '../ocpp/serverMessages.js'

// Raw charger template JSON structure (supports both sim format and simplified format)
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

export interface ChargerState {
  connected: boolean
  transactionId: number | null
  connectorStates: Map<number, ChargePointStatus>
  configOverrides: Map<string, string>
}

export interface LoadedCharger {
  name: string
  chargerId: string
  url: string
  protocol: 'ocpp1.6' | 'ocpp2.0.1'
  auth?: { username: string; password: string }
  config: ChargerConfig
  state: ChargerState
}

function normalizeProtocol(proto?: string): 'ocpp1.6' | 'ocpp2.0.1' {
  if (!proto) return 'ocpp1.6'
  if (proto === '2.0.1' || proto === 'ocpp2.0.1') return 'ocpp2.0.1'
  return 'ocpp1.6'
}

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

export function setTransactionId(charger: LoadedCharger, txId: number | null): void {
  charger.state.transactionId = txId
}

export function setConnectorStatus(charger: LoadedCharger, connectorId: number, status: ChargePointStatus): void {
  charger.state.connectorStates.set(connectorId, status)
}

export function applyConfigChange(charger: LoadedCharger, key: string, value: string): void {
  charger.state.configOverrides.set(key, value)
  // Also update the ocppConfiguration so GetConfiguration reflects changes
  if (!charger.config.ocppConfiguration) {
    charger.config.ocppConfiguration = {}
  }
  charger.config.ocppConfiguration[key] = value
}
