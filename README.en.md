# Movie Together (فیلم با هم)

Two friends, one synced video, live voice. Plain Node.js + Socket.IO server that also serves the PWA (no build step, one deploy).

## Architecture
- `server.js` – Express + Socket.IO: room creation (`POST /api/rooms`, rate-limited), ICE config (`/api/ice`), WebRTC signaling relay, playback sync, chat. Rooms live in memory and expire 10 min after emptying (no database needed for the MVP).
- `rooms.js` – pure room logic (membership, host handover, playback position extrapolation for late joiners). Tested in `test/`.
- `public/index.html` – the whole client: Persian (RTL) default + English, voice (WebRTC "perfect negotiation"), sync, chat, optional screen share. `sw.js` + `manifest.webmanifest` make it installable.
- Sync: any member can play/pause/seek/change rate; the host also sends a position tick every 3 s so the other player corrects drift above 0.6 s. Late joiners and reconnecting peers receive the server's extrapolated position.
- Voice uses its own `<audio>` element, separate from the video, with echo cancellation on. Use headphones.

## Browser limits (honest version)
- Most sites cannot be iframed (X-Frame-Options/CSP/DRM/login). The app tries; if blank, use screen sharing. It never bypasses DRM or access controls. Iframe pages are **not** synced.
- Screen sharing (`getDisplayMedia`) is generally unavailable in Android browsers; the app says so instead of faking it. Tab-audio capture is not reliable anywhere on mobile.
- Direct media must be MP4/WebM (H.264/VP9) over **https**, and the file server must allow playback from other origins.
- Microphone and WebRTC need HTTPS (localhost excepted).

## Run locally (beginner)
1. Install Node.js 20.6+ from nodejs.org.
2. In a terminal: `cd movie-together && npm install`
3. `cp .env.example .env` (leave it as is for local use) then `npm run dev`
4. Open http://localhost:3000 in two browser tabs/windows. Run `npm test` to run the tests.

## Test with two phones
Phones need HTTPS for the microphone. Expose your PC temporarily: `npx localtunnel --port 3000` (or `ngrok http 3000`, or `cloudflared tunnel --url http://localhost:3000`), then open the https URL on both phones.

## Deploy (Render, Railway or Fly.io)
Frontend and backend are one service, so no CORS setup is needed.
- Render: New → Web Service → connect your repo → Build `npm install`, Start `npm start`, set `NODE_ENV=production`. You get HTTPS/WSS automatically. The free tier sleeps when idle (first visit is slow, and a restart drops open rooms). Use a paid instance for a persistent one.
- Run a single instance only (rooms are in memory).

## TURN (needed for reliable voice)
STUN alone fails on many mobile/carrier networks. Rent a small VPS and install coturn:
`use-auth-secret`, `static-auth-secret=<long random>`, `realm=turn.example.com`, `tls-listening-port=5349` with a certificate, open UDP/TCP 3478 and 5349 plus relay ports 49152–65535.
Then set `TURN_URLS` and `TURN_SECRET` on your host (see `.env.example`). The server issues 24-hour credentials; nothing secret is in the frontend code. Hosted TURN services also work with `TURN_USERNAME`/`TURN_CREDENTIAL`.

## Two-phone checklist
- [ ] Phone A creates a room, copies invite link, phone B opens it (both see two names, "Connected")
- [ ] Both allow the microphone; "Voice connected" shows; both hear each other with headphones
- [ ] Mute/unmute works on each side
- [ ] A loads an MP4 link; B's player loads it; play/pause/seek/speed mirror
- [ ] B refreshes mid-playback and lands at the right position
- [ ] Switch one phone from Wi-Fi to mobile data; status shows reconnecting, then recovers
- [ ] Chat messages arrive both ways; third device gets "room is full"
- [ ] Leave button returns home; room link still works for rejoin
- [ ] On desktop: screen share starts, other side sees it

## Known gaps in this MVP
No automated buffering pause (a stalled player will drift until the next tick), no browser-level tests for the WebRTC code, PNG icons not included (SVG icon only; some Android versions want 192/512 PNGs for the install prompt), and the app code has not been run in a real browser by me.
