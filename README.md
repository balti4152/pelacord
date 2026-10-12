# Pelacord

A peer-to-peer chat, voice and screen-share app. The UI and design system are derived from
[Fluxer](https://fluxer.app) (AGPL-3.0-or-later); the color tokens in `src/styles/theme.css`
come from Fluxer's own `GenerateColorSystem.ts` script.

Goal: drop Discord/Fluxer's paid media tier and run calls + 1080p screen share directly
between a small, fixed group over a [ZeroTier](https://www.zerotier.com/) network.

## Status

Working UI prototype (v0). Everything is client-side and persists to `localStorage`.
There is **no networking yet** — messages, files, profile and settings live only in the browser.

### Implemented

- Discord/Fluxer-style shell: channel sidebar, chat, member list.
- Text channels with grouped messages, hover timestamps, cozy/compact display.
- File attachments: images preview inline (with lightbox), other files render as a download card.
- Emoji picker and message composer (Enter to send, Shift+Enter for newline).
- Voice: joining a voice channel keeps the **chat full screen** (as if not in a call) and shows a
  **"Voice Connected" panel bottom-left** with mute, deafen, camera, screen-share and disconnect.
  Clicking the connected voice channel (or the panel) opens a **full-screen call view**: a
  participant grid, or the shared screen in focus with participants in a strip. Clicking any text
  channel closes the call view while staying connected.
- Member list with presence (online / idle / dnd / offline), bot tags, custom status.
- Settings modal:
  - **My Account**: display name, tag, custom status, bio, presence.
  - **Profile**: avatar upload, banner upload, banner gradients/color, accent color, live preview.
  - **Appearance**: theme (Dark / Light / Coal), font scale, message display, member list.
  - **Custom CSS**: override Fluxer/Pelacord CSS variables and inject a custom stylesheet.

### Not yet implemented

- Real networking. Messages/files are local only.
- Actual WebRTC media (voice, camera, screen share). The controls are wired to state only.
- The P2P signalling layer over ZeroTier (see below).

## Run it

```bash
cd pelacord
npm install
npm run dev
```

Open http://localhost:5175.

Desktop app (the real target: peer-to-peer over ZeroTier):

```bash
npm run dev        # terminal 1: the UI
npm run electron   # terminal 2: the desktop shell + ZeroTier peer mesh
```

The desktop shell starts a small signalling node on port `7788` and connects to every peer in
the roster. See **Desktop app** below.

```bash
npm run build      # producción web
npm run typecheck  # tsc --noEmit
npm run dist       # instalador de Windows (release/Pelacord Setup x.y.z.exe)
```

## Desktop app (peer-to-peer over ZeroTier)

The desktop app is how presence and calls run **without any server and without configuring
anything**. Each peer:

- joins the same **ZeroTier** network and gets a stable IP (e.g. `10.147.17.x`),
- opens Pelacord, writes their name once, and is ready,
- the app **finds the other peers by itself** (UDP broadcast over the ZeroTier network) and
  opens a direct WebSocket to each one on port `7788`.

Presence ("who is in a call") and WebRTC signalling travel peer-to-peer over that mesh.
Nothing about calls touches Firebase.

### Descubrimiento automático

No hay que editar ninguna lista. La app anuncia su nombre por broadcast UDP en la red de
ZeroTier y escucha a los demás. En cuanto dos personas están en la misma red de ZeroTier con la
app abierta, se ven.

### Firewall

Port `7788` (TCP) must be allowed on the ZeroTier interface so peers can reach each other.
On Windows, allow the app through the firewall for private networks.

## Design provenance

- `src/styles/theme.css` — copied from Fluxer's generated `color-system.css`
  (produced by `fluxer_app/scripts/GenerateColorSystem.ts`). Same token names, same hues.
- Theming/custom-CSS model mirrors Fluxer's approach: CSS variables + a custom stylesheet.
- Fluxer is AGPL-3.0-or-later. Keep this project's license compatible if it ships.

## Delivery plan (decided)

- **Messages:** stored in **Firebase Firestore** (free Spark plan, no credit card). Each peer
  syncs the log on connect, so a message sent while you were offline is waiting for you.
- **Files:** the bytes are **not** uploaded to Firebase. Only file *metadata* goes to Firestore.
  The actual content is served **directly by the sender while they are online**, over ZeroTier.
  So a file is downloadable only while whoever shared it is connected — no storage bill.
- **Media (voice, camera, screen share):** never touches Firebase. It stays **P2P over ZeroTier**.
  Firebase is only the small message/metadata log.
- **Who is in a call (presence):** deliberately **NOT** on Firebase. It runs **peer-to-peer over
  ZeroTier** through the desktop transport (`electron/main.cjs` + `src/lib/desktop.ts`), so it
  never consumes the free quota. In the browser (no desktop shell) it is local-only.

## Roadmap

1. **Signalling.** WebRTC needs a signalling channel, and a browser cannot accept inbound
   connections. Two options: a tiny stateless relay (keeps the web app), or a desktop
   (Electron) app per peer with a static ZeroTier roster and peer-to-peer signalling sockets.
2. **Media.** Full-mesh WebRTC for a small group (<= 8), screen share as a published track.
   On ZeroTier the peers are mutually routable, so ICE host candidates suffice
   (`iceServers: []`), and no STUN/TURN is needed. Mind mDNS candidate obfuscation.
3. **Persistence.** Decide between a relay/server for history or a distributed approach.
4. **Scale.** Above ~4 participants or for many viewers, a mesh makes the publisher upload
   N-1 copies; a small SFU (e.g. self-hosted LiveKit) is the better fit.

## Project layout

```
src/
  App.tsx                      app shell (rail + sidebar + chat + members + settings)
  main.tsx                     entry point
  types.ts                     domain types
  state/store.tsx              reducer + context, localStorage, theme + CSS injection
  components/
    primitives.tsx             icons, Avatar, IconButton helpers
    ServerRail.tsx             left rail
    ChannelSidebar.tsx         channel list + user panel
    ChatView.tsx               header, message list, attachments, lightbox
    Composer.tsx               message input + file attach + emoji
    VoicePanel.tsx             in-call panel
    MemberList.tsx             right member list
    SettingsModal.tsx          account / profile / appearance / custom CSS
  styles/
    theme.css                  Fluxer color tokens (dark / light / coal)
    global.css                 reset + base tokens
    app.css                    component styles
```
