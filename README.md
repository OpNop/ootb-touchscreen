# Escape Room Kiosk

Touchscreen kiosk (sign-in, sign-up/booking, leaderboard) plus a staff backend. Node 22.5+ (built-in SQLite), Express, no build step.

```
npm install
copy .env.example .env     # edit it (admin login, timezone, integrations)
npm start
```

- Kiosk: `http://localhost:3000/` — run the kiosk PC's browser fullscreen: `chrome --kiosk http://<server>:3000/`
- Staff admin: `http://localhost:3000/admin/` — first admin comes from `ADMIN_EMAIL` / `ADMIN_PASSWORD` in `.env` (change it!). More admins: `npm run create-admin -- "Name" email password`.

## What's in it

| Area | Notes |
|---|---|
| Kiosk sign-in | Tap name from today's list → last 4 digits of booking phone, or enter the 6-char confirmation code. Names shown as "First L." |
| Kiosk sign-up | Room → difficulty → day → time → players → details (on-screen keyboard) → confirm. Returns a confirmation code. |
| Leaderboard | Entered manually by admins under **Leaderboard** (room/difficulty, team, time as `mm:ss`, players, date; "Save & add another" for batch entry). The kiosk leaderboard shows the fastest 10, filterable by room and difficulty. Deleting a room/difficulty also deletes its scores. |
| Staff schedule | Calendar (rooms as columns for a day, days as columns for a week) or list view, toggled in the toolbar; click an empty slot to book, click a booking to edit. Create/edit/cancel, check in, complete, no-show. Prevents double-booking per room (any difficulty). |
| Rooms | Add rooms and difficulties in the UI (length, reset buffer, player limits, per-weekday hours). Each room has a short description (shown on the kiosk room card) and a full Markdown description (shown in the "More info" pop-up) with a live preview. Markdown supported: `**bold**`, `*italic*`, `## headings`, `- bullets`, `1. numbered`, `---`. Rooms and difficulties can be deleted from their edit dialogs; if bookings exist you're warned with the count and must confirm that they're deleted too (unticking Active instead hides a room but keeps its history). Seeded once with 2 rooms x 2 difficulties. |
| Staff & alerts | Add/remove staff (untick Active = logged out + no more alerts). Roles: `admin` (everything) and `staff` (bookings). |

## Staff notifications (sign-up and check-in)

Configured per person in **Staff & alerts**, plus optional shared channels in **Settings**:

1. **Push via ntfy (recommended, free, no phone numbers):** each staff member gets a private topic. They install the ntfy app, subscribe to it, done. Use "Test alert" to verify.
2. **Shared channel:** one Slack/Discord webhook URL and/or one shared ntfy topic in Settings — the whole team just joins the channel.
3. **SMS via Twilio:** fill `TWILIO_*` in `.env`, then tick "Text message" and enter a mobile number per person (costs per message).

4. **Browser notifications (admin page):** click **🔕 Alerts off** in the admin header and allow notifications. While the admin page is open (even in a background tab) a pop-up and beep fire on each sign-up/check-in, and the schedule refreshes itself. A service worker (`public/admin/sw.js`) plus Web Push also delivers the pop-up **when the page is closed**, as long as the browser is running. It's a per-browser opt-in and needs HTTPS or `localhost` (browsers refuse service workers on plain `http://`). Signing out stops pushes to that browser until the next sign-in; deactivating a staff member removes their subscriptions. The VAPID keys that identify the server are generated automatically and stored in the database, so don't delete `data/app.db` without expecting staff to re-enable alerts.

Delivery results (and failures) are listed under **Alert log**. Notifications never delay or break a booking.

## Deployment notes

- Put it behind HTTPS (e.g. Caddy/nginx) and set `COOKIE_SECURE=true` if staff will use the admin from outside the building. The kiosk endpoints are intentionally unauthenticated; consider restricting `/admin` and `/api/admin` to staff networks.
- Back up `data/app.db`.
- Times are stored as local wall-clock time in `TIMEZONE`; bookings can't span midnight.
