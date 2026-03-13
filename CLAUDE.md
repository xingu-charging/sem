# CLAUDE.md

This file provides guidance to Claude Code when working with the sem repository.

## Repository Summary

**sem** is a headless CLI OCPP 1.6 charger simulator with three operating modes:

- **Daemon** (`sem start`) — background process with persistent WebSocket, controlled via CLI commands (`sem send`, `sem stop`, etc.)
- **REPL** (`sem run`) — interactive terminal for live debugging, type commands at the `sem>` prompt
- **Script** (`sem script`) — run `.sem` script files for repeatable test scenarios

## Technology Stack

- **Runtime**: Node.js 20+ (ESM-only)
- **Language**: TypeScript 5.9 (strict mode, NodeNext module resolution)
- **CLI**: Commander.js for argument parsing
- **WebSocket**: ws library for OCPP connections
- **Output**: chalk for color-coded terminal output

## Project Structure

```Text
src/
  cli.ts                # Entry point — Commander.js command definitions
  repl.ts               # Interactive REPL with command dispatch
  commands.ts           # Shared OCPP command builder (used by REPL, daemon, scripts)
  ocpp/
    types.ts            # OCPP type definitions and enums
    messages.ts         # Client→server message builders (Boot, Start, Stop, Meter, etc.)
    serverMessages.ts   # Server→client response builders (GetConfig, Reset, RemoteStart, etc.)
    configurationKeys.ts # OCPP 1.6 configuration key reference
    connection.ts       # OcppConnection class (WebSocket, heartbeat, reconnect, events)
  lib/
    output.ts           # Color-coded terminal output (chalk)
    charger.ts          # Charger template loader + runtime state (LoadedCharger)
    chargeSession.ts    # Automated charge session engine (Authorize→Start→Meter→Stop flow)
    serverHandler.ts    # Server-initiated message dispatcher (RemoteStart/Stop, Reset, etc.)
    scriptRunner.ts     # .sem script file parser and executor
  daemon/
    server.ts           # Daemon process — Unix socket IPC, persistent connection
    manager.ts          # Daemon lifecycle — spawn, monitor, ready detection
    client.ts           # CLI client — connects to daemon via Unix socket
    types.ts            # Shared IPC request/response types

templates/
  chargers/
    ac-7kw.json         # AC 7kW Type2 Socket
    dc-50kw.json        # DC 50kW CCS2 Cable
    dc-150kw.json       # DC 150kW CCS2 Cable + SoC simulation
  scripts/
    happy-rfid.sem      # Full RFID charge cycle
    happy-remote-start.sem  # Boot + wait for RemoteStartTransaction
    auto-charge.sem     # Automated charge with meter values
    fault-recovery.sem  # Fault simulation and recovery
    firmware-update.sem # Firmware update flow
```

## Code Style (CRITICAL)

- **No semicolons**
- **No trailing commas**
- **No `any` type** - always use meaningful types
- **ESM imports with `.js` extensions** - NodeNext requires `.js` in import paths even for `.ts` files
- Always use types for function parameters and return values

## Build & Run

```bash
pnpm install          # Install dependencies
pnpm build            # Compile TypeScript
pnpm dev              # Watch mode
pnpm lint             # ESLint
pnpm typecheck        # Type checking only
pnpm start            # Run (requires build first)
```

## Architecture Notes

### Layers

- **OCPP layer** (`src/ocpp/`) — output-agnostic, emits `log` events instead of using console.log. Contains message builders, types, and the WebSocket connection class.
- **Command layer** (`src/commands.ts`) — shared command builder used by REPL, daemon, and scripts. Converts user input ("boot", "start 1 TOKEN001 0") into OCPP CALL messages.
- **Session layer** (`src/lib/chargeSession.ts`) — automated charge session engine. Manages the full Authorize→Preparing→StartTransaction→Charging→MeterValues→StopTransaction→Available flow with DC SoC curve simulation.
- **Server handler** (`src/lib/serverHandler.ts`) — dispatches server-initiated messages (RemoteStart, RemoteStop, Reset, GetConfiguration, etc.) and executes side effects when `autoCharge` mode is enabled.
- **Output layer** (`src/lib/output.ts`) — color-coded terminal formatting with chalk. All user-facing output goes through this module.

### Key Patterns

- **Message correlation**: Sent messages are tracked in a `Map<messageId, actionName>`. When a CALLRESULT arrives, it's matched to the original action for formatted output and side effects.
- **SendAndWaitFn**: A callback pattern used by charge sessions and server handlers to send an OCPP message and await the correlated response. Different implementations exist for REPL mode (event listener based) and daemon mode (pending response map).
- **Charger state**: Plain objects (`LoadedCharger`), not Zustand — this is CLI, not React. State includes connector statuses, transaction ID, config overrides, charging profiles, and reservations.
- **Active sessions**: Registered in a module-level `Map<string, ActiveChargeSession>` in `chargeSession.ts`. Sessions with `duration: 0` run indefinitely until stopped externally (RemoteStop, stop-charge command, shutdown).
- **Graceful shutdown**: Best-effort OCPP cleanup (StatusNotification Unavailable for each connector), followed by heartbeat stop and disconnect. Errors during shutdown are caught individually so the disconnect always happens.

### Connection Lifecycle

- Auto-reconnect with exponential backoff (up to 10 attempts, max 30s delay)
- Heartbeat interval set from BootNotification response
- Ping/pong from OCPP gateway auto-replied by ws library
- Heartbeat paused during reconnection, resumed after

### Server-Initiated Message Handling

When `autoCharge` is enabled (default in both REPL and daemon):

- **RemoteStartTransaction** → starts full automated charge session (respects `AuthorizeRemoteTxRequests` config)
- **RemoteStopTransaction** → finds active session by transactionId and stops it
- **Reset** → stops sessions, disconnects, reconnects, re-boots
- **TriggerMessage** → sends the requested message (Boot, Heartbeat, Status, Meter, etc.)
- **ChangeConfiguration** → validates and stores config overrides in memory
- **UpdateFirmware / GetDiagnostics** → simulates full flow with status notifications

### Daemon IPC

The daemon communicates via Unix socket at `/tmp/sem/<id>.sock` using newline-delimited JSON. Request types: `command` (OCPP command), `status` (charger state), `shutdown` (graceful stop). The parent process waits for "READY" on stdout before confirming the session started.
