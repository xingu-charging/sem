# CLAUDE.md

This file provides guidance to Claude Code when working with the sem repository.

## Repository Summary

**sem** is a headless CLI OCPP charger simulator for interactive testing and debugging. It wraps the OCPP protocol layer (migrated from `sim/src/shared/ocpp/`) in a command-line REPL interface.

## Technology Stack

- **Runtime**: Node.js 20+ (ESM-only)
- **Language**: TypeScript 5.9 (strict mode, NodeNext module resolution)
- **CLI**: Commander.js for argument parsing
- **WebSocket**: ws library for OCPP connections
- **Output**: chalk for color-coded terminal output

## Project Structure

```
src/
  cli.ts              # Entry point (#!/usr/bin/env node)
  repl.ts             # Interactive REPL with command dispatch
  ocpp/
    types.ts          # OCPP type definitions
    messages.ts       # Client message builders
    serverMessages.ts # Server message response builders
    configurationKeys.ts # OCPP 1.6 configuration key reference
    connection.ts     # OcppConnection class (WebSocket + events)
  lib/
    output.ts         # Color-coded terminal output (chalk)
    charger.ts        # Charger template loader + runtime state
    serverHandler.ts  # Server-initiated message dispatcher

templates/
  chargers/
    ac-7kw.json       # AC 7kW Type2 Socket
    dc-50kw.json      # DC 50kW CCS2 Cable
    dc-150kw.json     # DC 150kW CCS2 Cable + SoC
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

- The OCPP layer (`src/ocpp/`) is output-agnostic - it emits `log` events instead of using console.log
- The output module (`src/lib/output.ts`) handles all terminal formatting
- Charger state is plain objects (no Zustand - this is CLI, not React)
- The REPL correlates sent messages with responses using a `Map<messageId, actionName>`
- Server-initiated messages are auto-handled by `serverHandler.ts`
