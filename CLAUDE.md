# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Escape-room venue system: a public touchscreen **kiosk** (check in, book a game, high scores) plus a staff **admin** backend. Node >= 22.5 (uses built-in `node:sqlite`), Express 4, vanilla-JS frontends served as static files. No build step, no bundler, no TypeScript, and **no test or lint tooling**.

## Commands

```
npm install
npm start                 # node server/index.js  (kiosk: /, admin: /admin/)
npm run dev               # node --watch server/index.js
npm run create-admin -- "Name" email password   # create/reset an admin (upsert by email)
```

Config comes from `.env` (copy `.env.example`); `PORT`, `DATA_DIR`, `TIMEZONE` matter most when developing.

There is no test suite. Verify changes by running a **throwaway instance** so real data in `data/app.db` is never touched:

```
DATA_DIR=/tmp/scratch PORT=3101 node server/create-admin.js T t@example.com testpass123
DATA_DIR=/tmp/scratch PORT=3101 node server/index.js
```

then drive it with `curl` (staff login sets an `sid` cookie; use `-c/-b`) or the browser pane. A dev server may already be running on `PORT` 3000 from `npm run dev`; use another port and stop only what you started.

## Architecture

**Server (`server/`)**: `index.js` mounts `routes/public.js` (unauthenticated kiosk API, `/api/public`) and `routes/admin.js` (`/api/admin`), then serves `public/shared`, `public/admin` and `public/kiosk` statically. Admin routes are ordered by privilege: `login/logout` → `requireAuth` → routes any staff can use (bookings, availability, rooms read, SSE events) → `requireAdmin` → admin-only routes (rooms/difficulties/scores/staff/settings CRUD). Route placement in that file decides who can call it.

**Persistence (`server/db.js`)**: single SQLite file at `DATA_DIR/app.db`. Schema is `CREATE TABLE IF NOT EXISTS`; schema changes to existing installs are **inline migrations in `db.js`** guarded by `PRAGMA table_info` checks (see the `short_description` add and `ercc_ref` drop) — new columns must be added both to the CREATE and as a guarded migration. Default rooms are seeded once, tracked by a `seeded` row in `settings`, so deleting every room doesn't resurrect them. `server/env.js` must remain the first import wherever `process.env` is read (ES import order).

**Booking model (`server/bookings.js`)**: rooms have per-weekday `hours` JSON; a *difficulty* belongs to a room and defines duration/buffer/player limits. A room is blocked from `start_min` to `start + duration + buffer`, regardless of difficulty, so overlap is checked per **room**, not per difficulty. All dates/times are local wall-clock in `TIMEZONE` (`localNow()`), stored as `YYYY-MM-DD` + minutes-after-midnight; bookings cannot span midnight. `createBooking` has a `strict` kiosk mode (min notice, days-ahead window, player limits, phone required) vs. staff mode (only conflict checks). `slotsFor` is the single source of truth for availability. Conflict check + insert run synchronously, which is what makes it race-free in one process.

**Deletes**: rooms/difficulties are referenced by bookings and scores with foreign keys. `deleteWithBookings` in `routes/admin.js` refuses with a 409 + counts unless `?force=1`, then deletes bookings/scores/difficulties/room in one transaction. SQLite reuses max row ids after deletion (no AUTOINCREMENT).

**Notifications**: `notify.js` `notifyStaff()` does two things for each kiosk sign-up/check-in: emits on an in-process `EventEmitter` (consumed by the SSE endpoint `GET /api/admin/events`, which drives browser Notification API pop-ups and auto-refresh in the admin page) and fans out via `deliver()` to per-staff ntfy topics, Twilio SMS, and shared webhook/ntfy topic from settings. It is fire-and-forget and must never throw into a request handler. Results are logged to the `notifications` table.

**High scores**: no external API. Admins enter them manually (`scores` table, `/api/admin/scores`); the kiosk reads `/api/public/scores` (fastest first, only active rooms/difficulties).

**Auth (`server/auth.js`)**: scrypt password hashes, random session tokens stored as SHA-256 in `sessions`, `HttpOnly`/`SameSite=Strict` cookie `sid`. `rateLimit()` is a small in-memory limiter used on kiosk bookings/check-in and staff login.

**Frontends (`public/`)**: no framework. `shared/ui.js` provides `h()` (DOM builder using `textContent`/attributes only — **never use `innerHTML`** with user data), `api()` (throws errors carrying `.status` and `.data`) and formatting helpers; `shared/markdown.js` is a small safe Markdown→DOM renderer used for room descriptions. `kiosk/kiosk.js` is a screen-function state machine (`screen(name, ...nodes)` swaps content and re-arms the idle-reset timer); `kiosk/keyboard.js` is the on-screen keyboard for inputs with `data-kb` (inputs use `inputmode="none"`). `admin/admin.js` is a single-file SPA with tabs rendered by `renderX(main)` functions and `modal()` dialogs; `renderShell()` re-renders the current tab after any change.

## Gotchas

- **Express 4 does not catch rejected promises.** Sync handlers can `throw new HttpError(status, msg)` (handled by the error middleware in `index.js`); async handlers must `.then(..., next)` or respond themselves.
- Windows dev machine: in Git Bash, inline `node -e "..."` with nested quotes and JSON bodies is fragile; prefer writing a script file for anything non-trivial.
- Kiosk endpoints are intentionally unauthenticated; the kiosk shows only "First L." names and verifies check-in with the last 4 phone digits or a 6-char confirmation code.
- `data/` and `.env` are git-ignored; `.claude/` is untracked local tooling config.
