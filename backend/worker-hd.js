import { DurableObject } from "cloudflare:workers";

const allowedOrigins = env => (env.ALLOWED_ORIGIN || "")
  .split(",").map(value => value.trim()).filter(Boolean);
const isAllowedOrigin = (origin, env) => !origin || allowedOrigins(env).includes(origin) || /^https:\/\/[a-z0-9-]+\.btc-snake-test-2026\.pages\.dev$/i.test(origin);
const cors = (origin, env) => {
  const allowed = allowedOrigins(env);
  const allowedOrigin = isAllowedOrigin(origin, env) ? (origin || allowed[0] || "null") : (allowed[0] || "null");
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Authorization,Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
};
const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", ...headers } });
const now = () => Math.floor(Date.now() / 1000);
const id = () => crypto.randomUUID();

async function firebaseUser(request, env) {
  const auth = request.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token || !env.FIREBASE_API_KEY) return null;
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${env.FIREBASE_API_KEY}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken: token })
  });
  if (!r.ok) return null;
  const data = await r.json();
  const u = data.users?.[0];
  if (!u?.localId) return null;
  return { uid: u.localId, name: String(u.displayName || u.email || "Player").slice(0, 24), email: u.email || "" };
}

function isAdmin(user, env) {
  const ids = (env.ADMIN_UIDS || "").split(",").map(x => x.trim()).filter(Boolean);
  return !!user && ids.includes(user.uid);
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const headers = cors(origin, env);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
    const url = new URL(request.url);
    try {
      if (url.pathname === "/api/health") return json({ ok: true, service: "btc-snake-hd-api", time: now() }, 200, headers);

      if (url.pathname === "/api/leaderboard" && request.method === "GET") {
        const rows = await env.DB.prepare(
          "SELECT uid, display_name, best_score, total_wins, level FROM players WHERE is_banned = 0 ORDER BY best_score DESC, total_wins DESC LIMIT 50"
        ).all();
        return json({ ok: true, leaderboard: rows.results || [] }, 200, headers);
      }

      if (url.pathname === "/api/me" && request.method === "GET") {
        const user = await firebaseUser(request, env);
        if (!user) return json({ ok: false, error: "auth_required" }, 401, headers);
        const row = await env.DB.prepare("SELECT * FROM players WHERE uid = ?").bind(user.uid).first();
        return json({ ok: true, player: row || { uid: user.uid, display_name: user.name, best_score: 0, total_matches: 0, total_wins: 0, xp: 0, level: 1, virtual_points: 0 } }, 200, headers);
      }

      if (url.pathname === "/api/ws-ticket" && request.method === "POST") {
        const user = await firebaseUser(request, env);
        if (!user) return json({ ok: false, error: "auth_required" }, 401, headers);
        const account = await env.DB.prepare("SELECT is_banned FROM players WHERE uid = ?").bind(user.uid).first();
        if (account?.is_banned) return json({ ok: false, error: "account_banned" }, 403, headers);
        const ticket = crypto.randomUUID();
        await env.DB.prepare("INSERT INTO ws_tickets(ticket,uid,display_name,expires_at) VALUES(?,?,?,?)")
          .bind(ticket, user.uid, user.name, now() + 45).run();
        return json({ ok: true, ticket, expiresIn: 45 }, 200, headers);
      }

      if (url.pathname === "/api/profile" && request.method === "POST") {
        const user = await firebaseUser(request, env);
        if (!user) return json({ ok: false, error: "auth_required" }, 401, headers);
        const body = await request.json().catch(() => ({}));
        const name = String(body.displayName || user.name || "Player").trim().slice(0, 24) || "Player";
        await env.DB.prepare(`
          INSERT INTO players(uid,display_name,created_at,last_seen_at)
          VALUES(?,?,?,?)
          ON CONFLICT(uid) DO UPDATE SET display_name=excluded.display_name,last_seen_at=excluded.last_seen_at
        `).bind(user.uid, name, now(), now()).run();
        return json({ ok: true, displayName: name }, 200, headers);
      }

      if (url.pathname === "/api/payout" && request.method === "POST") {
        return json({ ok: false, error: "btc_payouts_not_enabled", message: "Real BTC payouts are disabled in this launch version." }, 403, headers);
      }

      if (url.pathname === "/api/reward/claim" && request.method === "POST") {
        return json({ ok: false, error: "rewarded_ads_not_configured", message: "Rewarded cosmetic ads are not enabled until server-side provider verification is configured." }, 403, headers);
      }

      if (url.pathname === "/api/admin/summary" && request.method === "GET") {
        const user = await firebaseUser(request, env);
        if (!isAdmin(user, env)) return json({ ok: false, error: "admin_only" }, 403, headers);
        const [players, matches, pending] = await Promise.all([
          env.DB.prepare("SELECT COUNT(*) AS n FROM players").first(),
          env.DB.prepare("SELECT COUNT(*) AS n FROM matches").first(),
          env.DB.prepare("SELECT COUNT(*) AS n FROM payout_requests WHERE status='pending'").first()
        ]);
        return json({ ok: true, players: players?.n || 0, matches: matches?.n || 0, pendingPayouts: pending?.n || 0, realPayoutsEnabled: false }, 200, headers);
      }

      if (url.pathname === "/ws") {
        const ticket = url.searchParams.get("ticket") || "";
        let user = null;
        if (ticket) {
          const row = await env.DB.prepare("SELECT uid,display_name,expires_at FROM ws_tickets WHERE ticket = ?").bind(ticket).first();
          await env.DB.prepare("DELETE FROM ws_tickets WHERE ticket = ?").bind(ticket).run();
          if (!row || row.expires_at < now()) return json({ ok: false, error: "invalid_ws_ticket" }, 401, headers);
          const account = await env.DB.prepare("SELECT is_banned FROM players WHERE uid = ?").bind(row.uid).first();
          if (account?.is_banned) return json({ ok: false, error: "account_banned" }, 403, headers);
          user = { uid: row.uid, name: row.display_name };
        }
        const mode = url.searchParams.get("mode") === "solo" ? "solo" : "multi";
        // Competitive matches are fixed at 20 minutes.
        const duration = mode === "solo" ? 300 : 1200;
        if (origin && !isAllowedOrigin(origin, env)) return json({ ok: false, error: "origin_not_allowed" }, 403, headers);
        if (user) {
          const account = await env.DB.prepare("SELECT is_banned FROM players WHERE uid = ?").bind(user.uid).first();
          if (account?.is_banned) return json({ ok: false, error: "account_banned" }, 403, headers);
        }
        const roomId = mode === "solo"
          ? `solo-${user?.uid || crypto.randomUUID()}-300`
          : "public-1200";
        const stub = env.ROOMS.get(env.ROOMS.idFromName(roomId));
        const guest = !user;
        const headersForRoom = new Headers(request.headers);
        headersForRoom.set("X-Player-Id", user?.uid || `guest-${crypto.randomUUID()}`);
        headersForRoom.set("X-Player-Name", user?.name || `Guest-${Math.floor(Math.random() * 9000 + 1000)}`);
        headersForRoom.set("X-Player-Registered", guest ? "0" : "1");
        headersForRoom.set("X-Player-Skin", url.searchParams.get("skin") || "mint");
        headersForRoom.set("X-Game-Mode", mode);
        headersForRoom.set("X-Round-Seconds", String(duration));
        return stub.fetch(new Request(request, { headers: headersForRoom }));
      }

      return json({ ok: false, error: "not_found" }, 404, headers);
    } catch (e) {
      return json({ ok: false, error: "server_error", message: "Unexpected server error." }, 500, headers);
    }
  }
};

export class SnakeRoomHD extends DurableObject {
  constructor(state, env) {
    super(state, env);
    this.state = state;
    this.env = env;
    this.clients = new Map();
    this.playerMeta = new Map();
    this.snakes = new Map();
    this.mode = "multi";
    this.coins = [];
    this.shields = [];
    this.startedAt = Date.now();
    this.roundSeconds = 1200;
    this.mainRoundSeconds = 1200;
    this.roundEnded = false;
    this.endRoundInProgress = false;
    this.botFillDone = false;
    this.botFillScheduled = false;
    this.tickNo = 0;
    this.roundId = crypto.randomUUID();
    this.lastBroadcast = 0;
    this.spawnCoins(36);
    this.timer = null;
    this.startTicker();
  }

  startTicker() {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), 100);
  }

  async fetch(request) {
    if (this.endRoundInProgress) return new Response("Round is finishing", { status: 503 });
    if (request.headers.get("Upgrade") !== "websocket") return new Response("WebSocket required", { status: 426 });
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();
    this.mode = request.headers.get("X-Game-Mode") === "solo" ? "solo" : "multi";
    // Battle Royale has a hard 20-minute limit. Solo practice has no timer.
    this.roundSeconds = this.mode === "solo" ? 0 : 1200;
    this.mainRoundSeconds = this.mode === "solo" ? 0 : 1200;
    if (this.roundEnded && this.clients.size === 0) this.resetRound();
    const pid = request.headers.get("X-Player-Id") || `guest-${crypto.randomUUID()}`;
    const previousSocket = this.clients.get(pid);
    if (previousSocket) {
      this.clients.delete(pid);
      this.snakes.delete(pid);
      this.playerMeta.delete(pid);
      try { previousSocket.close(4001, "Replaced by a newer connection"); } catch {}
    }
    const name = (request.headers.get("X-Player-Name") || "Player").slice(0, 24);
    const registered = request.headers.get("X-Player-Registered") === "1";
    const oldBot = [...this.snakes.values()].find(s => s.bot);
    if (oldBot) this.snakes.delete(oldBot.id);
    if (this.snakes.size >= 50) {
      server.send(JSON.stringify({ type: "full", message: "Arena full. Please retry." }));
      server.close(1013, "Arena full");
      return new Response(null, { status: 101, webSocket: client });
    }
    const skin = request.headers.get("X-Player-Skin") || "mint";
    const snake = this.makeSnake(pid, name, registered, false, skin);
    this.snakes.set(pid, snake);
    this.clients.set(pid, server);
    this.playerMeta.set(pid, { name, registered, skin });
    // If the arena was already filled with bots, replace the bot removed for this
    // incoming player so the room returns to its 50-snake target.
    if (this.mode === "multi" && this.botFillDone) this.fillBots();
    server.send(JSON.stringify({ type: "welcome", playerId: pid, roundId: this.roundId, roundSeconds: this.roundSeconds }));
    this.broadcast();
    if (this.mode === "multi") this.scheduleBotFill();
    server.addEventListener("message", ev => this.onMessage(pid, ev.data));
    server.addEventListener("close", () => this.remove(pid, server));
    server.addEventListener("error", () => this.remove(pid, server));
    return new Response(null, { status: 101, webSocket: client });
  }

  scheduleBotFill() {
    if (this.botFillDone || this.botFillScheduled || this.roundEnded) return;
    this.botFillScheduled = true;
    setTimeout(() => {
      this.botFillScheduled = false;
      if (this.roundEnded) return;
      this.fillBots();
      this.botFillDone = true;
      this.broadcast();
    }, 4000);
  }

  resetRound() {
    this.snakes.clear();
    this.clients.clear();
    this.playerMeta.clear();
    this.coins = [];
    this.shields = [];
    this.spawnCoins(36);
    this.roundId = crypto.randomUUID();
    this.startedAt = Date.now();
    this.tickNo = 0;
    this.roundEnded = false;
    this.endRoundInProgress = false;
    this.botFillDone = false;
    this.botFillScheduled = false;
    this.startTicker();
  }

  makeSnake(pid, name, registered, bot, skin = "mint") {
    const x = 10 + Math.random() * 80, z = 10 + Math.random() * 80;
    const palette = { mint:"#35e0a1", gold:"#f7c948", fire:"#ff623e", ice:"#49d9ff", galaxy:"#a78bfa", toxic:"#b7f34a", royal:"#f472b6", diamond:"#d7f7ff" };
    return { id: pid, name, registered, bot, alive: true, score: 0, xp: 0,
      body: [{x,z},{x:x-1,z},{x:x-2,z}], dir: {x:1,z:0}, nextDir: {x:1,z:0}, turnInput: 0,
      joystickActive: false, autoWalk: false, lastManualInputAt: 0,
      shieldUntil: 0, health: 100, pendingTurn: false,
      color: bot ? ["#a78bfa","#22d3ee","#f59e0b","#34d399","#fb7185"][Math.floor(Math.random()*5)] : (palette[skin] || palette.mint), skin };
  }

  fillBots() {
    if (this.mode !== "multi") return;
    const bots = [...this.snakes.values()].filter(s => s.bot).length;
    const real = [...this.snakes.values()].filter(s => !s.bot).length;
    const targetBots = 50;
    const desired = Math.min(50 - real - bots, Math.max(0, targetBots - bots));
    for (let i = 0; i < desired; i++) {
      const bid = `bot-${crypto.randomUUID()}`;
      this.snakes.set(bid, this.makeSnake(bid, `BOT-${i+1}`, false, true));
    }
  }

  remove(pid, socket = null) {
    if (socket && this.clients.get(pid) !== socket) return;
    this.clients.delete(pid);
    this.snakes.delete(pid);
    const wasReal = this.playerMeta.has(pid);
    this.playerMeta.delete(pid);
    if (wasReal && this.botFillDone) this.fillBots();
    this.broadcast();
  }

  onMessage(pid, raw) {
    let data;
    try { data = JSON.parse(raw); } catch { return; }
    const s = this.snakes.get(pid);
    if (!s || !s.alive) return;
    if (data.type === "joystick" && typeof data.active === "boolean") {
      s.joystickActive = data.active;
      s.lastManualInputAt = data.active ? Date.now() : 0;
      if (!data.active) s.turnInput = 0;
      return;
    }
    if (data.type === "autoWalk" && typeof data.enabled === "boolean") {
      s.autoWalk = data.enabled;
      return;
    }
    if (data.type === "steer" && Number.isFinite(data.value)) {
      s.turnInput = Math.max(-1, Math.min(1, data.value));
      return;
    }
    if (data.type === "turn" && data.dir && Number.isInteger(data.dir.x) && Number.isInteger(data.dir.z)) {
      const d = { x: Math.max(-1, Math.min(1, data.dir.x)), z: Math.max(-1, Math.min(1, data.dir.z)) };
      if (Math.abs(d.x) + Math.abs(d.z) === 1 && !(d.x === -s.dir.x && d.z === -s.dir.z)) { s.nextDir = d; s.pendingTurn = true; }
    }
  }

  spawnCoins(n) {
    for (let i=0;i<n;i++) this.coins.push({ x: 4+Math.random()*92, z: 4+Math.random()*92, value: 1 });
    if (Math.random() < 0.45) this.shields.push({x: 8+Math.random()*84,z: 8+Math.random()*84});
  }

  botThink(s) {
    if (Math.random() < 0.08) {
      const coin = this.coins.reduce((best,c) => !best || Math.hypot(c.x-s.body[0].x,c.z-s.body[0].z) < Math.hypot(best.x-s.body[0].x,best.z-s.body[0].z) ? c : best, null);
      if (coin) {
        const dx = coin.x-s.body[0].x, dz = coin.z-s.body[0].z;
        const choices = Math.abs(dx)>Math.abs(dz) ? [{x:Math.sign(dx)||1,z:0},{x:0,z:Math.sign(dz)||1}] : [{x:0,z:Math.sign(dz)||1},{x:Math.sign(dx)||1,z:0}];
        const d = choices[Math.floor(Math.random()*choices.length)];
        if (!(d.x === -s.dir.x && d.z === -s.dir.z)) s.nextDir = d;
      }
    }
  }

  tick() {
    if (this.roundEnded || this.endRoundInProgress) return;
    this.tickNo++;
    const t = Date.now();
    for (const s of this.snakes.values()) {
      if (!s.alive) continue;
      if (s.bot) {
        this.botThink(s);
        if (s.nextDir) s.dir = { x: s.nextDir.x, z: s.nextDir.z };
      } else if (s.pendingTurn) {
        s.dir = { x: s.nextDir.x, z: s.nextDir.z };
        s.pendingTurn = false;
      }
      const manualMove = s.joystickActive && (t - (s.lastManualInputAt || 0) < 650);
      if (!s.bot && manualMove && s.turnInput) {
        const angle = Math.atan2(s.dir.z,s.dir.x) + s.turnInput * 0.10;
        s.dir = {x:Math.cos(angle),z:Math.sin(angle)};
      }
      if (!s.bot && !s.autoWalk && !manualMove) continue;
      if (this.tickNo % 2) continue;
      const h = s.body[0];
      const nh = {x: Math.max(0,Math.min(100,h.x+s.dir.x*0.9)), z: Math.max(0,Math.min(100,h.z+s.dir.z*0.9))};
      s.body.unshift(nh); s.body.pop();
      const ci = this.coins.findIndex(c => Math.hypot(c.x-nh.x,c.z-nh.z)<1.8);
      if (ci >= 0) {
        this.coins.splice(ci,1); s.score += 1; s.body.push({...s.body[s.body.length-1]});
        if (this.coins.length < 26) this.spawnCoins(12);
      }
      const si = this.shields.findIndex(c => Math.hypot(c.x-nh.x,c.z-nh.z)<2);
      if (si >= 0) { this.shields.splice(si,1); s.shieldUntil = t+5000; }
    }
    this.resolveCollisions(t);

    if (this.mode === "multi" && this.botFillDone) {
      const alive = [...this.snakes.values()].filter(s => s.alive);
      if (alive.length <= 1) {
        this.endRound(alive[0]?.id || null);
        return;
      }
      // At exactly 20 minutes the match ends. If the zone has not left one
      // survivor, the best surviving snake by score (then health) wins.
      if ((t-this.startedAt)/1000 >= this.mainRoundSeconds) {
        alive.sort((a,b) => b.score-a.score || (b.health||0)-(a.health||0));
        this.endRound(alive[0]?.id || null);
        return;
      }
    }
    if (t-this.lastBroadcast > 100) { this.lastBroadcast=t; this.broadcast(); }
  }

  zoneState(t = Date.now()) {
    const elapsed = Math.max(0, (t - this.startedAt) / 1000);
    if (this.mode === "solo") return { active: false, warning: false, x: 50, z: 50, radius: 72, phase: "practice" };
    const warning = elapsed >= 150 && elapsed < 180;
    const active = elapsed >= 180;
    const progress = Math.min(1, Math.max(0, (elapsed - 180) / 1020));
    const radius = 72 - (71 * progress);
    const phase = elapsed >= 1140 ? "final" : active ? "closing" : "warning";
    return { active, warning, x: 50, z: 50, radius: Math.max(1, radius), phase };
  }

  resolveCollisions(t) {
    const all = [...this.snakes.values()].filter(s=>s.alive);
    const dead = new Set();
    const collision = new Set();
    const zone = this.zoneState(t);
    for (let i=0;i<all.length;i++) {
      const a=all[i], ah=a.body[0];
      if (ah.x<=0.5||ah.x>=99.5||ah.z<=0.5||ah.z>=99.5) collision.add(a.id);
      for (let k=1;k<a.body.length;k++) {
        const seg=a.body[k];
        if (Math.hypot(ah.x-seg.x,ah.z-seg.z)<0.85) { collision.add(a.id); break; }
      }
      for (let j=0;j<all.length;j++) {
        if (i===j) continue;
        const b=all[j], bh=b.body[0];
        if (Math.hypot(ah.x-bh.x,ah.z-bh.z)<1.1) collision.add(a.id);
        for (let k=1;k<b.body.length;k++) {
          const seg=b.body[k];
          if (Math.hypot(ah.x-seg.x,ah.z-seg.z)<0.85) { collision.add(a.id); break; }
        }
      }
      if (zone.active) {
        const outside = Math.hypot(ah.x-zone.x, ah.z-zone.z) > zone.radius;
        const progress = Math.min(1, Math.max(0, ((t-this.startedAt)/1000 - 180) / 1020));
        // Damage rises as the safe zone gets smaller: about 1.2 to 12 health/sec.
        if (outside) a.health = Math.max(0, (a.health ?? 100) - (0.12 + 1.08*progress));
        else a.health = Math.min(100, (a.health ?? 100) + 0.2);
        if (a.health <= 0) dead.add(a.id);
      } else a.health = 100;
    }
    // Resolve collision protection only after every snake has been checked, so order cannot decide who survives.
    for (const pid of collision) {
      const s = this.snakes.get(pid);
      if (!s || dead.has(pid)) continue;
      if (s.shieldUntil >= t) s.shieldUntil = 0;
      else dead.add(pid);
    }
    for (const pid of dead) {
      const s=this.snakes.get(pid); if (!s) continue;
      s.alive=false;
      this.coins.push(...s.body.slice(0,Math.min(12,s.body.length)).map(p=>({x:p.x,z:p.z,value:1})));
      s.body=[];
    }
  }

  async endRound(winnerId = null) {
    if (this.roundEnded || this.endRoundInProgress) return;
    this.endRoundInProgress = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    const survivor = winnerId ? this.snakes.get(winnerId) : null;
    const winner = survivor ? { id: survivor.id, name: survivor.name, bot: !!survivor.bot } : null;
    // Official round results include human players only; bots never receive ranks or rewards.
    const results=[...this.snakes.values()]
      .filter(s=>!s.bot)
      .sort((a,b)=>Number(b.alive)-Number(a.alive) || b.score-a.score || (b.health||0)-(a.health||0))
      .map((s,i)=>({id:s.id,name:s.name,score:s.score,rank:i+1,registered:s.registered,bot:false}));
    const end=Date.now();
    const matchId=this.roundId;
    this.broadcast({type:"roundEnd",results,winner,roundId:this.roundId,durationSeconds:Math.floor((end-this.startedAt)/1000)});
    try {
      if (this.mode !== "solo") {
        await this.env.DB.prepare("INSERT INTO matches(id,started_at,ended_at,duration_seconds,winner_uid,created_at) VALUES(?,?,?,?,?,?)")
          .bind(matchId,Math.floor(this.startedAt/1000),Math.floor(end/1000),Math.floor((end-this.startedAt)/1000),(winner && !winner.bot && survivor.registered) ? winner.id : null,Math.floor(end/1000)).run();
        for (const r of results.filter(x=>x.registered&&!x.bot)) {
          await this.env.DB.prepare("INSERT INTO match_results(match_id,uid,display_name,score,rank,is_bot,created_at) VALUES(?,?,?,?,?,?,?)")
            .bind(matchId,r.id,r.name,r.score,r.rank,0,Math.floor(end/1000)).run();
          await this.env.DB.prepare(`
            INSERT INTO players(uid,display_name,created_at,last_seen_at,best_score,total_matches,total_wins,virtual_points,xp,level)
            VALUES(?,?,?,?,?,?,?,?,?,(CAST(? AS INTEGER)/100)+1)
            ON CONFLICT(uid) DO UPDATE SET
              display_name=excluded.display_name,
              last_seen_at=excluded.last_seen_at,
              best_score=MAX(players.best_score,excluded.best_score),
              total_matches=players.total_matches+1,
              total_wins=players.total_wins+CASE WHEN excluded.total_wins>0 THEN 1 ELSE 0 END,
              virtual_points=players.virtual_points+excluded.virtual_points,
              xp=players.xp+excluded.xp,
              level=CAST((players.xp+excluded.xp)/100 AS INTEGER)+1
          `).bind(r.id,r.name,Math.floor(end/1000),Math.floor(end/1000),r.score,1,r.rank===1?1:0,r.rank===1?25:r.rank===2?12:r.rank===3?6:2,r.score,r.score).run();
        }
      }
    } catch (e) {
      console.error("Failed to save round results:", e);
    }
    this.roundEnded = true;
    this.endRoundInProgress = false;
    const sockets = [...this.clients.values()];
    this.clients.clear();
    this.playerMeta.clear();
    this.snakes.clear();
    for (const socket of sockets) {
      try { socket.close(1000, "Round finished"); } catch {}
    }
  }

  snapshot() {
    const t = Date.now();
    const elapsed = Math.floor((t - this.startedAt) / 1000);
    const zone = this.zoneState(t);
    return { type:"state", roundId:this.roundId,
      remaining:this.mode === "solo" ? null : Math.max(0,this.mainRoundSeconds-elapsed),
      overtimeRemaining:this.mode === "solo" ? null : Math.max(0,this.roundSeconds-elapsed),
      elapsed, zone,
      snakes:[...this.snakes.values()].map(s=>({id:s.id,name:s.name,bot:s.bot,alive:s.alive,score:s.score,health:Math.max(0,Math.round(s.health ?? 100)),body:s.body,color:s.color,shield:s.shieldUntil>t})),
      coins:this.coins,shields:this.shields };
  }
  broadcast(extra=null) {
    const payload=JSON.stringify(extra || this.snapshot());
    for (const [pid,ws] of this.clients) { try { ws.send(payload); } catch { this.remove(pid); } }
  }
}
