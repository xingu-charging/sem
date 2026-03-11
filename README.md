# sem

Headless CLI OCPP charger simulator for interactive testing and debugging.

`sem` lets you simulate an OCPP 1.6 charge point from the command line. No GUI required - runs on servers, in CI/CD pipelines, or anywhere Node.js is available.

## Installation

```bash
# Clone and install
git clone https://github.com/xingu-charging/sem.git
cd sem
pnpm install
pnpm build

# Run directly
node dist/cli.js --charger templates/chargers/ac-7kw.json

# Or link globally
pnpm link --global
sem --charger templates/chargers/ac-7kw.json
```

## Usage

```bash
sem --charger <path> [options]

Options:
  --charger <path>    Path to charger JSON template (required)
  --env <name>        Environment override (staging|production|local)
  --url <url>         WebSocket URL override (bypasses template environments)
  --verbose           Show raw OCPP message JSON
  --quiet             Minimal output
  -V, --version       Show version
  -h, --help          Show help
```

### Examples

```bash
# Connect using template defaults (staging)
sem --charger templates/chargers/ac-7kw.json

# Connect to production
sem --charger templates/chargers/dc-50kw.json --env production

# Connect to local OCPP server
sem --charger templates/chargers/ac-7kw.json --url ws://localhost:9000

# Verbose mode (see raw JSON messages)
sem --charger templates/chargers/dc-150kw.json --verbose
```

## REPL Commands

Once connected, type commands at the `sem>` prompt:

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
| `disconnect` | | Close WebSocket |
| `help` | | Show command list |
| `exit` | | Disconnect and exit |

### Valid Status Values

`Available`, `Preparing`, `Charging`, `SuspendedEVSE`, `SuspendedEV`, `Finishing`, `Reserved`, `Unavailable`, `Faulted`

### Example Session

```Text
sem> boot
[->] BootNotification: vendor=Xingu model=AC-7K
[<-] BootNotification: status=Accepted interval=300s

sem> status 1 Available
[->] StatusNotification: connector=1 status=Available
[<-] StatusNotification: accepted

sem> authorize TOKEN001
[->] Authorize: idTag=TOKEN001
[<-] Authorize: status=Accepted

sem> start 1 TOKEN001 0
[->] StartTransaction: connector=1 idTag=TOKEN001 meter=0Wh
[<-] StartTransaction: transactionId=42 status=Accepted

sem> meter 1 42 1500 7000
[->] MeterValues: connector=1 txId=42 energy=1500Wh power=7000W
[<-] MeterValues: accepted

sem> stop 42 5000
[->] StopTransaction: txId=42 meter=5000Wh
[<-] StopTransaction: status=accepted
```

## Server-Initiated Messages

`sem` automatically handles and responds to server-initiated OCPP messages:

| Server Action | Response | Notes |
|---|---|---|
| GetConfiguration | Config keys from template | Supports specific key requests |
| ChangeConfiguration | Accept/Reject based on validation | Stores overrides in memory |
| Reset | Accepted | Displays reset type |
| RemoteStartTransaction | Accepted | Displays connector + idTag |
| RemoteStopTransaction | Accepted | Displays transactionId |
| TriggerMessage | Accepted | Displays requested message |
| GetDiagnostics | Filename | Displays diagnostics URL |
| UpdateFirmware | Accepted | Displays firmware URL |
| ChangeAvailability | Accepted | Displays connector + type |
| ClearCache | Accepted | |
| UnlockConnector | Unlocked | Displays connector ID |
| DataTransfer | Accepted | Displays vendor info |
| Unknown actions | CALLERROR NotImplemented | |

## Charger Template Format

Templates are JSON files defining charger identity, connection, and capabilities:

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

### Included Templates

| Template | Type | Power | Connector |
|----------|------|-------|-----------|
| `ac-7kw.json` | AC single-phase | 7 kW | Type2 Socket |
| `dc-50kw.json` | DC fast | 50 kW | CCS2 Cable |
| `dc-150kw.json` | DC ultra-fast | 150 kW | CCS2 Cable + SoC |

## License

MIT
