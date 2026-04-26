# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Package Does

Match Poll Consumer reads poll events (`poll_created` and `poll_vote`) from the Kafka `poll` topic and persists them to PostgreSQL. It is one package in a monorepo (`../../` is the workspace root).

## Build and Run Commands

```bash
npm run build          # Compile TypeScript (tsc) to dist/
npm run dev            # Watch mode with tsx (hot-reload)
npm run start          # Run compiled output (node dist/index.js)
npm test               # Run tests (vitest)
npm run test:watch     # Run tests in watch mode
npm run liquibase:update  # Apply database migrations (requires liquibase CLI)
```

Build from workspace root: `npm run build -w packages/match-poll-consumer`

Docker image copies only `dist/` and installs production deps — always `npm run build` before building the image.

## Architecture

- **Entry point**: `src/index.ts` — boots Kafka consumer, handles graceful shutdown via SIGTERM/SIGINT.
- **Kafka consumer** (`src/kafka/consumer.ts`): subscribes to the poll topic, parses JSON messages, delegates to the event handler.
- **Event handler** (`src/handlers/pollEventHandler.ts`): routes `poll_created` to match creation and `poll_vote` to the vote flow (find match, find-or-create member, save vote).
- **Repositories** (`src/db/`): separate modules for each table following single-responsibility:
  - `matchRepository.ts` — upserts and queries matches
  - `memberRepository.ts` — finds or auto-creates members by WhatsApp ID
  - `matchVoteRepository.ts` — upserts votes (one per member per match)
  - `client.ts` — manages the shared `pg.Pool`
- **Types** (`src/types/events.ts`): Kafka event interfaces and DB domain types.
- **Config** (`src/config.ts`): all config from env vars with defaults. See `.env.example`.

TypeScript config extends `../../tsconfig.base.json` (ES2022, NodeNext modules, strict mode).

## Database Schema

Three tables managed by Liquibase (`liquibase/` directory):
- `members` — keyed on `whatsapp_id` (auto-created when a new voter is seen)
- `matches` — keyed on `poll_message_id`, stores match date and poll options
- `match_votes` — keyed on `(match_id, member_id)`, upserts on conflict

## Kafka Message Types

Two event types on the `poll` topic:
- `poll_created` — contains `messageId`, `group`, `sender`, `pollName`, `matchDate`, `options[]`, `timestamp`
- `poll_vote` — contains `pollMessageId`, `voter`, `voterName`, `selectedOptions[]`, `timestamp`

## Testing

Tests use vitest with mocked `pg.Pool`. Test files are in `src/__tests__/` mirroring the source modules. Run a single test file with `npx vitest run src/__tests__/memberRepository.test.ts`.

## Coding Standards

- No method longer than 40 lines
- SOLID principles
- Functional programming where possible (exported const arrow functions for repository layer)
- Every method must have a JSDoc comment
