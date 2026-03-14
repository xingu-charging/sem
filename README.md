# sem

Headless CLI OCPP charger simulator for testing and debugging.

`sem` simulates OCPP 1.6 charge points from the command line. No GUI required — runs on servers, in CI/CD pipelines, containers, or anywhere Node.js is available.

## Modes

sem has three operating modes:

| Mode | Command | Use Case |
|------|---------|----------|
| [Daemon](#daemon-mode) | `sem start` | Background process, control via CLI commands. Best for persistent sessions. |
| [REPL](#interactive-repl-mode) | `sem run` | Interactive terminal, type commands directly. Best for live debugging. |
| [Script](#script-mode) | `sem script` | Run a `.sem` script file. Best for repeatable test scenarios. |

## Installation

Install from npm:

```bash
pnpm add -g @xingu-charging/sem
# or
npm install -g @xingu-charging/sem
# or
yarn global add @xingu-charging/sem
```

Then run with a charger template:

```bash
sem start --charger node_modules/@xingu-charging/sem/templates/chargers/ac-7kw.json
```

### From Source

```bash
git clone https://github.com/xingu-charging/sem.git
cd sem
pnpm install
pnpm build

# Run directly
node dist/cli.js start --charger templates/chargers/ac-7kw.json

# Or link globally
pnpm link --global
sem start --charger templates/chargers/ac-7kw.json
```

## Daemon Mode

Daemon mode runs a charger as a background process with a persistent WebSocket connection. You control it by sending commands from separate shell invocations. This is the primary way to use sem.

### Start a Session

```bash
sem start --charger templates/chargers/ac-7kw.json
```

On start, sem will:

1. Connect to the OCPP gateway via WebSocket
2. Send `BootNotification` and wait for `Accepted`
3. Start the heartbeat loop at the server-specified interval
4. Send `StatusNotification(Available)` for each connector in the template
5. Print the session ID and exit — the charger keeps running in the background

```Text
Session SEM-AC7K-001 started (pid 12345)
  Send commands:  sem send SEM-AC7K-001 <command> [args...]
  View logs:      sem logs SEM-AC7K-001
  Stop session:   sem stop SEM-AC7K-001
```

The session ID is the `chargerId` from the template (e.g., `SEM-AC7K-001`).

#### Options

```Text
--charger <path>    Path to charger JSON template (required)
--env <name>        Environment override (staging|production|local)
--url <url>         WebSocket URL override
--no-boot           Connect without auto-boot sequence
```

Use `--no-boot` to connect the WebSocket without sending BootNotification or StatusNotification — useful when you want full manual control.

### Send Commands

Send OCPP commands to a running session. Each command waits for the server's response (10s timeout) and prints both the outgoing message and the response.

```bash
sem send <session-id> <command> [args...]
```

```bash
sem send SEM-AC7K-001 heartbeat
# [->] Heartbeat
# [<-] Heartbeat: serverTime=2025-01-15T10:30:00.000Z

sem send SEM-AC7K-001 authorize TOKEN001
# [->] Authorize: idTag=TOKEN001
# [<-] Authorize: status=Accepted

sem send SEM-AC7K-001 start 1 TOKEN001 0
# [->] StartTransaction: connector=1 idTag=TOKEN001 meter=0Wh
# [<-] StartTransaction: transactionId=42 status=Accepted

sem send SEM-AC7K-001 meter 1 42 1500 7000
# [->] MeterValues: connector=1 txId=42 energy=1500Wh power=7000W
# [<-] MeterValues: accepted

sem send SEM-AC7K-001 stop 42 5000
# [->] StopTransaction: txId=42 meter=5000Wh
# [<-] StopTransaction: status=accepted
```

Because each command returns the actual server response, you can read real values like `transactionId` from `StartTransaction` and use them in subsequent commands.

### Automated Charge Sessions

Start an automated charge session that runs the full OCPP flow (Authorize, Preparing, StartTransaction, Charging, MeterValues loop, StopTransaction, Available) in the background:

```bash
sem charge <session-id> <connectorId> <idTag> [options]
```

```bash
# AC charge: 60 seconds at 7kW
sem charge SEM-AC7K-001 1 TOKEN001 --duration 60 --power 7000

# DC charge with SoC simulation: charge from 20% to 80%
sem charge SEM-DC50K-001 1 TOKEN001 --duration 300 --power 50000 --soc-start 20 --soc-end 80

# Stop a running charge session
sem stop-charge SEM-DC50K-001 1
```

#### Charge Options

```Text
--duration <seconds>    Charging duration (default: 60, 0 = run until stopped)
--power <watts>         Charging power (default: charger max or 7000)
--interval <seconds>    Meter value interval (default: 30)
--soc-start <percent>   Starting SoC for DC (default: 20)
--soc-end <percent>     Target SoC for DC (default: 80)
--battery <wh>          Battery capacity for DC (default: 60000)
```

DC chargers simulate a realistic charging curve: ramp-up below 20% SoC, constant power from 20-80%, and taper above 80%.

### View Logs

Read the OCPP event log for a session. Logs include timestamps, all sent/received messages, server-initiated commands, heartbeats, and connection events.

```bash
sem logs <session-id>                # Last 50 lines (default)
sem logs <session-id> --lines 100    # Last 100 lines
```

Logs persist after the session stops, so you can review what happened even after calling `sem stop`.

### Check Status

Get the current state of a running session.

```bash
sem status <session-id>
```

Shows: connection state, uptime, active transaction ID, and connector statuses.

### List Sessions

List all active charger sessions.

```bash
sem list
```

Shows each session's charger ID, PID, running state, template name, and connection URL.

### Stop a Session

Gracefully disconnect and clean up.

```bash
sem stop <session-id>
```

This sends `StatusNotification(Unavailable)` for each connector, stops the heartbeat, disconnects the WebSocket, removes the Unix socket and PID file, and terminates the daemon process. The log file is preserved.

## Interactive REPL Mode

REPL mode provides an interactive terminal where you type OCPP commands directly and see responses in real time. Best for live debugging and exploring the OCPP protocol.

```bash
sem run --charger templates/chargers/ac-7kw.json
```

```Text
Charger: AC 7kW Wallbox (SEM-AC7K-001)
URL: wss://ocpp-staging.xingu-charging.com/SEM-AC7K-001
Protocol: ocpp1.6
Connected
Type "help" for available commands.

sem> boot
[->] BootNotification: vendor=Xingu model=Wallbox-7K serial=SEM-AC7K-001
[<-] BootNotification: status=Accepted interval=30

sem> status 1 Available
[->] StatusNotification: connector=1 status=Available
[<-] StatusNotification: accepted

sem> charge 1 TOKEN001 60 7000
Charge session started on connector 1 (60s, 7000W)
[auto] Authorizing idTag=TOKEN001...
[auto] Authorization accepted
[auto] Connector 1: Preparing
...
```

Or pipe commands via stdin for scripted use:

```bash
echo -e "boot\nstatus 1 Available\nexit" | sem run --charger templates/chargers/ac-7kw.json --quiet
```

### REPL Options

```Text
--charger <path>    Path to charger JSON template (required)
--env <name>        Environment override (staging|production|local)
--url <url>         WebSocket URL override
--verbose           Show raw OCPP message JSON
--quiet             Minimal output
```

### REPL Commands

All [OCPP commands](#ocpp-commands) are available, plus these REPL-specific commands:

| Command | Arguments | Description |
|---------|-----------|-------------|
| `charge` | `<conn> <idTag> [duration] [power] [interval] [socStart] [socEnd] [batteryWh]` | Run full automated charge session |
| `stop-charge` | `<conn>` | Stop active charge session on a connector |
| `shutdown` | | Graceful shutdown (stop sessions, set connectors Unavailable, disconnect) |
| `disconnect` | | Close WebSocket connection immediately (no OCPP messages) |
| `help` | | Show available commands |
| `exit` / `quit` | | Graceful shutdown and exit |

## Script Mode

Script mode runs a `.sem` script file for automated, repeatable test scenarios. Scripts support OCPP commands, timing, server message expectations, and variable substitution.

```bash
sem script <file> --charger templates/chargers/ac-7kw.json
```

### Script Syntax

```bash
# Comments start with #

# Send an OCPP command
send boot
send status 1 Available
send authorize TOKEN001
send start 1 TOKEN001 0

# Wait a number of seconds
wait 5

# Wait for a server-initiated message (with timeout in seconds)
expect RemoteStartTransaction 120

# Use $txId to reference the transaction ID from the last StartTransaction
send meter 1 $txId 1500 7000
send stop $txId 5000

# Run an automated charge session
charge 1 TOKEN001 60 7000

# Set custom variables
set myTag TOKEN001
send authorize $myTag
```

### Included Scripts

| Script | Description |
|--------|-------------|
| `happy-rfid.sem` | Full RFID charge cycle: boot, authorize, charge, stop |
| `happy-remote-start.sem` | Boot and wait for RemoteStartTransaction from server |
| `auto-charge.sem` | Automated charge session with meter values |
| `fault-recovery.sem` | Simulate charger fault and recovery |
| `firmware-update.sem` | Firmware update flow with status notifications |

```bash
sem script templates/scripts/happy-rfid.sem --charger templates/chargers/ac-7kw.json
```

### Script Options

```Text
--charger <path>    Path to charger JSON template (required)
--env <name>        Environment override (staging|production|local)
--url <url>         WebSocket URL override
--verbose           Show raw OCPP message JSON
--quiet             Minimal output
```

## OCPP Commands

These commands are available across all modes — via `sem send` (daemon), the REPL prompt, or `send` instructions in scripts.

| Command | Arguments | Description |
|---------|-----------|-------------|
| `boot` | | Send BootNotification |
| `heartbeat` | | Send Heartbeat |
| `status` | `<connectorId> <status> [errorCode]` | Send StatusNotification |
| `authorize` | `<idTag>` | Send Authorize |
| `start` | `<connectorId> <idTag> <meterStart>` | Send StartTransaction |
| `stop` | `<transactionId> <meterStop>` | Send StopTransaction |
| `meter` | `<connectorId> <txId> <energyWh> <powerW>` | Send MeterValues |
| `data` | `<vendorId> [messageId] [data]` | Send DataTransfer |
| `firmware-status` | `<status>` | Send FirmwareStatusNotification |
| `diagnostics-status` | `<status>` | Send DiagnosticsStatusNotification |

### Valid Status Values

`Available`, `Preparing`, `Charging`, `SuspendedEVSE`, `SuspendedEV`, `Finishing`, `Reserved`, `Unavailable`, `Faulted`

## Server-Initiated Messages

sem automatically handles and responds to server-initiated OCPP messages. In daemon mode these are logged; in REPL mode they appear in the terminal in real time.

| Server Action | Response | Side Effects |
|---|---|---|
| GetConfiguration | Config keys from template | |
| ChangeConfiguration | Accept/Reject based on validation | Stores overrides in memory |
| Reset | Accepted | Reconnects with boot sequence |
| RemoteStartTransaction | Accepted | Starts automated charge session |
| RemoteStopTransaction | Accepted | Stops active charge session |
| TriggerMessage | Accepted | Sends the requested message |
| GetDiagnostics | Filename | Simulates diagnostics upload flow |
| UpdateFirmware | Accepted | Simulates firmware update flow |
| ChangeAvailability | Accepted | Updates connector status |
| ClearCache | Accepted | |
| UnlockConnector | Unlocked | |
| DataTransfer | Accepted | |
| SetChargingProfile | Accepted | Stores profile in memory |
| ReserveNow | Accepted/Rejected | Sets connector to Reserved |
| CancelReservation | Accepted/Rejected | Returns connector to Available |
| Unknown actions | CALLERROR NotImplemented | |

## Example Workflows

### Full Charging Session (Daemon)

```bash
# Start charger (auto-boots and sets connectors to Available)
sem start --charger templates/chargers/ac-7kw.json

# Authorize an RFID tag
sem send SEM-AC7K-001 authorize TOKEN001

# Prepare connector
sem send SEM-AC7K-001 status 1 Preparing

# Start transaction (note the transactionId in the response)
sem send SEM-AC7K-001 start 1 TOKEN001 0

# Set connector to Charging
sem send SEM-AC7K-001 status 1 Charging

# Send meter values (use the transactionId from start response)
sem send SEM-AC7K-001 meter 1 42 1500 7000
sem send SEM-AC7K-001 meter 1 42 5000 7000

# Stop transaction
sem send SEM-AC7K-001 stop 42 5000

# Return to Available
sem send SEM-AC7K-001 status 1 Available

# Done — stop the session
sem stop SEM-AC7K-001
```

### Automated Charge Session (Daemon)

```bash
sem start --charger templates/chargers/dc-50kw.json
sem charge SEM-DC50K-001 1 TOKEN001 --duration 120 --power 50000
# Charge runs in background with meter values and SoC simulation

# Check progress
sem logs SEM-DC50K-001

# Stop early if needed
sem stop-charge SEM-DC50K-001 1
sem stop SEM-DC50K-001
```

### Simulate a Faulted Charger

```bash
sem start --charger templates/chargers/dc-50kw.json
sem send SEM-DC50K-001 status 1 Faulted

# Check the logs to see server reactions
sem logs SEM-DC50K-001

# Recover
sem send SEM-DC50K-001 status 1 Available
sem stop SEM-DC50K-001
```

### Multiple Chargers

```bash
sem start --charger templates/chargers/ac-7kw.json
sem start --charger templates/chargers/dc-50kw.json

sem list
# SEM-AC7K-001   running  pid=12345  AC 7kW Wallbox  ...
# SEM-DC50K-001  running  pid=12346  DC 50kW Fast    ...

sem send SEM-AC7K-001 heartbeat
sem send SEM-DC50K-001 heartbeat

sem stop SEM-AC7K-001
sem stop SEM-DC50K-001
```

## Programmatic API

sem exposes a programmatic API for direct integration into Node.js applications, test runners, and CI/CD pipelines — no CLI subprocess spawning needed.

```bash
pnpm add @xingu-charging/sem
```

### Exports

```typescript
import {
  startDaemon,
  sendCommand,
  getStatus,
  shutdown,
  cleanStaleSessions,
  loadChargerTemplate
} from '@xingu-charging/sem'

import type {
  StartDaemonOptions,
  StartDaemonResult,
  DaemonResponse,
  SessionMetadata,
  LoadedCharger
} from '@xingu-charging/sem'
```

| Function | Returns | Description |
|----------|---------|-------------|
| `startDaemon(options)` | `Promise<StartDaemonResult>` | Spawn a daemon process from a charger template. Returns `{ sessionId, pid }` |
| `sendCommand(sessionId, command, args)` | `Promise<DaemonResponse>` | Send an OCPP command to a running daemon |
| `getStatus(sessionId)` | `Promise<DaemonResponse>` | Get current charger state (connected, transactionId, connectors) |
| `shutdown(sessionId)` | `Promise<DaemonResponse>` | Gracefully disconnect and stop the daemon |
| `cleanStaleSessions()` | `void` | Remove session files for dead daemon processes |
| `loadChargerTemplate(path, env?, url?)` | `LoadedCharger` | Parse a charger JSON template without starting a daemon |

### Using with Cypress E2E Tests

The programmatic API integrates directly into Cypress tasks, enabling real OCPP charging sessions in E2E tests. Here's how to set it up:

**1. Install sem in your test project:**

```bash
pnpm add -D @xingu-charging/sem
```

**2. Register Cypress tasks in `cypress.config.ts`:**

```typescript
import { startDaemon, sendCommand, getStatus, shutdown } from '@xingu-charging/sem'
import { writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// Inside setupNodeEvents:
const semTemplateDir = join(tmpdir(), 'sem-templates')
mkdirSync(semTemplateDir, { recursive: true })

on('task', {
  async semStart({ chargerId, username, password }) {
    // Generate a charger template dynamically
    const template = {
      name: `E2E ${chargerId}`,
      identity: { vendor: 'Xingu', model: 'E2E-AC7K', serialNumber: chargerId },
      connection: { chargerId, protocol: '1.6', username, password },
      capabilities: { maxPower: 7000, phases: 1, voltage: 230, maxCurrent: 32 },
      connectors: [{ connectorId: 1, type: 'Type2', format: 'Socket',
                     powerType: 'AC_1_PHASE', maxPower: 7000, maxVoltage: 230, maxAmperage: 32 }],
      meterValueConfig: { sampleInterval: 10,
        measurands: ['Energy.Active.Import.Register', 'Power.Active.Import'] }
    }

    const chargerPath = join(semTemplateDir, `${chargerId}.json`)
    writeFileSync(chargerPath, JSON.stringify(template, null, 2))

    const result = await startDaemon({
      chargerPath,
      url: 'wss://ocpp-staging.xingu-charging.com',
      noBoot: false
    })
    return { sessionId: result.sessionId }
  },

  async semCharge({ sessionId, connectorId, idTag, duration, power, interval }) {
    await sendCommand(sessionId, 'charge', [
      String(connectorId), idTag, String(duration), String(power), String(interval)
    ])
    return null
  },

  async semStatus({ sessionId }) {
    return getStatus(sessionId)
  },

  async semShutdown({ sessionId }) {
    await shutdown(sessionId)
    return null
  }
})
```

**3. Use in test specs:**

```typescript
// Start daemon — connects to OCPP gateway, boots, sets connectors Available
cy.task('semStart', { chargerId: 'MY-CHARGER-001', username: 'user', password: 'pass' })
  .then((result) => {
    cy.task('setState', { key: 'semSessionId', value: result.sessionId })
  })

// Run a 60-second charge session at 7kW
cy.task('semCharge', {
  sessionId: 'MY-CHARGER-001', connectorId: 1, idTag: 'TOKEN001',
  duration: 60, power: 7000, interval: 10
})

// Poll until charge completes (transactionId becomes null)
function pollUntilComplete(attempts) {
  if (attempts <= 0) throw new Error('Charge session did not complete')
  cy.task('semStatus', { sessionId: 'MY-CHARGER-001' }).then((status) => {
    if (status.type === 'status' && status.transactionId === null) return
    cy.wait(5000)
    pollUntilComplete(attempts - 1)
  })
}
pollUntilComplete(18) // 90 second timeout

// Verify session appears in your UI
cy.visit('/chargers/MY-CHARGER-001')
cy.get('.MuiDataGrid-row').should('exist')

// Cleanup
cy.task('semShutdown', { sessionId: 'MY-CHARGER-001' })
```

### Using in Node.js Scripts

```typescript
import { startDaemon, sendCommand, getStatus, shutdown } from '@xingu-charging/sem'

const { sessionId } = await startDaemon({
  chargerPath: './templates/chargers/ac-7kw.json',
  url: 'wss://ocpp-staging.xingu-charging.com',
  noBoot: false
})

console.log(`Session started: ${sessionId}`)

// Run a charge session
await sendCommand(sessionId, 'charge', ['1', 'TOKEN001', '60', '7000', '10'])

// Poll for completion
let status = await getStatus(sessionId)
while (status.type === 'status' && status.transactionId !== null) {
  await new Promise(r => setTimeout(r, 5000))
  status = await getStatus(sessionId)
}

console.log('Charge complete')
await shutdown(sessionId)
```

## Charger Template Format

Templates are JSON files defining charger identity, connection settings, and capabilities:

```json
{
  "name": "My Charger",
  "identity": {
    "vendor": "Acme",
    "model": "WallBox-7K",
    "serialNumber": "SN-001",
    "firmwareVersion": "1.0.0"
  },
  "connection": {
    "environments": {
      "staging": "wss://ocpp-staging.example.com",
      "production": "wss://ocpp.example.com",
      "local": "ws://localhost:9000"
    },
    "defaultEnvironment": "staging",
    "chargerId": "CHARGER-001",
    "protocol": "1.6",
    "username": "user",
    "password": "pass"
  },
  "capabilities": {
    "maxPower": 7000,
    "phases": 1,
    "voltage": 230,
    "maxCurrent": 32,
    "features": ["RemoteTrigger", "FirmwareManagement"]
  },
  "connectors": [
    {
      "connectorId": 1,
      "type": "Type2",
      "format": "Socket",
      "powerType": "AC_1_PHASE",
      "maxPower": 7000,
      "maxVoltage": 230,
      "maxAmperage": 32
    }
  ],
  "meterValueConfig": {
    "sampleInterval": 30,
    "measurands": [
      "Energy.Active.Import.Register",
      "Power.Active.Import"
    ]
  }
}
```

### Template Fields

| Field | Required | Description |
|-------|----------|-------------|
| `name` | No | Display name for the charger |
| `identity` | Yes | OCPP identity fields sent in BootNotification |
| `connection.environments` | Yes | Named WebSocket URLs (staging, production, etc.) |
| `connection.defaultEnvironment` | No | Which environment to use by default (default: `staging`) |
| `connection.chargerId` | No | Charger ID appended to URL (default: `identity.serialNumber`) |
| `connection.protocol` | No | OCPP protocol version (default: `1.6`) |
| `connection.username/password` | No | Basic Auth credentials for WebSocket connection |
| `capabilities` | No | Charger power/phase/voltage specs |
| `connectors` | No | Connector definitions (default: 1 connector) |
| `meterValueConfig` | No | Meter value sample interval and measurands |
| `ocppConfiguration` | No | OCPP configuration key overrides |

### Included Templates

| Template | Type | Power | Connector |
|----------|------|-------|-----------|
| `ac-7kw.json` | AC single-phase | 7 kW | Type2 Socket |
| `dc-50kw.json` | DC fast | 50 kW | CCS2 Cable |
| `dc-150kw.json` | DC ultra-fast | 150 kW | CCS2 Cable + SoC |

## Architecture

```Text
sem start ──spawn──> sem _daemon (detached child process)
   |                      |
   | wait for ready       |-- OcppConnection (WebSocket to OCPP gateway)
   |                      |-- Unix socket server at /tmp/sem/<id>.sock
   |<── READY ────────────|-- Log writer -> /tmp/sem/<id>.log
   |                      |-- Auto-handles server messages
   v                      '-- Heartbeat loop
 prints session info
 exits

sem send <id> <cmd> ──connect──> /tmp/sem/<id>.sock
   |                                    |
   |                              daemon executes command
   |                              waits for OCPP response
   |<── JSON response ─────────────────'
   v
 prints output, exits

sem logs <id> ──reads──> /tmp/sem/<id>.log
sem stop <id> ──connect──> socket ──> shutdown ──> daemon exits
sem list ──scans──> /tmp/sem/*.json (metadata files)
```

### Session Files

All session files live in `/tmp/sem/`:

| File | Purpose |
|------|---------|
| `<id>.sock` | Unix socket for IPC |
| `<id>.pid` | PID of daemon process |
| `<id>.log` | Plain-text event log (no ANSI colors) |
| `<id>.json` | Metadata (chargerId, name, URL, protocol, startedAt, pid) |

## Development

```bash
pnpm install          # Install dependencies
pnpm build            # Compile TypeScript
pnpm dev              # Watch mode
pnpm lint             # ESLint
pnpm typecheck        # Type checking only
```

## License

MIT
