# AI Educator (Gemini Live Gateway)

Cloudflare Worker + React application that bridges real-time microphone audio to Gemini Live API.

## Stack

- **Worker API:** Hono
- **Runtime:** Cloudflare Workers + Vite

## Features

- WebSocket live audio route at `/api/live`
- Health endpoint at `/api/health`
- Browser microphone streaming via `AudioWorklet`
- Real-time PCM playback from Gemini responses

## Setup

1. Install dependencies:
   ```bash
   pnpm install
   ```
2. Configure Gemini API key:
   - Local dev (`.dev.vars`):
     ```env
     GEMINI_API_KEY=your-api-key
     ```
   - Production:
     ```bash
     wrangler secret put GEMINI_API_KEY
     ```
3. Run development server:
   ```bash
   pnpm dev
   ```

## Scripts

- `pnpm dev` - Start Vite + Worker dev server
- `pnpm build` - Type-check and build client + worker
- `pnpm lint` - Run ESLint
- `pnpm deploy` - Build and deploy via Wrangler
