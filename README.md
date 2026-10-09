# Escape Room Kiosk

Touchscreen kiosk (sign-in, sign-up/booking, high scores) plus a staff backend. Node 22.5+ (built-in SQLite), Express, no build step.

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
| High scores | `/api/public/scores` proxies the ERCC API (cached 60s, stale fallback). Demo data until configured. |
| Staff schedule | Calendar (rooms as columns for a day, days as columns for a week) or list view, toggled in the toolbar; click an empty slot to book, click a booking to edit. Create/edit/cancel, check in, complete, no-show. Prevents double-booking per room (any difficulty). |
| Rooms | Add rooms and difficulties in the UI (length, reset buffer, player limits, per-weekday hours). Seeded with 2 rooms x 2 difficulties. |
| Staff & alerts | Add/remove staff (untick Active = logged out + no more alerts). Roles: `admin` (everything) and `staff` (bookings). |

## Staff notifications (sign-up and check-in)

Configured per person in **Staff & alerts**, plus optional shared channels in **Settings**:

1. **Push via ntfy (recommended, free, no phone numbers):** each staff member gets a private topic. They install the ntfy app, subscribe to it, done. Use "Test alert" to verify.
2. **Shared channel:** one Slack/Discord webhook URL and/or one shared ntfy topic in Settings — the whole team just joins the channel.
3. **SMS via Twilio:** fill `TWILIO_*` in `.env`, then tick "Text message" and enter a mobile number per person (costs per message).

Delivery results (and failures) are listed under **Alert log**. Notifications never delay or break a booking.

## ERCC high scores — to finish

The ERCC wiki doesn't document the endpoint; the docs are served by your own ERCC install (Settings → enable API → *Open API Documentation*). Set `ERCC_BASE_URL`, `ERCC_SCORES_PATH` and the optional auth header in `.env`, then adjust `normalize()` in `server/ercc.js` to the real field names if they differ.

## Deployment notes

- Put it behind HTTPS (e.g. Caddy/nginx) and set `COOKIE_SECURE=true` if staff will use the admin from outside the building. The kiosk endpoints are intentionally unauthenticated; consider restricting `/admin` and `/api/admin` to staff networks.
- Back up `data/app.db`.
- Times are stored as local wall-clock time in `TIMEZONE`; bookings can't span midnight.
