/**
 * @file OCPP WebSocket connection — manages the WebSocket lifecycle including
 * connect, disconnect, reconnect with exponential backoff, heartbeat loop,
 * and event-based message dispatch.
 * @module @xingu-charging/sem
 * @license MIT
 *
 * Copyright (c) 2026 Xingu Charging
 * https://github.com/xingu-charging/sem
 */

import WebSocket from 'ws'
import {
  ConnectionConfig,
  ConnectionState,
  OcppMessage
} from './types.js'
import { isValidOcppMessage, createHeartbeat } from './messages.js'

/** Event types emitted by OcppConnection. */
export type ConnectionEventMap = {
  /** Fired when the connection state changes (connecting, connected, disconnected, error) */
  stateChange: ConnectionState
  /** Fired when an OCPP message is received from the server */
  message: OcppMessage
  /** Fired after an OCPP message is successfully sent to the server */
  messageSent: OcppMessage
  /** Fired on WebSocket or protocol errors */
  error: Error
  /** Structured log events for the connection lifecycle */
  log: { level: 'info' | 'warn' | 'error'; message: string }
}

/**
 * Manages the OCPP WebSocket connection lifecycle.
 *
 * Provides connect/disconnect, automatic reconnection with exponential backoff,
 * periodic heartbeat sending, and a typed event emitter for message correlation.
 * This class is output-agnostic — it emits `log` events instead of writing to console.
 */
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

  /** Get the current connection state. */
  getState(): ConnectionState {
    return this.state
  }

  /**
   * Open a WebSocket connection to an OCPP gateway.
   * Resolves when the connection is established, rejects on error/timeout.
   * Automatically enables reconnection on unexpected disconnects.
   */
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

        // Log ping events from gateway (gateway pings every 30s to detect dead connections)
        // The ws library auto-sends pong, but logging helps diagnose connection issues
        this.ws.on('ping', () => {
          this.emit('log', { level: 'info', message: 'Gateway ping received (pong auto-sent)' })
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

        this.ws.on('close', (code: number, reason: Buffer) => {
          this.emit('log', { level: 'warn', message: `WebSocket closed: code=${code} reason=${reason.toString() || 'none'}` })
          // Pause heartbeat (preserves interval for resume after reconnect)
          this.pauseHeartbeat()
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

  /** Close the WebSocket connection, stop heartbeat, cancel reconnection, and clear all listeners. */
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

  /** Start the periodic heartbeat loop. Replaces any existing heartbeat timer. */
  startHeartbeat(intervalSeconds: number): void {
    this.stopHeartbeat()
    this.heartbeatInterval = intervalSeconds
    const intervalMs = intervalSeconds * 1000

    this.heartbeatTimer = setInterval(() => {
      this.sendHeartbeat()
    }, intervalMs)

    this.emit('log', { level: 'info', message: `Heartbeat started: every ${intervalSeconds}s` })
  }

  /** Stop the heartbeat loop and log that it was stopped. */
  stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
      this.emit('log', { level: 'info', message: 'Heartbeat stopped' })
    }
  }

  /** Pause heartbeat without logging (used during reconnection). */
  pauseHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  /** Resume heartbeat after reconnection, if a heartbeat interval was previously set. */
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

  /** Send an OCPP message over the WebSocket. Emits 'messageSent' on success. */
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

  /** Subscribe to a typed connection event. */
  on<K extends keyof ConnectionEventMap>(
    event: K,
    handler: (data: ConnectionEventMap[K]) => void
  ): void {
    this.listeners.get(event)?.add(handler as (data: unknown) => void)
  }

  /** Unsubscribe from a typed connection event. */
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
        // Resume heartbeat if it was running before disconnect
        this.resumeHeartbeat()
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
