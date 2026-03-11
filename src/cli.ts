#!/usr/bin/env node

import { Command } from 'commander'
import { OcppConnection } from './ocpp/connection.js'
import { ConnectionState } from './ocpp/types.js'
import { loadChargerTemplate } from './lib/charger.js'
import { setOutputConfig } from './lib/output.js'
import * as output from './lib/output.js'
import { startRepl } from './repl.js'

const program = new Command()

program
  .name('sem')
  .description('Headless CLI OCPP charger simulator')
  .version('0.1.0')
  .requiredOption('--charger <path>', 'Path to charger JSON template')
  .option('--env <name>', 'Environment override (staging|production|local)')
  .option('--url <url>', 'WebSocket URL override')
  .option('--verbose', 'Show raw OCPP message JSON')
  .option('--quiet', 'Minimal output')
  .action(async (options: { charger: string; env?: string; url?: string; verbose?: boolean; quiet?: boolean }) => {
    // Configure output
    if (options.verbose) {
      setOutputConfig({ verbosity: 'verbose' })
    } else if (options.quiet) {
      setOutputConfig({ verbosity: 'quiet' })
    }

    // Load charger template
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

    // Create connection
    const connection = new OcppConnection()

    connection.on('stateChange', (state: ConnectionState) => {
      if (state === ConnectionState.CONNECTED) {
        charger.state.connected = true
        output.status('Connected')
      } else if (state === ConnectionState.DISCONNECTED) {
        charger.state.connected = false
      }
    })

    // Connect
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

    // Start REPL
    output.info('Type "help" for available commands.')
    output.info('')
    startRepl(connection, charger)
  })

program.parse()
