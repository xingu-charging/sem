/**
 * @file Charge session automation — runs a complete OCPP charging session
 * (Authorize → Preparing → StartTransaction → Charging → MeterValues → StopTransaction → Available)
 * with configurable timing, energy simulation, and realistic DC charging curves.
 * @module @xingu-charging/sem
 * @license MIT
 *
 * Copyright (c) 2026 Xingu Charging
 * https://github.com/xingu-charging/sem
 */

import { OcppConnection } from '../ocpp/connection.js'
import { ConnectionState, type OcppCallMessage } from '../ocpp/types.js'
import {
  createAuthorize,
  createStatusNotification,
  createStartTransaction,
  createStopTransaction,
  createMeterValues
} from '../ocpp/messages.js'
import { type LoadedCharger, setTransactionId, setConnectorStatus } from './charger.js'

/** Options for running an automated charge session. */
export interface ChargeSessionOptions {
  /** Connector ID to charge on */
  connectorId: number
  /** RFID/NFC idTag for authorization */
  idTag: string
  /** Duration of the charging phase in seconds (0 = run until stopped externally) */
  duration: number
  /** Max charging power in watts (default: charger max or 7000) */
  powerW: number
  /** Meter value send interval in seconds (default: 30) */
  meterInterval: number
  /** Starting meter value in Wh (default: 0) */
  meterStart: number
  /** Skip Authorize step (used when AuthorizeRemoteTxRequests=false) */
  skipAuthorize?: boolean
  /** Starting SoC percentage (DC only, default: 20) */
  socStart?: number
  /** Target SoC percentage (DC only, default: 80) */
  socEnd?: number
  /** Battery capacity in Wh (DC only, default: 60000) */
  batteryCapacityWh?: number
}

/** Callback to send a message and wait for the correlated CALLRESULT. */
export type SendAndWaitFn = (
  action: string,
  message: OcppCallMessage
) => Promise<Record<string, unknown>>

/** Logger callback for charge session events. */
export type ChargeLogFn = (message: string) => void

/** Tracks an active charge session for cancellation. */
export interface ActiveChargeSession {
  /** The timer handle for the meter value loop */
  meterTimer: NodeJS.Timeout | null
  /** The timer handle for the session end */
  endTimer: NodeJS.Timeout | null
  /** Whether the session has been cancelled */
  cancelled: boolean
  /** Current accumulated energy in Wh */
  currentEnergyWh: number
  /** Transaction ID from StartTransaction response */
  transactionId: number | null
  /** Connector ID */
  connectorId: number
  /** Promise that resolves when the session completes */
  completion: Promise<void>
}

/** Registry of active sessions keyed by connectorId. */
const activeSessions = new Map<string, ActiveChargeSession>()

/** Get a session key from charger ID and connector. */
function sessionKey(chargerId: string, connectorId: number): string {
  return `${chargerId}:${connectorId}`
}

/** Get the active session for a charger+connector, if any. */
export function getActiveSession(
  chargerId: string,
  connectorId: number
): ActiveChargeSession | undefined {
  return activeSessions.get(sessionKey(chargerId, connectorId))
}

/** Find an active session by transactionId. Returns the session and its connector ID, or undefined. */
export function findSessionByTransactionId(
  transactionId: number
): { session: ActiveChargeSession; connectorId: number; key: string } | undefined {
  for (const [key, session] of activeSessions) {
    if (session.transactionId === transactionId) {
      return { session, connectorId: session.connectorId, key }
    }
  }
  return undefined
}

/**
 * Stop an active charge session gracefully.
 * Sends StopTransaction and transitions connector back to Available.
 */
export async function stopChargeSession(
  chargerId: string,
  connectorId: number,
  connection: OcppConnection,
  charger: LoadedCharger,
  sendAndWait: SendAndWaitFn,
  log: ChargeLogFn,
  reason: 'Remote' | 'Local' | 'EVDisconnected' = 'Remote'
): Promise<void> {
  const key = sessionKey(chargerId, connectorId)
  const session = activeSessions.get(key)
  if (!session) return

  session.cancelled = true

  if (session.meterTimer) {
    clearInterval(session.meterTimer)
    session.meterTimer = null
  }
  if (session.endTimer) {
    clearTimeout(session.endTimer)
    session.endTimer = null
  }

  if (session.transactionId !== null) {
    const finalEnergy = Math.round(session.currentEnergyWh)
    log(`Stopping session: txId=${session.transactionId} energy=${finalEnergy}Wh reason=${reason}`)

    const stopMsg = createStopTransaction(session.transactionId, finalEnergy, reason)
    await sendAndWait('StopTransaction', stopMsg)
    setTransactionId(charger, null)

    const finishMsg = createStatusNotification(connectorId, 'Finishing')
    await sendAndWait('StatusNotification', finishMsg)
    setConnectorStatus(charger, connectorId, 'Finishing')

    await delay(1000)

    const availMsg = createStatusNotification(connectorId, 'Available')
    await sendAndWait('StatusNotification', availMsg)
    setConnectorStatus(charger, connectorId, 'Available')

    log(`Session complete: ${finalEnergy}Wh delivered`)
  }

  activeSessions.delete(key)
}

/**
 * Run a complete automated charge session.
 *
 * Sequence:
 * 1. Authorize(idTag) → check Accepted
 * 2. StatusNotification(Preparing)
 * 3. StartTransaction → capture transactionId
 * 4. StatusNotification(Charging)
 * 5. MeterValues loop every meterInterval seconds
 * 6. After duration: StopTransaction → Finishing → Available
 */
export function startChargeSession(
  connection: OcppConnection,
  charger: LoadedCharger,
  sendAndWait: SendAndWaitFn,
  log: ChargeLogFn,
  options: ChargeSessionOptions
): ActiveChargeSession {
  const key = sessionKey(charger.chargerId, options.connectorId)

  // Check if session already active on this connector
  const existing = activeSessions.get(key)
  if (existing && !existing.cancelled) {
    throw new Error(`Session already active on connector ${options.connectorId}`)
  }

  const session: ActiveChargeSession = {
    meterTimer: null,
    endTimer: null,
    cancelled: false,
    currentEnergyWh: options.meterStart,
    transactionId: null,
    connectorId: options.connectorId,
    completion: Promise.resolve()
  }

  activeSessions.set(key, session)

  // Run the session sequence asynchronously
  session.completion = runSession(connection, charger, sendAndWait, log, options, session, key)

  return session
}

// =============================================================================
// DC Charging Curve Simulation
// =============================================================================

/** Determine if the charger is DC based on connector config. */
function isDcCharger(charger: LoadedCharger, connectorId: number): boolean {
  const connector = charger.config.connectors?.find((c) => c.connectorId === connectorId)
  if (!connector) return false
  return connector.powerType === 'DC'
}

/**
 * Calculate current power for DC charging based on SoC.
 *
 * Realistic DC charging curve:
 * - 0-20% SoC: ramp up from 20% to 100% of max power
 * - 20-80% SoC: constant at max power
 * - 80-100% SoC: taper from 100% to 20% of max power
 */
function dcChargingPower(socPercent: number, maxPowerW: number): number {
  if (socPercent < 20) {
    // Ramp up: linear from 20% to 100% power
    const factor = 0.2 + (0.8 * (socPercent / 20))
    return Math.round(maxPowerW * factor)
  } else if (socPercent < 80) {
    // Constant max power
    return maxPowerW
  } else {
    // Taper: linear from 100% to 20% power
    const factor = 1.0 - (0.8 * ((socPercent - 80) / 20))
    return Math.round(maxPowerW * Math.max(factor, 0.2))
  }
}

/** Calculate SoC from energy delivered and battery capacity. */
function calculateSoc(
  startSoc: number,
  energyDeliveredWh: number,
  batteryCapacityWh: number
): number {
  const socFromEnergy = (energyDeliveredWh / batteryCapacityWh) * 100
  return Math.min(100, startSoc + socFromEnergy)
}

// =============================================================================
// Session Runner
// =============================================================================

/** Internal: run the full charge session sequence. */
async function runSession(
  connection: OcppConnection,
  charger: LoadedCharger,
  sendAndWait: SendAndWaitFn,
  log: ChargeLogFn,
  options: ChargeSessionOptions,
  session: ActiveChargeSession,
  key: string
): Promise<void> {
  try {
    // 1. Authorize (skip when AuthorizeRemoteTxRequests=false for remote starts)
    if (options.skipAuthorize) {
      log(`Skipping authorization (AuthorizeRemoteTxRequests=false)`)
    } else {
      log(`Authorizing idTag=${options.idTag}...`)
      const authMsg = createAuthorize(options.idTag)
      const authResponse = await sendAndWait('Authorize', authMsg)
      const idTagInfo = authResponse.idTagInfo as Record<string, unknown> | undefined
      const authStatus = idTagInfo?.status as string | undefined

      if (authStatus !== 'Accepted') {
        log(`Authorization failed: ${authStatus ?? 'unknown'}`)
        activeSessions.delete(key)
        return
      }
      log(`Authorization accepted`)
    }

    if (session.cancelled) return

    // 2. Preparing
    const prepMsg = createStatusNotification(options.connectorId, 'Preparing')
    await sendAndWait('StatusNotification', prepMsg)
    setConnectorStatus(charger, options.connectorId, 'Preparing')
    log(`Connector ${options.connectorId}: Preparing`)

    if (session.cancelled) return

    // 3. StartTransaction
    const startMsg = createStartTransaction(options.connectorId, options.idTag, options.meterStart)
    const startResponse = await sendAndWait('StartTransaction', startMsg)
    const txId = startResponse.transactionId as number
    session.transactionId = txId
    setTransactionId(charger, txId)
    log(`Transaction started: txId=${txId}`)

    if (session.cancelled) return

    // 4. Charging
    const chargingMsg = createStatusNotification(options.connectorId, 'Charging')
    await sendAndWait('StatusNotification', chargingMsg)
    setConnectorStatus(charger, options.connectorId, 'Charging')
    log(`Connector ${options.connectorId}: Charging at ${options.powerW}W max`)

    if (session.cancelled) return

    // Determine if this is DC charging with SoC simulation
    const isDc = isDcCharger(charger, options.connectorId)
    const socStart = options.socStart ?? 20
    const socEnd = options.socEnd ?? 80
    const batteryCapacityWh = options.batteryCapacityWh ?? 60000
    let currentSoc = isDc ? socStart : 0

    // 5. MeterValues loop
    const voltage = charger.config.capabilities?.voltage ?? (isDc ? 400 : 230)

    session.meterTimer = setInterval(async () => {
      if (session.cancelled) return

      // Calculate current power (DC: use SoC-based curve, AC: constant)
      let currentPower: number
      if (isDc) {
        currentSoc = calculateSoc(socStart, session.currentEnergyWh - options.meterStart, batteryCapacityWh)
        currentPower = dcChargingPower(currentSoc, options.powerW)

        // Stop early if target SoC reached
        if (currentSoc >= socEnd) {
          log(`Target SoC ${socEnd}% reached — ending session`)
          session.cancelled = true
          if (session.meterTimer) {
            clearInterval(session.meterTimer)
            session.meterTimer = null
          }
          if (session.endTimer) {
            clearTimeout(session.endTimer)
            session.endTimer = null
          }
          // Trigger session end
          void endSession(session, charger, sendAndWait, log, options.connectorId, key)
          return
        }
      } else {
        currentPower = options.powerW
      }

      // Increment energy based on actual power
      const energyIncrement = (currentPower * options.meterInterval) / 3600
      session.currentEnergyWh += energyIncrement
      const energyWh = Math.round(session.currentEnergyWh)
      const currentA = currentPower / voltage

      // Build meter value options
      const meterOpts: Parameters<typeof createMeterValues>[2] = {
        energyWh,
        powerW: currentPower,
        currentA,
        voltageV: voltage
      }

      // Add SoC for DC charging
      if (isDc) {
        meterOpts.socPercent = Math.round(currentSoc)
      }

      try {
        const meterMsg = createMeterValues(options.connectorId, txId, meterOpts)
        await sendAndWait('MeterValues', meterMsg)
        const socInfo = isDc ? ` soc=${Math.round(currentSoc)}%` : ''
        log(`MeterValues: energy=${energyWh}Wh power=${currentPower}W${socInfo}`)
      } catch {
        log(`Failed to send meter values`)
      }
    }, options.meterInterval * 1000)

    // 6. Schedule session end or wait for external stop
    if (options.duration > 0) {
      await new Promise<void>((resolve) => {
        session.endTimer = setTimeout(() => {
          resolve()
        }, options.duration * 1000)
      })

      if (session.cancelled) return

      await endSession(session, charger, sendAndWait, log, options.connectorId, key)
    } else {
      // duration=0: run until stopped externally (RemoteStop, stop-charge, shutdown)
      // Keep the function alive so the session stays registered in activeSessions
      await new Promise<void>((resolve) => {
        session.endTimer = setInterval(() => {
          if (session.cancelled) {
            clearInterval(session.endTimer!)
            resolve()
          }
        }, 500) as unknown as NodeJS.Timeout
      })
    }
  } catch (err) {
    log(`Session error: ${err instanceof Error ? err.message : err}`)
  } finally {
    activeSessions.delete(key)
  }
}

/** End a charge session: stop meter loop, send StopTransaction, transition to Available. */
async function endSession(
  session: ActiveChargeSession,
  charger: LoadedCharger,
  sendAndWait: SendAndWaitFn,
  log: ChargeLogFn,
  connectorId: number,
  key: string
): Promise<void> {
  // Stop the meter loop
  if (session.meterTimer) {
    clearInterval(session.meterTimer)
    session.meterTimer = null
  }

  const txId = session.transactionId
  if (txId === null) return

  const finalEnergy = Math.round(session.currentEnergyWh)

  // StopTransaction
  const stopMsg = createStopTransaction(txId, finalEnergy, 'Local')
  await sendAndWait('StopTransaction', stopMsg)
  setTransactionId(charger, null)
  log(`Transaction stopped: txId=${txId} energy=${finalEnergy}Wh`)

  // Finishing → Available
  const finishMsg = createStatusNotification(connectorId, 'Finishing')
  await sendAndWait('StatusNotification', finishMsg)
  setConnectorStatus(charger, connectorId, 'Finishing')

  await delay(1000)

  const availMsg = createStatusNotification(connectorId, 'Available')
  await sendAndWait('StatusNotification', availMsg)
  setConnectorStatus(charger, connectorId, 'Available')

  log(`Session complete: ${finalEnergy}Wh delivered`)
  activeSessions.delete(key)
}

/**
 * Gracefully shut down the charger: stop active sessions, set all connectors
 * to Unavailable, then disconnect. Safe to call when already disconnected.
 */
export async function gracefulShutdown(
  connection: OcppConnection,
  charger: LoadedCharger,
  sendAndWait: SendAndWaitFn,
  log: ChargeLogFn
): Promise<void> {
  const isConnected = connection.getState() === ConnectionState.CONNECTED

  if (isConnected) {
    // 1. Stop any active charge sessions (best-effort)
    for (const [connId] of charger.state.connectorStates) {
      const session = getActiveSession(charger.chargerId, connId)
      if (session && !session.cancelled) {
        try {
          log(`Stopping active session on connector ${connId}...`)
          await stopChargeSession(charger.chargerId, connId, connection, charger, sendAndWait, log, 'Local')
        } catch {
          log(`Failed to stop session on connector ${connId}, continuing shutdown`)
        }
      }
    }

    // 2. Set all connectors to Unavailable (best-effort)
    for (const [connId] of charger.state.connectorStates) {
      try {
        const statusMsg = createStatusNotification(connId, 'Unavailable')
        await sendAndWait('StatusNotification', statusMsg)
        setConnectorStatus(charger, connId, 'Unavailable')
        log(`Connector ${connId}: Unavailable`)
      } catch {
        log(`Failed to send Unavailable for connector ${connId}, continuing shutdown`)
      }
    }

    // 3. Stop heartbeat and disconnect (must happen regardless)
    connection.stopHeartbeat()
    await connection.disconnect()
    log(`Disconnected`)
  } else {
    log(`Already disconnected`)
  }
}

/** Simple delay helper. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
