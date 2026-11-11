const cors = (origin, env) => ({
  "Access-Control-Allow-Origin": origin === env.ALLOWED_ORIGIN ? origin : env.ALLOWED_ORIGIN,
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Authorization,Content-Type",
  "Access-Control-Max-Age": "86400",
  "Vary": "Origin"
});
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
      if (url.pathname === "/api/health") return json({ ok: true, service: "btc-snake-api", time: now() }, 200, headers);

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
          user = { uid: row.uid, name: row.display_name };
        }
        const mode = url.searchParams.get("mode") === "solo" ? "solo" : "multi";
        if (origin && origin !== env.ALLOWED_ORIGIN) return json({ ok: false, error: "origin_not_allowed" }, 403, headers);
        const roomId = mode === "solo" ? `solo-${user?.uid || crypto.randomUUID()}` : "public-main";
        const stub = env.ROOMS.get(env.ROOMS.idFromName(roomId));
        const guest = !user;
        const headersForRoom = new Headers(request.headers);
        headersForRoom.set("X-Player-Id", user?.uid || `guest-${crypto.randomUUID()}`);
        headersForRoom.set("X-Player-Name", user?.name || `Guest-${Math.floor(Math.random() * 9000 + 1000)}`);
        headersForRoom.set("X-Player-Registered", guest ? "0" : "1");
        headersForRoom.set("X-Player-Skin", url.searchParams.get("skin") || "mint");
        headersForRoom.set("X-Game-Mode", mode);
        return stub.fetch(new Request(request, { headers: headersForRoom }));
      }

      return json({ ok: false, error: "not_found" }, 404, headers);
    } catch (e) {
      return json({ ok: false, error: "server_error", message: "Unexpected server error." }, 500, headers);
    }
  }
};

export class SnakeRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.clients = new Map();
    this.playerMeta = new Map();
    this.snakes = new Map();
    this.botFillDone = false;
    this.mode = "multi";
    this.coins = [];
    this.shields = [];
    this.startedAt = Date.now();
    this.roundSeconds = 300;
    this.tickNo = 0;
    this.roundId = crypto.randomUUID();
    this.lastBroadcast = 0;
    this.spawnCoins(36);
    this.timer = setInterval(() => this.tick(), 100);
    setTimeout(() => { this.fillBots(); this.botFillDone = true; this.broadcast(); }, 4000);
  }

  async fetch(request) {
    if (request.headers.get("Upgrade") !== "websocket") return new Response("WebSocket required", { status: 426 });
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();
    this.mode = request.headers.get("X-Game-Mode") === "solo" ? "solo" : "multi";
    const pid = request.headers.get("X-Player-Id") || `guest-${crypto.randomUUID()}`;
    const name = (request.headers.get("X-Player-Name") || "Player").slice(0, 24);
    const registered = request.headers.get("X-Player-Registered") === "1";
    const oldBot = [...this.snakes.values()].find(s => s.bot);
    if (oldBot) this.snakes.delete(oldBot.id);
    if (this.snakes.size >= 10) {
      server.send(JSON.stringify({ type: "full", message: "Arena full. Please retry." }));
      server.close(1013, "Arena full");
      return new Response(null, { status: 101, webSocket: client });
    }
    const skin = request.headers.get("X-Player-Skin") || "mint";
    const snake = this.makeSnake(pid, name, registered, false, skin);
    this.snakes.set(pid, snake);
    this.clients.set(pid, server);
    this.playerMeta.set(pid, { name, registered, skin });
    server.send(JSON.stringify({ type: "welcome", playerId: pid, roundId: this.roundId, roundSeconds: this.roundSeconds }));
    this.broadcast();
    server.addEventListener("message", ev => this.onMessage(pid, ev.data));
    server.addEventListener("close", () => this.remove(pid));
    server.addEventListener("error", () => this.remove(pid));
    return new Response(null, { status: 101, webSocket: client });
  }

  makeSnake(pid, name, registered, bot, skin = "mint") {
    const x = 10 + Math.random() * 80, z = 10 + Math.random() * 80;
    const palette = { mint:"#35e0a1", gold:"#f7c948", fire:"#ff623e", ice:"#49d9ff", galaxy:"#a78bfa", toxic:"#b7f34a", royal:"#f472b6", diamond:"#d7f7ff" };
    return { id: pid, name, registered, bot, alive: true, score: 0, xp: 0,
      body: [{x,z},{x:x-1,z},{x:x-2,z}], dir: {x:1,z:0}, nextDir: {x:1,z:0},
      shieldUntil: 0, respawnAt: 0, color: bot ? ["#a78bfa","#22d3ee","#f59e0b","#34d399","#fb7185"][Math.floor(Math.random()*5)] : (palette[skin] || palette.mint), skin };
  }

  fillBots() {
    const bots = [...this.snakes.values()].filter(s => s.bot).length;
    const real = [...this.snakes.values()].filter(s => !s.bot).length;
    const targetBots = this.mode === "solo" ? 9 : 5;
    const desired = Math.min(10 - real - bots, Math.max(0, targetBots - bots));
    for (let i = 0; i < desired; i++) {
      const bid = `bot-${crypto.randomUUID()}`;
      this.snakes.set(bid, this.makeSnake(bid, `BOT-${i+1}`, false, true));
    }
  }

  remove(pid) {
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
    if (data.type === "turn" && data.dir && Number.isInteger(data.dir.x) && Number.isInteger(data.dir.z)) {
      const d = { x: Math.max(-1, Math.min(1, data.dir.x)), z: Math.max(-1, Math.min(1, data.dir.z)) };
      if (Math.abs(d.x) + Math.abs(d.z) === 1 && !(d.x === -s.dir.x && d.z === -s.dir.z)) s.nextDir = d;
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
    this.tickNo++;
    const t = Date.now();
    if ((t-this.startedAt)/1000 >= this.roundSeconds) { this.endRound(); return; }
    for (const s of this.snakes.values()) {
      if (!s.alive) {
        if (t >= s.respawnAt) {
          const fresh = this.makeSnake(s.id,s.name,s.registered,s.bot,s.skin);
          Object.assign(s,fresh);
        }
        continue;
      }
      if (s.bot) this.botThink(s);
      if (this.tickNo % 2) continue;
      s.dir = s.nextDir;
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
    if (t-this.lastBroadcast > 100) { this.lastBroadcast=t; this.broadcast(); }
  }

  resolveCollisions(t) {
    const all = [...this.snakes.values()].filter(s=>s.alive);
    const dead = new Set();
    for (let i=0;i<all.length;i++) {
      const a=all[i], ah=a.body[0];
      if (ah.x<=0.5||ah.x>=99.5||ah.z<=0.5||ah.z>=99.5) { if (a.shieldUntil<t) dead.add(a.id); else a.shieldUntil=0; }
      for (let j=0;j<all.length;j++) {
        if (i===j) continue;
        const b=all[j], bh=b.body[0];
        if (Math.hypot(ah.x-bh.x,ah.z-bh.z)<1.1) {
          if (a.shieldUntil<t) dead.add(a.id); else a.shieldUntil=0;
        }
        for (let k=1;k<b.body.length;k++) {
          const seg=b.body[k];
          if (Math.hypot(ah.x-seg.x,ah.z-seg.z)<0.85) {
            if (a.shieldUntil<t) dead.add(a.id); else a.shieldUntil=0;
            break;
          }
        }
      }
    }
    for (const pid of dead) {
      const s=this.snakes.get(pid); if (!s) continue;
      s.alive=false; s.respawnAt=t+2500;
      this.coins.push(...s.body.slice(0,Math.min(12,s.body.length)).map(p=>({x:p.x,z:p.z,value:1})));
      s.body=[];
    }
  }

  async endRound() {
    const results=[...this.snakes.values()].sort((a,b)=>b.score-a.score).map((s,i)=>({id:s.id,name:s.name,score:s.score,rank:i+1,registered:s.registered,bot:s.bot}));
    this.broadcast({type:"roundEnd",results,roundId:this.roundId});
    const end=Date.now();
    const matchId=this.roundId;
    try {
      if (this.mode !== "solo") {
      await this.env.DB.prepare("INSERT INTO matches(id,started_at,ended_at,duration_seconds,winner_uid,created_at) VALUES(?,?,?,?,?,?)")
        .bind(matchId,Math.floor(this.startedAt/1000),Math.floor(end/1000),300,(results[0]?.registered&&!results[0]?.bot)?results[0].id:null,Math.floor(end/1000)).run();
      for (const r of results.filter(x=>x.registered&&!x.bot)) {
        await this.env.DB.prepare("INSERT INTO match_results(match_id,uid,display_name,score,rank,is_bot,created_at) VALUES(?,?,?,?,?,?,?)")
          .bind(matchId,r.id,r.name,r.score,r.rank,0,Math.floor(end/1000)).run();
        await this.env.DB.prepare("INSERT INTO players(uid,display_name,created_at,last_seen_at,best_score,total_matches,total_wins,virtual_points,xp,level) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(uid) DO UPDATE SET display_name=excluded.display_name,last_seen_at=excluded.last_seen_at,best_score=MAX(players.best_score,excluded.best_score),total_matches=players.total_matches+1,total_wins=players.total_wins+CASE WHEN excluded.total_wins>0 THEN 1 ELSE 0 END,virtual_points=players.virtual_points+excluded.virtual_points,xp=players.xp+excluded.xp")
          .bind(r.id,r.name,Math.floor(end/1000),Math.floor(end/1000),r.score,r.rank===1?1:0,r.rank===1?1:0,r.rank===1?25:r.rank===2?12:r.rank===3?6:2,r.score,1).run();
      }
      }
    } catch {}
    this.snakes.clear();
    for (const [pid, meta] of this.playerMeta) this.snakes.set(pid, this.makeSnake(pid, meta.name, meta.registered, false, meta.skin));
    this.coins=[]; this.shields=[];
    this.spawnCoins(36);
    this.roundId=crypto.randomUUID();
    this.startedAt=Date.now();
    this.fillBots();
    this.broadcast({type:"newRound",roundId:this.roundId,roundSeconds:300});
  }

  snapshot() {
    return { type:"state", roundId:this.roundId, remaining:Math.max(0,this.roundSeconds-Math.floor((Date.now()-this.startedAt)/1000)),
      snakes:[...this.snakes.values()].map(s=>({id:s.id,name:s.name,bot:s.bot,alive:s.alive,score:s.score,body:s.body,color:s.color,shield:s.shieldUntil>Date.now()})),
      coins:this.coins,shields:this.shields };
  }
  broadcast(extra=null) {
    const payload=JSON.stringify(extra || this.snapshot());
    for (const [pid,ws] of this.clients) { try { ws.send(payload); } catch { this.remove(pid); } }
  }
}
