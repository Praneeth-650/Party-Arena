# Party Arena

A real-time multiplayer party game MVP using Node.js, Express and Socket.IO.

## Run locally

1. Install Node.js 18 or newer.
2. In this folder run `npm install`.
3. Run `npm start`.
4. Open `http://localhost:3000` on the host device.
5. For friends on the same Wi-Fi, share the host computer's local IP address with port `3000` (for example `http://192.168.1.10:3000`). For players outside your network, deploy this folder to a Node.js host that supports WebSockets (Render, Railway, Fly.io, etc.) and share the public URL.

## Included

- 2–8 players, room codes, nicknames and host controls.
- Hidden Number: each player has a private integer from 0–1,000; unlimited turns; structured yes/no questions; correct guesses determine finishing-order points (N−place, last gets 0); a configurable number of rounds (default 5).
- Impostor: one impostor, shared category, two clue cycles, simultaneous private voting, tied-vote revote, and final word-steal attempt if caught; a configurable number of rounds (default 5).
- Live room state and score updates via Socket.IO.
- Host lobby settings: 3, 5, 7, 10 or a custom 1–30 rounds; placement (default), winner-takes-most or flat scoring.
- Host-only End Room control closes the room for every connected player.
- Hidden Number questions use an inline panel rather than browser prompt dialogs.

## Important MVP notes

- Rooms and scores are held in server memory. Restarting the server clears active games; this MVP does not yet include database persistence or reconnect recovery.
- Hidden Number uses a rotating turn order. Players may ask a question, guess, or pass on each turn.
- In a tied Impostor vote, everyone votes again.
- This is source code, not a hosted public game. Deploy it to a Node.js host to let friends join from anywhere.
- Before public release, add rate limiting, stronger input validation, persistent storage, reconnect handling, and automated tests.

## Room voice chat

- Each player can choose **Join voice**, **Mute mic**, or **Leave** from the room voice bar.
- Audio is sent directly between players using browser WebRTC; Socket.IO is used only to exchange connection setup messages. No audio is recorded or stored by this app.
- Microphone permission is required. Browsers generally require HTTPS for microphone access (localhost is also allowed for local development).
- The included public STUN servers help peers discover network routes, but some mobile networks, corporate Wi-Fi, and strict NATs require a TURN relay. For reliable production voice chat, configure your own TURN service and add its credentials to `rtcConfig` in `public/client.js`.
- Voice uses a peer-to-peer mesh, suitable for this small 2–8 player room size. A larger game would benefit from an SFU voice server.
- Live speaking indicators: player list highlights who is currently talking, using local audio-level detection; no voice recording is made.
