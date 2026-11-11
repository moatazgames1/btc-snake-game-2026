# BTC Snake — project starter

This repository is a separate project from Moataz Games.

## Architecture

- `index.html`: responsive Arabic/English 3D game client (Three.js).
- `backend/worker.js`: Cloudflare Worker API + WebSocket multiplayer room (`SnakeRoom` Durable Object).
- `backend/schema.sql`: isolated D1 schema.
- `backend/wrangler.toml`: Worker deployment configuration.
- `firebase-config.js.example`: Firebase web configuration template.

## Important release boundaries

This is a deployable **first playable foundation**, not a finished money-transfer business.
- The real-time arena is server-coordinated through a Durable Object.
- The first version uses virtual game points only. Solo practice and multiplayer use separate rooms; solo results are not added to the global ranking.
- BTC withdrawals are deliberately disabled. Lightning/on-chain payouts need a real payment provider, compliance checks, treasury controls, and audited transaction handling.
- Ad integrations are placeholders. Do not insert ads until the site is approved by an ad network. Rewarded cosmetic unlocks must only be granted after a provider's server-side verification callback is implemented.
- Never pay for ad clicks, never ask players to click ads, and never show ads over active gameplay.
- Admin access is restricted by `ADMIN_UIDS` on the Worker. Set it before exposing the admin endpoint.
- Firebase client config is public by design; server secrets must never be placed in the frontend.

## Create the separate resources

1. Create a new **public** GitHub repository named `btc-snake` under the existing GitHub account. Do not change `moatazgames1.github.io`.
2. Upload the complete contents of this ZIP to the repository root. The root already contains `index.html`.
3. Enable GitHub Pages for `main` / `/ (root)`. The project URL will be:
   `https://moatazgames1.github.io/btc-snake/`
4. In the same Cloudflare account, create a new D1 database named `btc-snake-db`. Apply `backend/schema.sql`.
5. Create a new Worker named `btc-snake-api`, using `backend/worker.js`, and configure:
   - D1 binding: `DB` -> `btc-snake-db`
   - Durable Object binding: `ROOMS` -> class `SnakeRoom`
   - Durable Object migration: `new_sqlite_classes = ["SnakeRoom"]`
   - Secret: `FIREBASE_API_KEY`
   - Secret: `ADMIN_UIDS` (comma-separated Firebase UIDs)
   - Variable: `ALLOWED_ORIGIN` = `https://moatazgames1.github.io`
   - Variable: `FRONTEND_URL` = `https://moatazgames1.github.io/btc-snake/`
6. In Firebase Console (same Google account), create a new Firebase project named `btc-snake`. Enable Authentication -> Email/Password and Google. Register a Web App and copy its config into `firebase-config.js` based on `firebase-config.js.example`.
7. Set `API_BASE` in `index.html` to the deployed Worker URL, e.g. `https://btc-snake-api.<your-subdomain>.workers.dev`.
8. Deploy the Worker and test `/api/health`, then open the GitHub Pages URL.

## Cloudflare free-tier note

Cloudflare documents Durable Objects as available on Free and Paid plans, with SQLite-backed Durable Objects on Free. Free usage has daily limits; if usage exceeds included limits, operations can fail until limits reset. See:
- https://developers.cloudflare.com/durable-objects/
- https://developers.cloudflare.com/workers/platform/pricing/
- https://developers.cloudflare.com/workers/platform/limits/

GitHub project Pages sites use `https://<owner>.github.io/<repository>/`:
- https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages

## Current game rules in this build

- 5-minute rounds.
- Top-down 3D arena.
- Up to 10 snakes in one shared arena, with bots filling empty places.
- Head touching another snake's body kills the moving snake.
- Head-to-head collision eliminates both.
- Shield pickup gives temporary protection.
- Snake skins are cosmetic only.
- Guest play is allowed. Guest results are not saved to the global ranking. Signed-in WebSocket sessions use short-lived, one-use tickets rather than exposing Firebase ID tokens in the socket URL.
- Authenticated player ranking is based on verified server match results.
- Virtual points only; no real BTC payout is enabled.

## Admin

After setting `ADMIN_UIDS`, a Firebase user whose UID is listed can open:
`https://moatazgames1.github.io/btc-snake/?admin=1`

The initial admin summary is intentionally limited to safe operational counts. Do not expose payout or private user data in public endpoints.
