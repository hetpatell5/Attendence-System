# Attendance Management System

Windows desktop Attendance Management System. Electron + React (desktop client) talking over
HTTPS REST to a NestJS + Prisma + PostgreSQL backend. The database is never accessed directly
by the desktop app — all data access goes through the API.

## Architecture

```
Windows Desktop App (Electron + React + Vite)
        |
        | HTTPS REST API
        v
NestJS Backend (apps/api)
        |
        v
PostgreSQL (CloudPanel in production, Docker locally)
```

## Monorepo layout

- `apps/api` — NestJS backend (Prisma ORM, PostgreSQL)
- `apps/desktop` — Electron + React + Vite desktop client
- `packages/shared` — TypeScript types shared between api and desktop

## Prerequisites

- Node.js >= 20
- pnpm (`corepack enable`)
- Docker (for local PostgreSQL)

## Getting started (development)

```bash
pnpm install

# copy env templates
cp apps/api/.env.example apps/api/.env
cp apps/desktop/.env.example apps/desktop/.env

# start local Postgres
pnpm db:up

# run the backend (in one terminal)
pnpm dev:api

# run the desktop app (in another terminal)
pnpm dev:desktop
```

The desktop app's Login screen shows a live health status pulled from `GET /health` on the
backend, confirming API connectivity and database connectivity.

## Project status

This project is being built in phases. **Phase 1 (this state)** covers monorepo scaffolding,
tooling, and a health-check wired end-to-end between the desktop app and the API. No
authentication, database schema, or business features exist yet — those arrive in later phases.
