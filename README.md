# AI Educator

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

## Durable object start/stop control

- Open `/control` to view and update the live API state.
- **Start** enables `/api/live`.
- **Stop** disables `/api/live` and returns `503` until started again.
