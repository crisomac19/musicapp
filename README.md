# Songsmith — AI Music Generator

A web app where people describe a song and get two full AI-generated tracks, powered by [sunoapi.org](https://docs.sunoapi.org/). Built to deploy on Netlify with no build step.

## Features

- **Simple mode**: describe a song in plain words; lyrics are written automatically.
- **Custom mode**: your own title, lyrics, excluded styles, vocal gender, length (10s–6min), style adherence, weirdness and variety.
- **AI lyrics writer**: generates lyric options you can drop into Custom mode.
- Style quick-picks, instrumental toggle, and model choice (V6, V6 Wild, V6 Mini).
- Live progress, early streaming when the first take is ready, a built-in player, downloads, and copying lyrics.
- Library saved in the browser (localStorage). Unfinished songs keep checking for results after a reload.
- Remaining-credit indicator.

## How it works

```
browser (public/)  ──►  /api/*  (netlify/functions/api.mjs)  ──►  https://api.sunoapi.org/api/v1
```

The browser never sees the API key. The Netlify Function adds it on the server side and checks inputs before passing requests on. The app gets results by polling `GET /generate/record-info`. Suno's required `callBackUrl` points to `/api/callback`, which just acknowledges the call.

| App route              | Suno endpoint                       |
| ---------------------- | ----------------------------------- |
| `POST /api/generate`   | `POST /api/v1/generate`             |
| `GET /api/status`      | `GET /api/v1/generate/record-info`  |
| `POST /api/lyrics`     | `POST /api/v1/lyrics`               |
| `GET /api/lyrics-status` | `GET /api/v1/lyrics/record-info`  |
| `GET /api/credits`     | `GET /api/v1/generate/credit`       |

## Deploy on Netlify

1. In Netlify, choose **Add new site → Import an existing project** and pick this repo. `netlify.toml` already sets the publish folder (`public`) and the functions folder. Leave the build command empty.
2. Go to **Site configuration → Environment variables** and add:
   - `SUNO_API_KEY`: your sunoapi.org key (required)
   - `APP_PASSWORD`: optional. When set, visitors must enter this password before they can generate songs, so strangers can't use up your credits.
3. Redeploy so the function picks up the variables.

## Run locally

```bash
npm i -g netlify-cli
cp .env.example .env   # then put your key in .env
netlify dev
```
