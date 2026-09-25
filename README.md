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

Deploy your own copy on Vercel and set `PLAY_API_TOKEN` to a Studio personal access token from [pokerstudy.ai/settings/api](https://www.pokerstudy.ai/settings/api). The shared demo does not hold a token, so Deal stays off there.

[Deploy your own on Vercel](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fhft-studio%2Fplay-vs-agent-example&env=PLAY_API_TOKEN&envDescription=Studio%20personal%20access%20token%20(psk_)&envLink=https%3A%2F%2Fwww.pokerstudy.ai%2Fsettings%2Fapi&project-name=play-vs-agent&repository-name=play-vs-agent)

## What the proxy does

| This app | Upstream |
| --- | --- |
| `POST /api/decide` | `https://www.pokerstudy.ai/api/play/decide` |
| `POST /api/evaluate` | `https://www.pokerstudy.ai/api/play/evaluate` |

Override the host with `PLAY_API_BASE`.
