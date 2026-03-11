import WebSocket from 'ws'
import {
  ConnectionConfig,
  ConnectionState,
  OcppMessage
} from './types.js'
import { isValidOcppMessage, createHeartbeat } from './messages.js'

export type ConnectionEventMap = {
  stateChange: ConnectionState
  message: OcppMessage
  messageSent: OcppMessage
  error: Error
  log: { level: 'info' | 'warn' | 'error'; message: string }
}

export class OcppConnection {
  private ws: WebSocket | null = null
  private config: ConnectionConfig | null = null
  private state: ConnectionState = ConnectionState.DISCONNECTED
  private listeners: Map<string, Set<(data: unknown) => void>> = new Map()
  private heartbeatTimer: NodeJS.Timeout | null = null
  private heartbeatInterval: number = 0
  private shouldReconnect: boolean = false
  private reconnectTimer: NodeJS.Timeout | null = null
  private reconnectAttempts: number = 0
  private maxReconnectAttempts: number = 10
  private reconnectDelayMs: number = 1000

  constructor() {
    this.listeners.set('stateChange', new Set())
    this.listeners.set('message', new Set())
    this.listeners.set('messageSent', new Set())
    this.listeners.set('error', new Set())
    this.listeners.set('log', new Set())
  }

  getState(): ConnectionState {
    return this.state
  }

  async connect(config: ConnectionConfig): Promise<void> {
    if (this.state === ConnectionState.CONNECTED) {
      throw new Error('Already connected')
    }

    this.config = config
    this.shouldReconnect = true
    this.setState(ConnectionState.CONNECTING)

    return new Promise((resolve, reject) => {
      try {
        const url = config.url
        const headers: Record<string, string> = {}

        if (config.auth) {
          const { username, password } = config.auth
          const auth = Buffer.from(`${username}:${password}`).toString('base64')
          headers['Authorization'] = `Basic ${auth}`
        }

        this.ws = new WebSocket(url, [config.protocol], {
          headers,
          handshakeTimeout: 120000
        })

        this.ws.on('open', () => {
          this.reconnectAttempts = 0
          this.reconnectDelayMs = 1000
          this.setState(ConnectionState.CONNECTED)
          resolve()
        })

        this.ws.on('message', (data: WebSocket.Data) => {
          this.handleMessage(data)
        })

        this.ws.on('error', (error: Error) => {
          this.stopHeartbeat()

          const isTimeout = error.message.includes('timed out') || error.message.includes('timeout')
          const isNetworkError = error.message.includes('ECONNREFUSED') ||
                                  error.message.includes('ENOTFOUND') ||
                                  error.message.includes('ENETUNREACH')

          if (isTimeout || isNetworkError) {
            this.emit('log', { level: 'warn', message: `Retryable error: ${error.message}` })
          } else {
            this.emit('log', { level: 'error', message: `Fatal error: ${error.message}` })
          }

          this.setState(ConnectionState.ERROR)
          this.emit('error', error)
          reject(error)
        })

        this.ws.on('close', () => {
          this.stopHeartbeat()
          this.setState(ConnectionState.DISCONNECTED)

          if (this.shouldReconnect) {
            this.attemptReconnect()
          }
        })
      } catch (error) {
        this.stopHeartbeat()
        this.setState(ConnectionState.ERROR)
        reject(error)
      }
    })
  }

  async disconnect(): Promise<void> {
    this.shouldReconnect = false
    this.stopReconnection()
    this.stopHeartbeat()
    if (this.ws) {
      this.ws.removeAllListeners()
      this.ws.close()
      this.ws = null
    }
    this.setState(ConnectionState.DISCONNECTED)
    this.clearAllListeners()
  }

  private clearAllListeners(): void {
    this.listeners.forEach((handlers) => handlers.clear())
  }

  startHeartbeat(intervalSeconds: number): void {
    this.stopHeartbeat()
    this.heartbeatInterval = intervalSeconds
    const intervalMs = intervalSeconds * 1000

    this.heartbeatTimer = setInterval(() => {
      this.sendHeartbeat()
    }, intervalMs)

    this.emit('log', { level: 'info', message: `Heartbeat started: every ${intervalSeconds}s` })
  }

  stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
      this.emit('log', { level: 'info', message: 'Heartbeat stopped' })
    }
  }

  pauseHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  resumeHeartbeat(): void {
    if (this.heartbeatInterval > 0 && !this.heartbeatTimer && this.state === ConnectionState.CONNECTED) {
      const intervalMs = this.heartbeatInterval * 1000
      this.heartbeatTimer = setInterval(() => {
        this.sendHeartbeat()
      }, intervalMs)
    }
  }

  private async sendHeartbeat(): Promise<void> {
    if (this.state !== ConnectionState.CONNECTED) {
      this.emit('log', { level: 'info', message: 'Heartbeat skipped: not connected' })
      this.stopHeartbeat()
      return
    }

    try {
      const heartbeatMessage = createHeartbeat()
      await this.send(heartbeatMessage)
      this.emit('log', { level: 'info', message: 'Heartbeat sent' })
    } catch (error) {
      this.emit('log', { level: 'error', message: `Failed to send heartbeat: ${error}` })
      this.emit('error', error as Error)
      this.stopHeartbeat()
    }
  }

  async send(message: OcppMessage): Promise<void> {
    if (!this.ws || this.state !== ConnectionState.CONNECTED) {
      throw new Error('Not connected')
    }

    return new Promise((resolve, reject) => {
      const json = JSON.stringify(message)
      this.ws!.send(json, (error) => {
        if (error) {
          reject(error)
        } else {
          this.emit('messageSent', message)
          resolve()
        }
      })
    })
  }

  private handleMessage(data: WebSocket.Data): void {
    try {
      const message = JSON.parse(data.toString())

      if (!isValidOcppMessage(message)) {
        throw new Error('Invalid OCPP message format')
      }

      this.emit('message', message as OcppMessage)
    } catch (error) {
      this.emit('error', error as Error)
    }
  }

  private setState(state: ConnectionState): void {
    this.state = state
    this.emit('stateChange', state)
  }

  on<K extends keyof ConnectionEventMap>(
    event: K,
    handler: (data: ConnectionEventMap[K]) => void
  ): void {
    this.listeners.get(event)?.add(handler as (data: unknown) => void)
  }

  off<K extends keyof ConnectionEventMap>(
    event: K,
    handler: (data: ConnectionEventMap[K]) => void
  ): void {
    this.listeners.get(event)?.delete(handler as (data: unknown) => void)
  }

  private emit<K extends keyof ConnectionEventMap>(
    event: K,
    data: ConnectionEventMap[K]
  ): void {
    this.listeners.get(event)?.forEach((handler) => handler(data))
  }

  private attemptReconnect(): void {
    this.stopReconnection()

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.emit('log', { level: 'error', message: `Max reconnection attempts (${this.maxReconnectAttempts}) reached` })
      this.shouldReconnect = false
      return
    }

    this.reconnectAttempts++
    this.emit('log', {
      level: 'info',
      message: `Reconnecting (${this.reconnectAttempts}/${this.maxReconnectAttempts}) in ${this.reconnectDelayMs / 1000}s...`
    })

    this.reconnectTimer = setTimeout(async () => {
      if (!this.shouldReconnect || !this.config) {
        return
      }

      try {
        this.emit('log', { level: 'info', message: 'Reconnecting...' })
        await this.connect(this.config)
        this.emit('log', { level: 'info', message: 'Reconnection successful' })
      } catch (_error) {
        this.emit('log', { level: 'error', message: 'Reconnection failed' })
        this.reconnectDelayMs = Math.min(this.reconnectDelayMs * 2, 30000)
      }
    }, this.reconnectDelayMs)
  }

  private stopReconnection(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }
}
