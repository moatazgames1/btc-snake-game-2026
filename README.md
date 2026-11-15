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

## Existing deployment

This repository is already connected to its existing GitHub Pages, Cloudflare Worker/D1, and Firebase resources. Do not create duplicate resources when updating this project.

- Live site: `https://moatazgames1.github.io/btc-snake-game-2026/`
- Frontend: `index.html` at the repository root.
- Backend: `backend/worker.js` deployed as the existing `btc-snake-api` Worker.
- Database: the existing `btc-snake-db` D1 database.
- Firebase project: the existing `btc-snake` project.

Make and review changes on a feature branch first. Merge into `main` only after testing and explicit approval.

## Deployment reference (existing resources)

The existing deployment is already configured. For normal game updates:

1. Make changes on a feature branch, not directly on `main`.
2. Review the complete changed files and test the branch before merging.
3. Merge to `main` only after explicit approval; GitHub Pages then updates the live frontend.
4. Deploy `backend/worker.js` to the existing `btc-snake-api` Worker only when backend changes are approved.
5. Keep the existing D1 binding `DB`, Durable Object binding `ROOMS`, Firebase project, and environment variables. Do not create duplicate services or databases.
6. Verify the Worker health endpoint and test sign-in, round play, permanent balance, results, and leaderboard after deployment.

Current frontend API endpoint: `https://btc-snake-api.motazfaysel5.workers.dev`.

## Cloudflare free-tier note

Cloudflare documents Durable Objects as available on Free and Paid plans, with SQLite-backed Durable Objects on Free. Free usage has daily limits; if usage exceeds included limits, operations can fail until limits reset. See:
- https://developers.cloudflare.com/durable-objects/
- https://developers.cloudflare.com/workers/platform/pricing/
- https://developers.cloudflare.com/workers/platform/limits/

GitHub project Pages sites use `https://<owner>.github.io/<repository>/`:
- https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages

## Current game rules in this build

- Multiplayer rounds: 5 or 10 minutes; solo training: 5 minutes.
- Third-person 3D follow camera with 360-degree joystick steering.
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
`https://moatazgames1.github.io/btc-snake-game-2026/?admin=1`

The initial admin summary is intentionally limited to safe operational counts. Do not expose payout or private user data in public endpoints.
