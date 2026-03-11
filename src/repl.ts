import { createInterface, type Interface } from 'node:readline'
import { OcppConnection } from './ocpp/connection.js'
import { MessageType, type ChargePointStatus, type OcppMessage } from './ocpp/types.js'
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
import { handleServerMessage } from './lib/serverHandler.js'
import { type LoadedCharger, setTransactionId, setConnectorStatus } from './lib/charger.js'
import * as output from './lib/output.js'

const VALID_STATUSES: ChargePointStatus[] = [
  'Available', 'Preparing', 'Charging', 'SuspendedEVSE',
  'SuspendedEV', 'Finishing', 'Reserved', 'Unavailable', 'Faulted'
]

interface CommandDef {
  usage: string
  description: string
}

const COMMANDS: Record<string, CommandDef> = {
  boot: { usage: 'boot', description: 'Send BootNotification' },
  heartbeat: { usage: 'heartbeat', description: 'Send Heartbeat' },
  status: { usage: 'status <conn> <status>', description: 'Send StatusNotification' },
  authorize: { usage: 'authorize <idTag>', description: 'Send Authorize' },
  start: { usage: 'start <conn> <idTag> <meter>', description: 'Send StartTransaction' },
  stop: { usage: 'stop <txId> <meter>', description: 'Send StopTransaction' },
  meter: { usage: 'meter <conn> <txId> <wh> <w>', description: 'Send MeterValues' },
  data: { usage: 'data <vendorId> [msgId] [data]', description: 'Send DataTransfer' },
  disconnect: { usage: 'disconnect', description: 'Close WebSocket connection' },
  help: { usage: 'help', description: 'Show this help' },
  exit: { usage: 'exit', description: 'Disconnect and exit' }
}

export function startRepl(
  connection: OcppConnection,
  charger: LoadedCharger
): void {
  const pendingMessages = new Map<string, string>()

  // Wire up message events for correlation
  connection.on('messageSent', (message: OcppMessage) => {
    if (message[0] === MessageType.CALL) {
      const [, msgId, action] = message
      pendingMessages.set(msgId, action)
      output.verbose(JSON.stringify(message))
    }
  })

  connection.on('message', async (message: OcppMessage) => {
    output.verbose(JSON.stringify(message))

    if (message[0] === MessageType.CALLRESULT) {
      const [, msgId, payload] = message
      const action = pendingMessages.get(msgId)
      pendingMessages.delete(msgId)

      if (action) {
        handleCallResult(action, payload, connection, charger)
      } else {
        output.incoming('Response', JSON.stringify(payload))
      }
    } else if (message[0] === MessageType.CALL) {
      const [, msgId, action, payload] = message
      await handleServerMessage(connection, msgId, action, payload, charger)
    } else if (message[0] === MessageType.CALLERROR) {
      const [, msgId, errorCode, errorDescription] = message
      const action = pendingMessages.get(msgId)
      pendingMessages.delete(msgId)
      output.error(`${action ?? 'Unknown'} error: ${errorCode} - ${errorDescription}`)
    }
  })

  connection.on('log', (log) => {
    if (log.level === 'error') {
      output.error(log.message)
    } else if (log.level === 'warn') {
      output.error(log.message)
    } else {
      output.info(log.message)
    }
  })

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: 'sem> '
  })

  rl.prompt()

  rl.on('line', async (line: string) => {
    const trimmed = line.trim()
    if (!trimmed) {
      rl.prompt()
      return
    }

    const parts = trimmed.split(/\s+/)
    const command = parts[0].toLowerCase()
    const args = parts.slice(1)

    try {
      await executeCommand(command, args, connection, charger, rl)
    } catch (err) {
      output.error(`${err}`)
    }

    rl.prompt()
  })

  rl.on('close', () => {
    connection.disconnect().then(() => {
      process.exit(0)
    })
  })
}

function handleCallResult(
  action: string,
  payload: Record<string, unknown>,
  connection: OcppConnection,
  charger: LoadedCharger
): void {
  switch (action) {
    case 'BootNotification': {
      const status = payload.status as string
      const interval = payload.interval as number
      output.incoming('BootNotification', `status=${status} interval=${interval}s`)
      if (status === 'Accepted' && interval > 0) {
        connection.startHeartbeat(interval)
      }
      break
    }
    case 'Heartbeat': {
      const time = payload.currentTime as string
      output.incoming('Heartbeat', `serverTime=${time}`)
      break
    }
    case 'StatusNotification': {
      output.incoming('StatusNotification', 'accepted')
      break
    }
    case 'Authorize': {
      const idTagInfo = payload.idTagInfo as Record<string, unknown>
      output.incoming('Authorize', `status=${idTagInfo?.status}`)
      break
    }
    case 'StartTransaction': {
      const txId = payload.transactionId as number
      const idTagInfo = payload.idTagInfo as Record<string, unknown>
      setTransactionId(charger, txId)
      output.incoming('StartTransaction', `transactionId=${txId} status=${idTagInfo?.status}`)
      break
    }
    case 'StopTransaction': {
      const idTagInfo = payload.idTagInfo as Record<string, unknown> | undefined
      setTransactionId(charger, null)
      output.incoming('StopTransaction', `status=${idTagInfo?.status ?? 'accepted'}`)
      break
    }
    case 'MeterValues': {
      output.incoming('MeterValues', 'accepted')
      break
    }
    case 'DataTransfer': {
      const status = payload.status as string
      const data = payload.data as string | undefined
      output.incoming('DataTransfer', `status=${status}${data ? ` data=${data}` : ''}`)
      break
    }
    default: {
      output.incoming(action, JSON.stringify(payload))
      break
    }
  }
}

async function executeCommand(
  command: string,
  args: string[],
  connection: OcppConnection,
  charger: LoadedCharger,
  rl: Interface
): Promise<void> {
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
      await connection.send(message)
      output.outgoing('BootNotification', `vendor=${identity.vendor} model=${identity.model}`)
      break
    }

    case 'heartbeat': {
      const message = createHeartbeat()
      await connection.send(message)
      output.outgoing('Heartbeat')
      break
    }

    case 'status': {
      if (args.length < 2) {
        output.error('Usage: status <connectorId> <status>')
        output.info(`  Valid statuses: ${VALID_STATUSES.join(', ')}`)
        break
      }
      const connectorId = parseInt(args[0], 10)
      const statusValue = args[1] as ChargePointStatus
      if (isNaN(connectorId)) {
        output.error('connectorId must be a number')
        break
      }
      if (!VALID_STATUSES.includes(statusValue)) {
        output.error(`Invalid status. Valid: ${VALID_STATUSES.join(', ')}`)
        break
      }
      const message = createStatusNotification(connectorId, statusValue)
      await connection.send(message)
      setConnectorStatus(charger, connectorId, statusValue)
      output.outgoing('StatusNotification', `connector=${connectorId} status=${statusValue}`)
      break
    }

    case 'authorize': {
      if (args.length < 1) {
        output.error('Usage: authorize <idTag>')
        break
      }
      const message = createAuthorize(args[0])
      await connection.send(message)
      output.outgoing('Authorize', `idTag=${args[0]}`)
      break
    }

    case 'start': {
      if (args.length < 3) {
        output.error('Usage: start <connectorId> <idTag> <meterStart>')
        break
      }
      const connectorId = parseInt(args[0], 10)
      const idTag = args[1]
      const meterStart = parseInt(args[2], 10)
      if (isNaN(connectorId) || isNaN(meterStart)) {
        output.error('connectorId and meterStart must be numbers')
        break
      }
      const message = createStartTransaction(connectorId, idTag, meterStart)
      await connection.send(message)
      output.outgoing('StartTransaction', `connector=${connectorId} idTag=${idTag} meter=${meterStart}Wh`)
      break
    }

    case 'stop': {
      if (args.length < 2) {
        output.error('Usage: stop <transactionId> <meterStop>')
        break
      }
      const txId = parseInt(args[0], 10)
      const meterStop = parseInt(args[1], 10)
      if (isNaN(txId) || isNaN(meterStop)) {
        output.error('transactionId and meterStop must be numbers')
        break
      }
      const message = createStopTransaction(txId, meterStop)
      await connection.send(message)
      output.outgoing('StopTransaction', `txId=${txId} meter=${meterStop}Wh`)
      break
    }

    case 'meter': {
      if (args.length < 4) {
        output.error('Usage: meter <connectorId> <transactionId> <energyWh> <powerW>')
        break
      }
      const connectorId = parseInt(args[0], 10)
      const txId = parseInt(args[1], 10)
      const energyWh = parseInt(args[2], 10)
      const powerW = parseInt(args[3], 10)
      if (isNaN(connectorId) || isNaN(txId) || isNaN(energyWh) || isNaN(powerW)) {
        output.error('All arguments must be numbers')
        break
      }
      const message = createMeterValues(connectorId, txId, { energyWh, powerW })
      await connection.send(message)
      output.outgoing('MeterValues', `connector=${connectorId} txId=${txId} energy=${energyWh}Wh power=${powerW}W`)
      break
    }

    case 'data': {
      if (args.length < 1) {
        output.error('Usage: data <vendorId> [messageId] [data]')
        break
      }
      const vendorId = args[0]
      const messageId = args[1]
      const data = args.slice(2).join(' ') || undefined
      const message = createDataTransfer({ vendorId, messageId, data })
      await connection.send(message)
      output.outgoing('DataTransfer', `vendorId=${vendorId}${messageId ? ` messageId=${messageId}` : ''}`)
      break
    }

    case 'disconnect': {
      await connection.disconnect()
      output.status('Disconnected')
      break
    }

    case 'help': {
      printHelp()
      break
    }

    case 'exit':
    case 'quit': {
      output.status('Disconnecting...')
      await connection.disconnect()
      rl.close()
      break
    }

    default: {
      output.error(`Unknown command: ${command}. Type "help" for available commands.`)
      break
    }
  }
}

function printHelp(): void {
  output.info('')
  output.info('Available commands:')
  output.info('')
  for (const [, cmd] of Object.entries(COMMANDS)) {
    const padded = cmd.usage.padEnd(40)
    output.info(`  ${padded} ${cmd.description}`)
  }
  output.info('')
}
