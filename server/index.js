'use strict';

const http = require('http');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { Server } = require('socket.io');

const store = require('./store');
const game = require('./game');

const PORT = Number.parseInt(process.env.PORT, 10) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
/* Render expose RENDER_EXTERNAL_URL ; en local il n'y a pas d'URL publique. */
const PUBLIC_URL = (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/+$/, '');
const ADMIN_PASSPHRASE = (process.env.ADMIN_PASSPHRASE || '').trim();

store.load();

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: true, credentials: true } });

app.set('trust proxy', 1); // derrière le proxy Render : IP et protocole réels
app.use(express.json({ limit: '256kb' }));
app.use(express.static(PUBLIC_DIR, { extensions: ['html'] }));

/* ----------------------------------------------------- accès animateur (opt) */

/**
 * Quand ADMIN_PASSPHRASE est défini (déploiement public), la création de session
 * et l'historique sont protégés. Les équipes n'ont besoin que du code de session.
 */
function sameSecret(given, expected) {
  const a = crypto.createHash('sha256').update(String(given)).digest();
  const b = crypto.createHash('sha256').update(String(expected)).digest();
  return crypto.timingSafeEqual(a, b);
}

function requirePass(req, res, next) {
  if (!ADMIN_PASSPHRASE) return next();
  const given = req.get('x-sg-pass') || '';
  if (given && sameSecret(given, ADMIN_PASSPHRASE)) return next();
  return res.status(401).json({ ok: false, error: 'unauthorized' });
}

/* ------------------------------------------------------- sockets & timers */

/** sessionId -> Set<socket> */
const sessionSockets = new Map();
/** sessionId -> Timeout */
const roundTimers = new Map();

function socketsOf(sessionId) {
  let set = sessionSockets.get(sessionId);
  if (!set) {
    set = new Set();
    sessionSockets.set(sessionId, set);
  }
  return set;
}

function broadcast(session) {
  const set = sessionSockets.get(session.id);
  if (!set || !set.size) return;
  for (const socket of set) {
    const audience = socket.data.audience || { role: 'team', teamId: null };
    socket.emit('state', game.stateFor(session, audience));
  }
}

function notify(session, payload) {
  const set = sessionSockets.get(session.id);
  if (!set) return;
  for (const socket of set) socket.emit('flash', payload);
}

function clearRoundTimer(sessionId) {
  const timer = roundTimers.get(sessionId);
  if (timer) {
    clearTimeout(timer);
    roundTimers.delete(sessionId);
  }
}

function armRoundTimer(session) {
  clearRoundTimer(session.id);
  const round = session.round;
  if (!round || round.status !== 'open' || round.pausedAt) return;

  const delay = Math.max(0, round.endsAt - Date.now());
  const timer = setTimeout(() => {
    roundTimers.delete(session.id);
    const live = game.getSession(session.id);
    if (!live || !live.round || live.round.status !== 'open') return;
    if (live.round.pausedAt) return;
    try {
      game.closeRound(live, 'timeout');
      notify(live, { type: 'round_timeout' });
      broadcast(live);
    } catch (err) {
      console.error('[timer]', err.message);
    }
  }, delay + 25);
  roundTimers.set(session.id, timer);
}

/** Au démarrage : réarme les minuteurs, ferme les rounds expirés pendant l'arrêt. */
function resumeAfterRestart() {
  for (const session of Object.values(store.state.sessions)) {
    const round = session.round;
    if (!round || round.status !== 'open') continue;
    if (round.pausedAt) continue;
    if (round.endsAt <= Date.now()) {
      try {
        game.closeRound(session, 'timeout');
      } catch (err) {
        console.error('[restart]', err.message);
      }
    } else {
      armRoundTimer(session);
    }
  }
}

/* --------------------------------------------------------------- HTTP API */

function sendError(res, err) {
  const status = err instanceof game.GameError ? 400 : 500;
  if (!(err instanceof game.GameError)) console.error('[api]', err);
  res.status(status).json({ ok: false, error: err.code || 'server_error', message: err.message });
}

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    uptime: Math.round(process.uptime()),
    sessions: Object.keys(store.state.sessions).length,
    records: store.state.records.length,
    persistent: store.writable,
  });
});

app.get('/api/network', (req, res) => {
  const urls = [];
  if (PUBLIC_URL) urls.push(PUBLIC_URL);
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) urls.push(`http://${net.address}:${PORT}`);
    }
  }
  res.json({ ok: true, port: PORT, publicUrl: PUBLIC_URL || null, protected: Boolean(ADMIN_PASSPHRASE), urls });
});

app.post('/api/sessions', requirePass, (req, res) => {
  try {
    const session = game.createSession(req.body || {});
    res.json({
      ok: true,
      sessionId: session.id,
      code: session.code,
      adminKey: session.adminKey,
      name: session.name,
    });
  } catch (err) {
    sendError(res, err);
  }
});

app.get('/api/sessions/:code', (req, res) => {
  const session = game.findByCode(req.params.code);
  if (!session) return res.status(404).json({ ok: false, error: 'session_not_found' });
  return res.json({
    ok: true,
    sessionId: session.id,
    code: session.code,
    name: session.name,
    lang: session.lang,
    status: session.status,
    joinOpen: session.status !== 'finished' && (session.settings.allowLateJoin || session.status === 'lobby'),
    teams: session.teams.map((t) => ({ id: t.id, name: t.name, online: t.sockets > 0 })),
  });
});

app.post('/api/sessions/:code/teams', (req, res) => {
  try {
    const session = game.findByCode(req.params.code);
    if (!session) throw new game.GameError('session_not_found', 'Session introuvable');
    const team = game.addTeam(session, (req.body || {}).name);
    broadcast(session);
    res.json({
      ok: true,
      sessionId: session.id,
      code: session.code,
      teamId: team.id,
      teamToken: team.token,
      teamName: team.name,
    });
  } catch (err) {
    sendError(res, err);
  }
});

app.get('/api/records', requirePass, (req, res) => {
  res.json({
    ok: true,
    records: store.state.records.map((r) => ({
      id: r.id,
      name: r.name,
      code: r.code,
      facilitator: r.facilitator,
      createdAt: r.createdAt,
      endedAt: r.endedAt,
      teamCount: r.teamCount,
      eventCount: r.eventCount,
      winner: r.winner,
    })),
  });
});

app.get('/api/records/:id', requirePass, (req, res) => {
  const record = store.state.records.find((r) => r.id === req.params.id);
  if (!record) return res.status(404).json({ ok: false, error: 'record_not_found' });
  return res.json({ ok: true, record });
});

app.delete('/api/records/:id', requirePass, (req, res) => {
  const before = store.state.records.length;
  store.state.records = store.state.records.filter((r) => r.id !== req.params.id);
  if (store.state.records.length === before) {
    return res.status(404).json({ ok: false, error: 'record_not_found' });
  }
  store.persistRecords();
  return res.json({ ok: true });
});

function csvCell(value) {
  const text = value == null ? '' : String(value);
  return /[";\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function recordToCsv(record) {
  const lines = [];
  const push = (cells) => lines.push(cells.map(csvCell).join(';'));

  push([record.name]);
  push(['Code', record.code]);
  push(['Animateur / Facilitator', record.facilitator || '']);
  push(['Fin / Ended', new Date(record.endedAt).toLocaleString('fr-FR')]);
  push([]);
  push(['CLASSEMENT FINAL / FINAL STANDINGS']);
  push([
    'Rang',
    'Équipe',
    'Court terme',
    'Long terme',
    'Acte 1',
    'Acte 2',
    'Ajustements',
    'Total',
    'Victoires',
    'Profil Acte 1',
    'Profil Acte 2',
  ]);
  for (const row of record.leaderboard) {
    push([
      row.rank,
      row.name,
      row.short,
      row.long,
      row.act1,
      row.act2,
      row.adjust,
      row.total,
      row.wins,
      row.act1Profile ? row.act1Profile.label.fr : '',
      row.act2Profile ? row.act2Profile.label.fr : '',
    ]);
  }
  push([]);
  push(['DÉTAIL PAR ÉVÉNEMENT / EVENT DETAIL']);
  push(['#', 'Événement', 'Acte', 'Équipe', 'Choix', 'Points', 'Secondes', 'Gagnant']);
  for (const event of record.events) {
    for (const row of event.results) {
      push([
        event.no,
        event.title.fr,
        event.act,
        row.team,
        row.choice || '—',
        row.total,
        row.seconds == null ? '' : row.seconds,
        event.winners.includes(row.team) ? 'OUI' : '',
      ]);
    }
  }
  if (record.adjustments.length) {
    push([]);
    push(['AJUSTEMENTS MANUELS / MANUAL ADJUSTMENTS']);
    push(['Équipe', 'Points', 'Motif', 'Horodatage']);
    for (const adj of record.adjustments) {
      push([adj.team, adj.delta, adj.reason, new Date(adj.ts).toLocaleString('fr-FR')]);
    }
  }
  return `\ufeff${lines.join('\r\n')}\r\n`;
}

app.get('/api/records/:id/csv', requirePass, (req, res) => {
  const record = store.state.records.find((r) => r.id === req.params.id);
  if (!record) return res.status(404).json({ ok: false, error: 'record_not_found' });
  const slug = String(record.name || 'session')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${slug || 'session'}-${record.code}.csv"`);
  return res.send(recordToCsv(record));
});

app.get('/join/:code', (req, res) => {
  const code = encodeURIComponent(String(req.params.code || '').toUpperCase());
  res.redirect(`/play.html?code=${code}`);
});

/* ------------------------------------------------------------- Socket API */

function ack(callback, payload) {
  if (typeof callback === 'function') callback(payload);
}

function detach(socket) {
  const sessionId = socket.data.sessionId;
  if (!sessionId) return;
  const set = sessionSockets.get(sessionId);
  if (set) {
    set.delete(socket);
    if (!set.size) sessionSockets.delete(sessionId);
  }
  const session = game.getSession(sessionId);
  const teamId = socket.data.audience && socket.data.audience.teamId;
  if (session && teamId) {
    const team = game.getTeam(session, teamId);
    if (team) {
      team.sockets = Math.max(0, team.sockets - 1);
      broadcast(session);
    }
  }
  socket.data.sessionId = null;
  socket.data.audience = null;
}

io.on('connection', (socket) => {
  socket.data.audience = null;
  socket.data.sessionId = null;

  socket.on('admin:join', (payload = {}, cb) => {
    try {
      const session = payload.code
        ? game.findByCode(payload.code)
        : game.getSession(payload.sessionId);
      if (!session) throw new game.GameError('session_not_found', 'Session introuvable');
      game.assertAdmin(session, payload.adminKey);

      detach(socket);
      socket.data.sessionId = session.id;
      socket.data.audience = { role: 'admin', teamId: null };
      socketsOf(session.id).add(socket);
      ack(cb, { ok: true, state: game.stateFor(session, socket.data.audience) });
    } catch (err) {
      ack(cb, { ok: false, error: err.code || 'error', message: err.message });
    }
  });

  socket.on('team:join', (payload = {}, cb) => {
    try {
      const session = payload.code
        ? game.findByCode(payload.code)
        : game.getSession(payload.sessionId);
      if (!session) throw new game.GameError('session_not_found', 'Session introuvable');
      const team = game.authTeam(session, payload.teamId, payload.teamToken);

      detach(socket);
      socket.data.sessionId = session.id;
      socket.data.audience = { role: 'team', teamId: team.id };
      socketsOf(session.id).add(socket);
      team.sockets += 1;

      ack(cb, {
        ok: true,
        team: { id: team.id, name: team.name },
        state: game.stateFor(session, socket.data.audience),
      });
      broadcast(session);
    } catch (err) {
      ack(cb, { ok: false, error: err.code || 'error', message: err.message });
    }
  });

  /** Enveloppe commune : vérifie la session + les droits puis diffuse l'état. */
  function handle(name, { admin = true, run }) {
    socket.on(name, (payload = {}, cb) => {
      try {
        const sessionId = socket.data.sessionId;
        if (!sessionId) throw new game.GameError('not_joined', 'Non connecté à une session');
        const session = game.requireSession(sessionId);
        const audience = socket.data.audience || {};
        if (admin && audience.role !== 'admin') {
          throw new game.GameError('forbidden', 'Action réservée à l’animateur');
        }
        const result = run(session, payload, audience) || {};
        broadcast(session);
        ack(cb, { ok: true, ...result });
      } catch (err) {
        if (!(err instanceof game.GameError)) console.error(`[socket:${name}]`, err);
        ack(cb, { ok: false, error: err.code || 'error', message: err.message });
      }
    });
  }

  /* ------------------------------------------------------------- animateur */

  handle('admin:startRound', {
    run: (session, p) => {
      game.startRound(session, p.eventId, p.durationSec);
      armRoundTimer(session);
      notify(session, { type: 'round_started' });
    },
  });

  handle('admin:replayEvent', {
    run: (session, p) => {
      game.replayEvent(session, p.eventId, p.durationSec);
      armRoundTimer(session);
      notify(session, { type: 'round_started' });
    },
  });

  handle('admin:closeRound', {
    run: (session) => {
      game.closeRound(session, 'manual');
      clearRoundTimer(session.id);
      notify(session, { type: 'round_closed' });
    },
  });

  handle('admin:reveal', {
    run: (session) => {
      game.revealRound(session);
      clearRoundTimer(session.id);
      notify(session, { type: 'round_revealed' });
    },
  });

  handle('admin:finishRound', {
    run: (session) => {
      game.finishRound(session);
      clearRoundTimer(session.id);
    },
  });

  handle('admin:cancelRound', {
    run: (session) => {
      game.cancelRound(session);
      clearRoundTimer(session.id);
    },
  });

  handle('admin:pauseRound', {
    run: (session) => {
      game.pauseRound(session);
      clearRoundTimer(session.id);
      notify(session, { type: 'round_paused' });
    },
  });

  handle('admin:resumeRound', {
    run: (session) => {
      game.resumeRound(session);
      armRoundTimer(session);
      notify(session, { type: 'round_resumed' });
    },
  });

  handle('admin:addTime', {
    run: (session, p) => {
      game.addTime(session, p.seconds);
      armRoundTimer(session);
    },
  });

  handle('admin:adjustScore', {
    run: (session, p) => {
      game.adjustScore(session, p.teamId, p.delta, p.reason);
      notify(session, { type: 'score_adjusted' });
    },
  });

  handle('admin:removeAdjustment', {
    run: (session, p) => game.removeAdjustment(session, p.teamId, p.adjustmentId) && {},
  });

  handle('admin:setAnswer', {
    run: (session, p) => {
      game.setAnswer(session, p.teamId, p.eventId, p.choice);
    },
  });

  handle('admin:renameTeam', {
    run: (session, p) => {
      game.renameTeam(session, p.teamId, p.name);
    },
  });

  handle('admin:removeTeam', {
    run: (session, p) => {
      game.removeTeam(session, p.teamId);
    },
  });

  handle('admin:addTeam', {
    run: (session, p) => {
      const team = game.addTeam(session, p.name);
      return { teamId: team.id };
    },
  });

  handle('admin:addEvent', {
    run: (session, p) => {
      const event = game.addEvent(session, p.event || p);
      return { eventId: event.id };
    },
  });

  handle('admin:updateEvent', {
    run: (session, p) => {
      game.updateEvent(session, p.eventId, p.event || p);
    },
  });

  handle('admin:removeEvent', {
    run: (session, p) => {
      game.removeEvent(session, p.eventId);
    },
  });

  handle('admin:moveEvent', {
    run: (session, p) => {
      game.moveEvent(session, p.eventId, p.direction);
    },
  });

  handle('admin:updateSettings', {
    run: (session, p) => {
      game.updateSettings(session, p.settings || p);
    },
  });

  handle('admin:endSession', {
    run: (session) => {
      const record = game.finishSession(session);
      clearRoundTimer(session.id);
      notify(session, { type: 'session_ended' });
      return { recordId: record.id };
    },
  });

  handle('admin:reopenSession', {
    run: (session) => {
      game.reopenSession(session);
    },
  });

  /* ----------------------------------------------------------------- équipe */

  handle('team:submit', {
    admin: false,
    run: (session, p, audience) => {
      if (audience.role !== 'team' || !audience.teamId) {
        throw new game.GameError('forbidden', 'Réservé aux équipes');
      }
      const out = game.submit(session, audience.teamId, p.choice);
      if (out.closed) clearRoundTimer(session.id);
      return { choice: p.choice };
    },
  });

  handle('team:rename', {
    admin: false,
    run: (session, p, audience) => {
      if (audience.role !== 'team' || !audience.teamId) {
        throw new game.GameError('forbidden', 'Réservé aux équipes');
      }
      game.renameTeam(session, audience.teamId, p.name);
    },
  });

  socket.on('state:refresh', (payload = {}, cb) => {
    const session = socket.data.sessionId ? game.getSession(socket.data.sessionId) : null;
    if (!session) return ack(cb, { ok: false, error: 'not_joined' });
    return ack(cb, { ok: true, state: game.stateFor(session, socket.data.audience || {}) });
  });

  socket.on('disconnect', () => detach(socket));
});

/* --------------------------------------------------------------- démarrage */

resumeAfterRestart();
game.pruneSessions();

server.listen(PORT, HOST, () => {
  const nets = os.networkInterfaces();
  const lan = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) lan.push(net.address);
    }
  }
  console.log('');
  console.log('  Serious Game — Facturation électronique');
  console.log('  ---------------------------------------');
  if (PUBLIC_URL) {
    console.log(`  Public            : ${PUBLIC_URL}`);
    console.log(`  Port              : ${PORT}`);
  } else {
    console.log(`  Animateur / Admin : http://localhost:${PORT}`);
    for (const ip of lan) console.log(`  Joueurs / Players : http://${ip}:${PORT}`);
  }
  console.log(`  Données / Data    : ${store.DATA_DIR}${store.writable ? '' : ' (lecture seule !)'}`);
  console.log(`  Accès animateur   : ${ADMIN_PASSPHRASE ? 'protégé par ADMIN_PASSPHRASE' : 'ouvert (réseau local)'}`);
  console.log('');
});

function shutdown(signal) {
  console.log(`\n[${signal}] arrêt — sauvegarde des données...`);
  try {
    store.flush();
  } catch (err) {
    console.error('[shutdown]', err.message);
  }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

module.exports = { app, server, io };
