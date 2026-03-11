# sem

Headless CLI OCPP charger simulator for testing and debugging.

`sem` simulates OCPP 1.6 charge points from the command line. No GUI required — runs on servers, in CI/CD pipelines, containers, or anywhere Node.js is available.

## Installation

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

This disconnects the WebSocket, removes the Unix socket and PID file, and terminates the daemon process. The log file is preserved.

## OCPP Commands

These commands are available via `sem send` (daemon mode) or the interactive REPL.

| Command | Arguments | Description |
|---------|-----------|-------------|
| `boot` | | Send BootNotification |
| `heartbeat` | | Send Heartbeat |
| `status` | `<connectorId> <status>` | Send StatusNotification |
| `authorize` | `<idTag>` | Send Authorize |
| `start` | `<connectorId> <idTag> <meterStart>` | Send StartTransaction |
| `stop` | `<transactionId> <meterStop>` | Send StopTransaction |
| `meter` | `<connectorId> <txId> <energyWh> <powerW>` | Send MeterValues |
| `data` | `<vendorId> [messageId] [data]` | Send DataTransfer |

### Valid Status Values

`Available`, `Preparing`, `Charging`, `SuspendedEVSE`, `SuspendedEV`, `Finishing`, `Reserved`, `Unavailable`, `Faulted`

## Example Workflows

### Full Charging Session

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

## Server-Initiated Messages

sem automatically handles and responds to server-initiated OCPP messages while the daemon is running:

| Server Action | Response | Notes |
|---|---|---|
| GetConfiguration | Config keys from template | Supports specific key requests |
| ChangeConfiguration | Accept/Reject based on validation | Stores overrides in memory |
| Reset | Accepted | Hard and Soft reset |
| RemoteStartTransaction | Accepted | |
| RemoteStopTransaction | Accepted | |
| TriggerMessage | Accepted | |
| GetDiagnostics | Filename | |
| UpdateFirmware | Accepted | |
| ChangeAvailability | Accepted | |
| ClearCache | Accepted | |
| UnlockConnector | Unlocked | |
| DataTransfer | Accepted | |
| Unknown actions | CALLERROR NotImplemented | |

All server-initiated messages are logged and visible via `sem logs`.

## Interactive REPL Mode

For quick interactive testing, sem also supports a REPL mode where you type commands directly:

```bash
sem --charger templates/chargers/ac-7kw.json
```

Or pipe commands via stdin for scripted use:

```bash
echo -e "boot\nstatus 1 Available\nexit" | sem --charger templates/chargers/ac-7kw.json --quiet
```

REPL-specific commands: `disconnect`, `help`, `exit`/`quit`.

REPL options: `--verbose` (show raw JSON), `--quiet` (minimal output).

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
