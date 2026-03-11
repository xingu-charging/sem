#!/usr/bin/env node

/**
 * @file CLI entry point — parses arguments and dispatches to REPL or daemon subcommands.
 * @module @xingu-charging/sem
 * @license MIT
 *
 * Copyright (c) 2026 Xingu Charging
 * https://github.com/xingu-charging/sem
 */

import { Command } from 'commander'
import { OcppConnection } from './ocpp/connection.js'
import { ConnectionState } from './ocpp/types.js'
import { loadChargerTemplate } from './lib/charger.js'
import { setOutputConfig } from './lib/output.js'
import * as output from './lib/output.js'
import { startRepl } from './repl.js'
import { startDaemon } from './daemon/manager.js'
import { sendCommand, getStatus, shutdown, readLogs, listSessions } from './daemon/client.js'
import { runDaemon } from './daemon/server.js'

const program = new Command()

program
  .name('sem')
  .description('Headless CLI OCPP charger simulator')
  .version('0.1.0')

// Default command: REPL mode (backward compatible)
program
  .command('run', { isDefault: true })
  .description('Interactive REPL mode (default)')
  .requiredOption('--charger <path>', 'Path to charger JSON template')
  .option('--env <name>', 'Environment override (staging|production|local)')
  .option('--url <url>', 'WebSocket URL override')
  .option('--verbose', 'Show raw OCPP message JSON')
  .option('--quiet', 'Minimal output')
  .action(async (options: { charger: string; env?: string; url?: string; verbose?: boolean; quiet?: boolean }) => {
    if (options.verbose) {
      setOutputConfig({ verbosity: 'verbose' })
    } else if (options.quiet) {
      setOutputConfig({ verbosity: 'quiet' })
    }

    let charger
    try {
      charger = loadChargerTemplate(options.charger, options.env, options.url)
    } catch (err) {
      output.error(`Failed to load charger template: ${err}`)
      process.exit(1)
    }

    output.status(`Charger: ${charger.name} (${charger.chargerId})`)
    output.status(`URL: ${charger.url}`)
    output.status(`Protocol: ${charger.protocol}`)
    output.info('')

    const connection = new OcppConnection()

    connection.on('stateChange', (state: ConnectionState) => {
      if (state === ConnectionState.CONNECTED) {
        charger.state.connected = true
        output.status('Connected')
      } else if (state === ConnectionState.DISCONNECTED) {
        charger.state.connected = false
      }
    })

    output.status('Connecting...')
    try {
      await connection.connect({
        url: charger.url,
        protocol: charger.protocol,
        auth: charger.auth
      })
    } catch (err) {
      output.error(`Connection failed: ${err}`)
      process.exit(1)
    }

    output.info('Type "help" for available commands.')
    output.info('')
    startRepl(connection, charger)
  })

// Daemon: start persistent session
program
  .command('start')
  .description('Start a persistent charger session (daemon mode)')
  .requiredOption('--charger <path>', 'Path to charger JSON template')
  .option('--env <name>', 'Environment override (staging|production|local)')
  .option('--url <url>', 'WebSocket URL override')
  .option('--no-boot', 'Skip auto-boot sequence')
  .action(async (options: { charger: string; env?: string; url?: string; boot: boolean }) => {
    try {
      const result = await startDaemon({
        chargerPath: options.charger,
        env: options.env,
        url: options.url,
        noBoot: !options.boot
      })
      output.status(`Session ${result.sessionId} started (pid ${result.pid})`)
      output.info(`  Send commands:  sem send ${result.sessionId} <command> [args...]`)
      output.info(`  View logs:      sem logs ${result.sessionId}`)
      output.info(`  Stop session:   sem stop ${result.sessionId}`)
    } catch (err) {
      output.error(`${err instanceof Error ? err.message : err}`)
      process.exit(1)
    }
  })

// Send command to running daemon
program
  .command('send <id> <command> [args...]')
  .description('Send a command to a running session')
  .action(async (id: string, command: string, args: string[]) => {
    try {
      const response = await sendCommand(id, command, args)
      if (response.type === 'result') {
        for (const line of response.output) {
          console.log(line)
        }
      } else if (response.type === 'error') {
        output.error(response.message)
        process.exit(1)
      }
    } catch (err) {
      output.error(`${err instanceof Error ? err.message : err}`)
      process.exit(1)
    }
  })

// Read logs from running or completed session
program
  .command('logs <id>')
  .description('Read recent log entries from a session')
  .option('--lines <n>', 'Number of lines to show', '50')
  .action((id: string, options: { lines: string }) => {
    try {
      const lines = readLogs(id, parseInt(options.lines, 10))
      for (const line of lines) {
        console.log(line)
      }
    } catch (err) {
      output.error(`${err instanceof Error ? err.message : err}`)
      process.exit(1)
    }
  })

// Get status of running session
program
  .command('status <id>')
  .description('Get status of a running session')
  .action(async (id: string) => {
    try {
      const response = await getStatus(id)
      if (response.type === 'status') {
        output.status(`Session: ${response.chargerId}`)
        output.info(`  Connected: ${response.connected}`)
        output.info(`  Uptime: ${response.uptime}s`)
        output.info(`  Transaction: ${response.transactionId ?? 'none'}`)
        output.info(`  Connectors:`)
        for (const [connId, status] of Object.entries(response.connectorStates)) {
          output.info(`    ${connId}: ${status}`)
        }
      } else if (response.type === 'error') {
        output.error(response.message)
        process.exit(1)
      }
    } catch (err) {
      output.error(`${err instanceof Error ? err.message : err}`)
      process.exit(1)
    }
  })

// Stop running session
program
  .command('stop <id>')
  .description('Gracefully stop a running session')
  .action(async (id: string) => {
    try {
      const response = await shutdown(id)
      if (response.type === 'result') {
        output.status(`Session ${id} stopped`)
      } else if (response.type === 'error') {
        output.error(response.message)
        process.exit(1)
      }
    } catch (err) {
      output.error(`${err instanceof Error ? err.message : err}`)
      process.exit(1)
    }
  })

// List active sessions
program
  .command('list')
  .description('List active charger sessions')
  .action(() => {
    const sessions = listSessions()
    if (sessions.length === 0) {
      output.info('No active sessions')
      return
    }
    for (const session of sessions) {
      const status = session.alive ? 'running' : 'dead'
      output.info(`${session.chargerId}  ${status}  pid=${session.pid}  ${session.name}  ${session.url}  started=${session.startedAt}`)
    }
  })

// Hidden internal daemon process command
program
  .command('_daemon', { hidden: true })
  .requiredOption('--charger <path>', 'Path to charger JSON template')
  .requiredOption('--session-id <id>', 'Session ID')
  .option('--env <name>', 'Environment override')
  .option('--url <url>', 'WebSocket URL override')
  .option('--no-boot', 'Skip auto-boot sequence')
  .action(async (options: { charger: string; sessionId: string; env?: string; url?: string; boot: boolean }) => {
    await runDaemon({
      charger: options.charger,
      sessionId: options.sessionId,
      env: options.env,
      url: options.url,
      boot: options.boot
    })
  })

program.parse()
