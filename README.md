# Play vs Agent example

Minimal **9-max NLHE** web client for the Poker Study Play vs Agent API.

- Eight villain seats call `POST /api/play/decide`
- Amounts are big blinds (`big_blind: 1`) on both the table and the API
- On your turn, `POST /api/play/evaluate` returns equity and EV
- After the hand, the history lists every decision and scores each one with evaluate
- This app proxies those routes so the browser never talks to pokerstudy.ai directly

Docs: [pokerstudy.ai/docs#play-vs-agent](https://www.pokerstudy.ai/docs#play-vs-agent)

## Run locally

```sh
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Deal a hand, wait for the agents, then act. EV appears on your turn.

A Studio token is required. Paste it in the header, or set `PLAY_API_TOKEN` (see `.env.example`). Decide and evaluate both reject a request with no token.

## What the proxy does

| This app | Upstream |
| --- | --- |
| `POST /api/decide` | `https://www.pokerstudy.ai/api/play/decide` |
| `POST /api/evaluate` | `https://www.pokerstudy.ai/api/play/evaluate` |

Override the host with `PLAY_API_BASE`.
