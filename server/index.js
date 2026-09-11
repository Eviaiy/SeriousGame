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

/* ------------------------------------------------ accès super animateur (opt) */

/**
 * Quand ADMIN_PASSPHRASE est défini (déploiement public), la création de session
 * et l'historique sont protégés. Joueurs et animateurs d'équipe n'ont besoin que
 * de leur code.
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

/* ------------------------------------------------------- sockets & minuteurs */

/** sessionId -> Set<socket> */
const sessionSockets = new Map();
/** `sessionId:teamId` -> Timeout (une manche par table) */
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
    const audience = socket.data.audience || { role: 'player' };
    socket.emit('state', game.stateFor(session, audience));
  }
}

/** Message éphémère : soit à toute la session, soit à une seule table. */
function notify(session, payload, teamId = null) {
  const set = sessionSockets.get(session.id);
  if (!set) return;
  for (const socket of set) {
    const audience = socket.data.audience || {};
    if (teamId && audience.role !== 'super' && audience.teamId !== teamId) continue;
    socket.emit('flash', payload);
  }
}

function timerKey(sessionId, teamId) {
  return `${sessionId}:${teamId}`;
}

function clearTeamTimer(sessionId, teamId) {
  const key = timerKey(sessionId, teamId);
  const timer = roundTimers.get(key);
  if (timer) {
    clearTimeout(timer);
    roundTimers.delete(key);
  }
}

/**
 * Un seul minuteur par table, qui couvre les deux échéances : la fin du vote
 * puis, en cas d'égalité, la fin de l'arbitrage du DG.
 */
function armTeamTimer(session, teamId) {
  clearTeamTimer(session.id, teamId);
  const team = game.getTeam(session, teamId);
  if (!team || !team.round) return;
  const round = team.round;

  let deadline = null;
  if (round.status === 'open' && !round.pausedAt) deadline = round.endsAt;
  else if (round.status === 'arbitration' && round.arbitrationEndsAt) deadline = round.arbitrationEndsAt;
  if (deadline == null) return;

  const key = timerKey(session.id, teamId);
  const timer = setTimeout(() => {
    roundTimers.delete(key);
    const live = game.getSession(session.id);
    if (!live) return;
    const liveTeam = game.getTeam(live, teamId);
    if (!liveTeam || !liveTeam.round) return;

    try {
      if (liveTeam.round.status === 'open' && !liveTeam.round.pausedAt) {
        game.closeRound(live, teamId, 'timeout');
        notify(live, { type: 'round_timeout' }, teamId);
        if (liveTeam.round && liveTeam.round.status === 'arbitration') {
          notify(live, { type: 'round_tied' }, teamId);
          armTeamTimer(live, teamId);
        }
      } else if (liveTeam.round.status === 'arbitration') {
        game.autoArbitrate(live, teamId);
        notify(live, { type: 'arbitration_draw' }, teamId);
      }
      broadcast(live);
    } catch (err) {
      console.error('[timer]', err.message);
    }
  }, Math.max(0, deadline - Date.now()) + 25);

  roundTimers.set(key, timer);
}

/**
 * Supprimer une session, c'est supprimer tout ce qu'elle contient : ses tables,
 * leurs codes d'animateur et les postes de ses joueurs. Les consoles ouvertes
 * sont prévenues avant l'effacement, sinon elles resteraient sur un état figé.
 */
function dropSession(session) {
  for (const team of session.teams) clearTeamTimer(session.id, team.id);
  const set = sessionSockets.get(session.id);
  if (set) {
    for (const socket of set) {
      socket.emit('session:deleted', { sessionId: session.id });
      socket.data.sessionId = null;
      socket.data.audience = null;
    }
    sessionSockets.delete(session.id);
  }
  game.deleteSession(session);
}

/** Au démarrage : réarme les minuteurs, ferme les manches expirées pendant l'arrêt. */
function resumeAfterRestart() {
  for (const session of Object.values(store.state.sessions)) {
    /* Recalcule les cumuls par acte : les parties écrites avant le barème
       unique n'ont pas encore les champs act1 / act2. */
    game.recomputeAllScores(session);
    for (const team of session.teams) {
      const round = team.round;
      if (!round) continue;
      try {
        if (round.status === 'open' && !round.pausedAt && round.endsAt <= Date.now()) {
          game.closeRound(session, team.id, 'timeout');
        }
        if (team.round && team.round.status === 'arbitration' && team.round.arbitrationEndsAt <= Date.now()) {
          game.autoArbitrate(session, team.id);
        }
        if (team.round) armTeamTimer(session, team.id);
      } catch (err) {
        console.error('[restart]', err.message);
      }
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
      superKey: session.superKey,
      name: session.name,
      teams: session.teams.map((t) => ({ id: t.id, name: t.name, adminCode: t.adminCode })),
    });
  } catch (err) {
    sendError(res, err);
  }
});

/** Écran d'accueil joueur : le code existe-t-il, et les inscriptions sont-elles ouvertes ? */
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
    joinOpen:
      session.status !== 'finished' && (session.settings.allowLateJoin || session.status === 'lobby'),
    teamCount: session.teams.length,
    playerCount: session.teams.reduce((sum, t) => sum + t.players.length, 0),
    teamSize: session.settings.teamSize,
    /* Le QR d'une table porte son identifiant : l'accueil doit pouvoir nommer
       la table avant l'inscription, et la porte animateur dire lesquelles sont
       déjà tenues. Aucun code d'animateur ici : la porte désigne une table par
       son identifiant. */
    tables: session.teams.map((t) => ({
      id: t.id,
      name: t.name,
      hosted: Boolean(t.hostClaimedAt),
      headcount: t.players.length,
    })),
  });
});

/**
 * La direction de jeu supprime sa session : ses tables et leurs codes cessent
 * d'exister, les consoles ouvertes sont renvoyées à l'accueil. L'archive d'une
 * partie terminée reste dans l'historique, elle ne dépend plus de la session.
 */
app.delete('/api/sessions/:id', (req, res) => {
  try {
    const session = game.getSession(req.params.id);
    if (!session) throw new game.GameError('session_not_found', 'Session introuvable');
    game.assertSuper(session, (req.body || {}).superKey || req.get('x-super-key'));
    dropSession(session);
    res.json({ ok: true });
  } catch (err) {
    sendError(res, err);
  }
});

/**
 * Inscription d'un joueur. Sans précision le serveur choisit la table la moins
 * remplie ; le QR d'une table transmet son identifiant et le joueur y est assis.
 */
app.post('/api/sessions/:code/players', (req, res) => {
  try {
    const session = game.findByCode(req.params.code);
    if (!session) throw new game.GameError('session_not_found', 'Session introuvable');
    const body = req.body || {};
    const { team, player } = game.joinPlayer(session, body.name, { teamId: body.teamId });
    broadcast(session);
    notify(session, { type: 'player_joined', name: player.name, team: team.name }, team.id);
    res.json({
      ok: true,
      sessionId: session.id,
      code: session.code,
      teamId: team.id,
      teamName: team.name,
      playerId: player.id,
      playerToken: player.token,
      playerName: player.name,
    });
  } catch (err) {
    sendError(res, err);
  }
});

/**
 * Un animateur échange un code contre un jeton d'accès à sa console de table.
 * Le code de session suffit : une table libre lui est attribuée, ou créée. Le
 * code d'une table précise reste accepté et mène toujours à la même table.
 */
app.post('/api/team-admin', (req, res) => {
  try {
    const { code, teamId } = req.body || {};
    const found = game.findByTeamCode(code);
    let session = found ? found.session : null;
    let team = found ? found.team : null;
    if (!team) {
      session = game.findByCode(code);
      if (!session) throw new game.GameError('team_not_found', 'Code inconnu');
      /* Table désignée dans la liste de la porte : on ouvre celle-là. Sans
         précision, l'animateur reçoit la première table encore libre. */
      team = teamId ? game.hostTeam(session, teamId) : game.claimTeamForHost(session);
    } else {
      /* Table choisie dans la liste : elle compte aussi comme animée. */
      game.markTeamHosted(session, team);
    }
    broadcast(session);
    res.json({
      ok: true,
      sessionId: session.id,
      code: session.code,
      sessionName: session.name,
      teamId: team.id,
      teamName: team.name,
      adminCode: team.adminCode,
      adminToken: team.adminToken,
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
      playerCount: r.playerCount,
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
  const record = store.state.records.find((r) => r.id === req.params.id);
  if (!record) return res.status(404).json({ ok: false, error: 'record_not_found' });
  store.state.records = store.state.records.filter((r) => r.id !== req.params.id);
  store.persistRecords();
  /* L'archive effacée, la session terminée qui l'a produite n'a plus de raison
     de survivre : ses codes de table ouvriraient encore des consoles. Une
     session rouverte est repartie en jeu, on n'y touche pas. */
  const session = record.sessionId ? game.getSession(record.sessionId) : null;
  if (session && session.status === 'finished') dropSession(session);
  return res.json({ ok: true });
});

function csvCell(value) {
  const text = value == null ? '' : String(value);
  return /[";\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function recordToCsv(record) {
  const lines = [];
  const push = (cells) => lines.push((cells || []).map(csvCell).join(';'));

  push([record.name]);
  push(['Code', record.code]);
  push(['Animateur / Facilitator', record.facilitator || '']);
  push(['Fin / Ended', new Date(record.endedAt).toLocaleString('fr-FR')]);
  push(['Équipes / Teams', record.teamCount]);
  push(['Joueurs / Players', record.playerCount]);
  push([]);
  push(['CLASSEMENT FINAL / FINAL STANDINGS']);
  push([
    'Rang',
    'Équipe',
    'Acte 1',
    'Acte 2',
    'Ajustements',
    'Total',
    'Événements gagnés',
    'Profil Acte 1',
    'Profil Acte 2',
  ]);
  for (const row of record.leaderboard) {
    push([
      row.rank,
      row.name,
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
  push(['COMPOSITION DES ÉQUIPES / TEAM ROSTERS']);
  push(['Équipe', 'Joueur', 'Rôle']);
  for (const team of record.teams || []) {
    for (const member of team.roster || []) {
      push([team.name, member.name, member.role ? member.role.fr : '']);
    }
  }

  push([]);
  push(['CLASSEMENT PAR ÉVÉNEMENT / PER-EVENT RANKING']);
  push(['Événement', 'Acte', 'Rang', 'Équipe', 'Décision', 'Arbitrage', 'Votes A/B/C', 'Points', 'Secondes']);
  for (const event of record.events) {
    for (const row of event.results) {
      const tally = row.tally || {};
      push([
        event.title.fr,
        event.act,
        row.rank,
        row.team,
        row.choice || '—',
        row.decidedBy || '',
        `${tally.A || 0}/${tally.B || 0}/${tally.C || 0}`,
        row.total,
        row.seconds == null ? '' : row.seconds,
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
  /* ?t=<table> vient du QR posé sur une table : on le garde jusqu'au formulaire. */
  const table = String(req.query.t || '').slice(0, 40);
  res.redirect(`/play.html?code=${code}${table ? `&t=${encodeURIComponent(table)}` : ''}`);
});

app.get('/table/:code', (req, res) => {
  res.redirect(`/team.html?code=${encodeURIComponent(String(req.params.code || '').toUpperCase())}`);
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
  const audience = socket.data.audience || {};
  if (session && audience.playerId) {
    const team = game.getTeam(session, audience.teamId);
    const player = team && team.players.find((p) => p.id === audience.playerId);
    if (player) {
      player.sockets = Math.max(0, player.sockets - 1);
      broadcast(session);
    }
  }
  socket.data.sessionId = null;
  socket.data.audience = null;
}

io.on('connection', (socket) => {
  socket.data.audience = null;
  socket.data.sessionId = null;

  function attach(session, audience) {
    detach(socket);
    socket.data.sessionId = session.id;
    socket.data.audience = audience;
    socketsOf(session.id).add(socket);
  }

  socket.on('super:join', (payload = {}, cb) => {
    try {
      const session = payload.code ? game.findByCode(payload.code) : game.getSession(payload.sessionId);
      if (!session) throw new game.GameError('session_not_found', 'Session introuvable');
      game.assertSuper(session, payload.superKey);
      attach(session, { role: 'super' });
      ack(cb, { ok: true, state: game.stateFor(session, socket.data.audience) });
    } catch (err) {
      ack(cb, { ok: false, error: err.code || 'error', message: err.message });
    }
  });

  socket.on('teamAdmin:join', (payload = {}, cb) => {
    try {
      const session = game.getSession(payload.sessionId);
      if (!session) throw new game.GameError('session_not_found', 'Session introuvable');
      const team = game.authTeamAdmin(session, payload.teamId, payload.adminToken);
      attach(session, { role: 'teamAdmin', teamId: team.id });
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

  socket.on('player:join', (payload = {}, cb) => {
    try {
      const session = payload.code ? game.findByCode(payload.code) : game.getSession(payload.sessionId);
      if (!session) throw new game.GameError('session_not_found', 'Session introuvable');
      const { team, player } = game.authPlayer(session, payload.playerId, payload.playerToken);
      attach(session, { role: 'player', teamId: team.id, playerId: player.id });
      player.sockets += 1;
      ack(cb, {
        ok: true,
        team: { id: team.id, name: team.name },
        player: { id: player.id, name: player.name },
        state: game.stateFor(session, socket.data.audience),
      });
      broadcast(session);
    } catch (err) {
      ack(cb, { ok: false, error: err.code || 'error', message: err.message });
    }
  });

  /**
   * Enveloppe commune : vérifie la session, le rôle, puis diffuse l'état.
   * `scope: 'super' | 'admin' | 'any'` — `admin` autorise aussi l'animateur de
   * la table concernée.
   */
  function handle(name, { scope = 'super', run }) {
    socket.on(name, (payload = {}, cb) => {
      try {
        const sessionId = socket.data.sessionId;
        if (!sessionId) throw new game.GameError('not_joined', 'Non connecté à une session');
        const session = game.requireSession(sessionId);
        const audience = socket.data.audience || {};

        if (scope === 'super' && audience.role !== 'super') {
          throw new game.GameError('forbidden', 'Action réservée au super animateur');
        }
        if (scope === 'admin' && audience.role !== 'super' && audience.role !== 'teamAdmin') {
          throw new game.GameError('forbidden', 'Action réservée aux animateurs');
        }

        // Un animateur d'équipe n'agit que sur sa table.
        let teamId = payload.teamId || audience.teamId || null;
        if (audience.role === 'teamAdmin') teamId = audience.teamId;

        const result = run(session, payload, audience, teamId) || {};
        broadcast(session);
        ack(cb, { ok: true, ...result });
      } catch (err) {
        if (!(err instanceof game.GameError)) console.error(`[socket:${name}]`, err);
        ack(cb, { ok: false, error: err.code || 'error', message: err.message });
      }
    });
  }

  /* -------------------------------------------------- manche (les deux rôles) */

  handle('round:start', {
    scope: 'admin',
    run: (session, p, a, teamId) => {
      game.startRound(session, teamId, p.eventId, p.durationSec);
      armTeamTimer(session, teamId);
      notify(session, { type: 'round_started' }, teamId);
    },
  });

  handle('round:addTime', {
    scope: 'admin',
    run: (session, p, a, teamId) => {
      game.addTime(session, teamId, p.seconds);
      armTeamTimer(session, teamId);
      notify(session, { type: 'time_added', seconds: p.seconds }, teamId);
    },
  });

  handle('round:pause', {
    scope: 'admin',
    run: (session, p, a, teamId) => {
      game.pauseRound(session, teamId);
      clearTeamTimer(session.id, teamId);
      notify(session, { type: 'round_paused' }, teamId);
    },
  });

  handle('round:resume', {
    scope: 'admin',
    run: (session, p, a, teamId) => {
      game.resumeRound(session, teamId);
      armTeamTimer(session, teamId);
      notify(session, { type: 'round_resumed' }, teamId);
    },
  });

  handle('round:close', {
    scope: 'admin',
    run: (session, p, a, teamId) => {
      game.closeRound(session, teamId, 'manual');
      clearTeamTimer(session.id, teamId);
      const team = game.getTeam(session, teamId);
      if (team && team.round && team.round.status === 'arbitration') {
        notify(session, { type: 'round_tied' }, teamId);
        armTeamTimer(session, teamId);
      } else {
        notify(session, { type: 'round_closed' }, teamId);
      }
    },
  });

  handle('round:finish', {
    scope: 'admin',
    run: (session, p, a, teamId) => {
      const done = game.finishRound(session, teamId);
      clearTeamTimer(session.id, teamId);
      if (done) notify(session, { type: 'team_done' }, teamId);
      return { done };
    },
  });

  handle('round:cancel', {
    scope: 'admin',
    run: (session, p, a, teamId) => {
      game.cancelRound(session, teamId);
      clearTeamTimer(session.id, teamId);
    },
  });

  handle('round:replay', {
    scope: 'admin',
    run: (session, p, a, teamId) => {
      game.replayEvent(session, teamId, p.eventId, p.durationSec);
      armTeamTimer(session, teamId);
      notify(session, { type: 'round_started' }, teamId);
    },
  });

  /** Arbitrage de l'animateur d'équipe quand le DG est absent. */
  handle('round:arbitrate', {
    scope: 'admin',
    run: (session, p, a, teamId) => {
      game.arbitrate(session, teamId, p.choice, 'admin');
      clearTeamTimer(session.id, teamId);
      notify(session, { type: 'arbitrated' }, teamId);
    },
  });

  handle('team:assignRoles', {
    scope: 'admin',
    run: (session, p, a, teamId) => {
      game.assignRoles(session, teamId);
      notify(session, { type: 'roles_assigned' }, teamId);
    },
  });

  handle('team:rename', {
    scope: 'admin',
    run: (session, p, a, teamId) => {
      game.renameTeam(session, teamId, p.name);
    },
  });

  /* ------------------------------------------------------- super animateur */

  handle('super:addTeam', {
    run: (session, p) => ({ teamId: game.addTeam(session, p.name).id }),
  });

  handle('super:removeTeam', {
    run: (session, p) => {
      clearTeamTimer(session.id, p.teamId);
      game.removeTeam(session, p.teamId);
    },
  });

  handle('super:regenTeamCode', {
    run: (session, p) => ({ adminCode: game.regenTeamCode(session, p.teamId).adminCode }),
  });

  handle('super:movePlayer', {
    run: (session, p) => {
      game.movePlayer(session, p.playerId, p.teamId);
    },
  });

  handle('super:removePlayer', {
    run: (session, p) => {
      game.removePlayer(session, p.playerId);
    },
  });

  handle('super:renamePlayer', {
    run: (session, p) => {
      game.renamePlayer(session, p.playerId, p.name);
    },
  });

  handle('super:adjustScore', {
    run: (session, p) => {
      game.adjustScore(session, p.teamId, p.delta, p.reason);
    },
  });

  handle('super:removeAdjustment', {
    run: (session, p) => {
      game.removeAdjustment(session, p.teamId, p.adjustmentId);
    },
  });

  handle('super:setDecision', {
    run: (session, p) => {
      game.setDecision(session, p.teamId, p.eventId, p.choice);
    },
  });

  handle('super:addEvent', {
    run: (session, p) => ({ eventId: game.addEvent(session, p.event || p).id }),
  });

  handle('super:updateEvent', {
    run: (session, p) => {
      game.updateEvent(session, p.eventId, p.event || p);
    },
  });

  handle('super:removeEvent', {
    run: (session, p) => {
      game.removeEvent(session, p.eventId);
    },
  });

  handle('super:moveEvent', {
    run: (session, p) => {
      game.moveEvent(session, p.eventId, p.direction);
    },
  });

  handle('super:updateSettings', {
    run: (session, p) => {
      game.updateSettings(session, p.settings || p);
    },
  });

  handle('super:reveal', {
    run: (session) => {
      game.revealScores(session);
      notify(session, { type: 'scores_revealed' });
    },
  });

  handle('super:endSession', {
    run: (session) => {
      for (const team of session.teams) clearTeamTimer(session.id, team.id);
      const record = game.finishSession(session);
      notify(session, { type: 'session_ended' });
      return { recordId: record.id };
    },
  });

  handle('super:reopenSession', {
    run: (session) => {
      game.reopenSession(session);
    },
  });

  /* ------------------------------------------------------------------ joueur */

  socket.on('player:vote', (payload = {}, cb) => {
    try {
      const sessionId = socket.data.sessionId;
      if (!sessionId) throw new game.GameError('not_joined', 'Non connecté à une session');
      const session = game.requireSession(sessionId);
      const audience = socket.data.audience || {};
      if (audience.role !== 'player') throw new game.GameError('forbidden', 'Réservé aux joueurs');

      const out = game.vote(session, audience.teamId, audience.playerId, payload.choice);
      if (out.closed) {
        clearTeamTimer(session.id, audience.teamId);
        const team = game.getTeam(session, audience.teamId);
        if (team && team.round && team.round.status === 'arbitration') {
          notify(session, { type: 'round_tied' }, audience.teamId);
          armTeamTimer(session, audience.teamId);
        } else {
          notify(session, { type: 'round_closed' }, audience.teamId);
        }
      }
      broadcast(session);
      ack(cb, { ok: true, choice: out.vote.choice });
    } catch (err) {
      if (!(err instanceof game.GameError)) console.error('[socket:player:vote]', err);
      ack(cb, { ok: false, error: err.code || 'error', message: err.message });
    }
  });

  /** Arbitrage du DG en cas d'égalité : sa voix vaut décision d'équipe. */
  socket.on('player:arbitrate', (payload = {}, cb) => {
    try {
      const sessionId = socket.data.sessionId;
      if (!sessionId) throw new game.GameError('not_joined', 'Non connecté à une session');
      const session = game.requireSession(sessionId);
      const audience = socket.data.audience || {};
      if (audience.role !== 'player') throw new game.GameError('forbidden', 'Réservé aux joueurs');

      const team = game.requireTeam(session, audience.teamId);
      const dg = game.dgPlayer(team);
      if (!dg || dg.id !== audience.playerId) {
        throw new game.GameError('not_dg', 'Seule la direction générale peut trancher');
      }
      game.arbitrate(session, team.id, payload.choice, 'dg');
      clearTeamTimer(session.id, team.id);
      notify(session, { type: 'arbitrated' }, team.id);
      broadcast(session);
      ack(cb, { ok: true });
    } catch (err) {
      if (!(err instanceof game.GameError)) console.error('[socket:player:arbitrate]', err);
      ack(cb, { ok: false, error: err.code || 'error', message: err.message });
    }
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
    console.log(`  Super animateur   : http://localhost:${PORT}`);
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
