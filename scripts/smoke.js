'use strict';

/**
 * Test de bout en bout du nouveau modèle : un super animateur, trois tables
 * avec leur animateur, neuf joueurs répartis automatiquement, rôles tirés au
 * sort, votes individuels, arbitrage du DG en cas d'égalité, scores masqués
 * jusqu'au dévoilement final, puis archivage et export.
 *
 *   npm run smoke
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PORT = 4137 + Math.floor(Math.random() * 200);
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-smoke-'));

process.env.PORT = String(PORT);
process.env.DATA_DIR = DATA_DIR;
process.env.HOST = '127.0.0.1';

const { server } = require('../server/index.js');
const { io } = require('socket.io-client');

const BASE = `http://127.0.0.1:${PORT}`;
const steps = [];

function step(label) {
  steps.push(label);
  console.log(`  ✓ ${label}`);
}

async function rest(pathname, options) {
  const res = await fetch(`${BASE}${pathname}`, options);
  const text = await res.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch (err) {
    data = { raw: text };
  }
  if (!res.ok) throw new Error(`${pathname} → ${res.status} ${text}`);
  return data;
}

function post(pathname, body) {
  return rest(pathname, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
}

function connect() {
  return new Promise((resolve, reject) => {
    const socket = io(BASE, { transports: ['websocket'], reconnection: false });
    socket.on('connect', () => resolve(socket));
    socket.on('connect_error', reject);
  });
}

function call(socket, event, payload) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout on ${event}`)), 8000);
    socket.emit(event, payload || {}, (res) => {
      clearTimeout(timer);
      if (res && res.ok) resolve(res);
      else reject(new Error(`${event} → ${JSON.stringify(res)}`));
    });
  });
}

function expectFail(socket, event, payload) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout on ${event}`)), 8000);
    socket.emit(event, payload || {}, (res) => {
      clearTimeout(timer);
      if (res && res.ok) reject(new Error(`${event} aurait dû échouer`));
      else resolve(res);
    });
  });
}

/** Attend un état satisfaisant le prédicat (les états arrivent par socket). */
function waitForState(tracker, predicate, label, timeoutMs = 9000) {
  if (tracker.state && predicate(tracker.state)) return Promise.resolve(tracker.state);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      tracker.waiters.delete(waiter);
      reject(new Error(`timeout waiting for ${label}`));
    }, timeoutMs);
    function waiter(state) {
      if (!predicate(state)) return;
      clearTimeout(timer);
      tracker.waiters.delete(waiter);
      resolve(state);
    }
    tracker.waiters.add(waiter);
  });
}

function track(socket) {
  const tracker = { state: null, waiters: new Set() };
  socket.on('state', (state) => {
    tracker.state = state;
    for (const waiter of Array.from(tracker.waiters)) waiter(state);
  });
  return tracker;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  /* --------------------------------------------------------------- session */
  const created = await post('/api/sessions', {
    name: 'Smoke test',
    facilitator: 'QA',
    lang: 'fr',
    teamCount: 3,
    teamSize: 3,
  });
  assert.ok(created.code && created.code.length === 6, 'code de session sur 6 caractères');
  assert.ok(created.superKey, 'clé super animateur générée');
  assert.strictEqual(created.teams.length, 3, '3 tables créées d’avance');
  assert.strictEqual(new Set(created.teams.map((t) => t.adminCode)).size, 3, 'codes de table distincts');
  step(`session créée (${created.code}) avec 3 tables et leurs codes animateur`);

  /* --------------------------------------------------------------- joueurs */
  const names = ['Ana', 'Bob', 'Cleo', 'Dan', 'Eve', 'Finn', 'Gaia', 'Hugo', 'Iris'];
  const players = [];
  for (const name of names) {
    players.push(await post(`/api/sessions/${created.code}/players`, { name }));
  }
  const perTeam = {};
  for (const p of players) perTeam[p.teamId] = (perTeam[p.teamId] || 0) + 1;
  assert.deepStrictEqual(Object.values(perTeam).sort(), [3, 3, 3], 'répartition équilibrée 3/3/3');
  step('9 joueurs répartis automatiquement, 3 par table');

  await assert.rejects(
    () => post(`/api/sessions/${created.code}/players`, { name: 'ana' }),
    /name_taken|400/,
    'nom en doublon refusé'
  );
  step('doublon de nom de joueur refusé');

  /* ------------------------------------------------------- super animateur */
  const superSocket = await connect();
  const superTracker = track(superSocket);
  const superJoined = await call(superSocket, 'super:join', {
    sessionId: created.sessionId,
    superKey: created.superKey,
  });
  superTracker.state = superJoined.state;
  assert.strictEqual(superJoined.state.role, 'super');
  assert.strictEqual(superJoined.state.events.length, 10, '10 événements par défaut');
  assert.strictEqual(superJoined.state.teams.length, 3);
  step('super animateur connecté, deck par défaut chargé (10 événements)');

  await expectFail(superSocket, 'super:join', { sessionId: created.sessionId, superKey: 'nope' });
  step('clé super animateur invalide rejetée');

  const teamsById = {};
  for (const team of superJoined.state.teams) teamsById[team.id] = team;
  for (const team of superJoined.state.teams) {
    assert.ok(team.rolesAssigned, `rôles distribués pour ${team.name}`);
    const dgs = team.players.filter((p) => p.role && p.role.dg);
    assert.strictEqual(dgs.length, 1, `exactement un DG dans ${team.name}`);
    const distinct = new Set(team.players.map((p) => p.roleId));
    assert.strictEqual(distinct.size, team.players.length, `rôles distincts dans ${team.name}`);
  }
  step('rôles tirés au sort : un seul DG par table, aucun doublon');

  /* --------------------------------------------------- animateurs de table */
  const teamIds = superJoined.state.teams.map((t) => t.id);
  const admins = {};
  for (const entry of created.teams) {
    const resolved = await post('/api/team-admin', { code: entry.adminCode });
    assert.strictEqual(resolved.teamId, entry.id, 'le code de table pointe la bonne table');
    const socket = await connect();
    const tracker = track(socket);
    const joined = await call(socket, 'teamAdmin:join', {
      sessionId: resolved.sessionId,
      teamId: resolved.teamId,
      adminToken: resolved.adminToken,
    });
    tracker.state = joined.state;
    assert.strictEqual(joined.state.role, 'teamAdmin');
    admins[entry.id] = { socket, tracker };
  }
  step('3 animateurs de table connectés avec leur code');

  await assert.rejects(() => post('/api/team-admin', { code: 'ZZZZZZ' }), /team_not_found|400/);
  step('code de table inconnu rejeté');

  /* ------------------------------------------------------------- joueurs UI */
  const playerConns = {};
  for (const p of players) {
    const socket = await connect();
    const tracker = track(socket);
    const joined = await call(socket, 'player:join', {
      sessionId: p.sessionId,
      playerId: p.playerId,
      playerToken: p.playerToken,
    });
    tracker.state = joined.state;
    playerConns[p.playerId] = { socket, tracker, info: p };
  }
  step('9 joueurs connectés en temps réel');

  const firstPlayer = playerConns[players[0].playerId];
  assert.strictEqual(firstPlayer.tracker.state.scoresVisible, false, 'scores masqués côté joueur');
  assert.strictEqual(firstPlayer.tracker.state.team.total, undefined, 'aucun total exposé au joueur');
  assert.ok(firstPlayer.tracker.state.me.role, 'le joueur connaît son rôle');
  assert.ok(firstPlayer.tracker.state.narrative.punch.fr, 'récit d’ouverture transmis');
  step('côté joueur : rôle et récit reçus, scores masqués');

  const teamA = teamIds[0];
  const teamB = teamIds[1];
  const playersOf = (teamId) => players.filter((p) => p.teamId === teamId);

  /* ---------------------------------------- table A : majorité simple (B/B/A) */
  const evt1 = superJoined.state.events[0];
  await call(admins[teamA].socket, 'round:start', { eventId: evt1.id, durationSec: 120 });
  await waitForState(admins[teamA].tracker, (s) => s.round && s.round.status === 'open', 'A ouvert');
  step('table A : événement 1 lancé par son animateur');

  const stateB0 = admins[teamB].tracker.state;
  assert.strictEqual(stateB0.round, null, 'la table B n’est pas affectée');
  step('les autres tables avancent à leur rythme (aucune manche ouverte)');

  const aPlayers = playersOf(teamA);
  await call(playerConns[aPlayers[0].playerId].socket, 'player:vote', { choice: 'B' });
  const midVote = await waitForState(
    playerConns[aPlayers[1].playerId].tracker,
    (s) => s.round && s.round.votedCount === 1,
    'un vote enregistré'
  );
  assert.strictEqual(midVote.round.tally, null, 'le décompte reste caché pendant le vote');
  assert.strictEqual(midVote.round.myVote, null, 'le vote des autres reste privé');
  step('vote en cours : décompte et votes des coéquipiers invisibles');

  await call(playerConns[aPlayers[1].playerId].socket, 'player:vote', { choice: 'B' });
  await call(playerConns[aPlayers[2].playerId].socket, 'player:vote', { choice: 'A' });
  const closedA = await waitForState(
    admins[teamA].tracker,
    (s) => s.round && s.round.status === 'closed',
    'A clos'
  );
  assert.strictEqual(closedA.round.decision, 'B', 'majorité B/B/A → B');
  assert.strictEqual(closedA.round.decidedBy, 'majority');
  assert.deepStrictEqual(closedA.round.tally, { A: 1, B: 2, C: 0 });
  step('table A : clôture automatique au dernier vote, majorité B appliquée');

  const playerAfter = playerConns[aPlayers[0].playerId].tracker.state;
  assert.strictEqual(playerAfter.round.score, null, 'aucun point montré au joueur');
  step('décision annoncée aux joueurs, points toujours masqués');

  await call(admins[teamA].socket, 'round:finish', {});
  await waitForState(admins[teamA].tracker, (s) => !s.round, 'plateau A libéré');
  step('table A : carte rangée, plateau prêt');

  /* ------------------------------- table B : égalité 1/1/1 puis arbitrage DG */
  await call(admins[teamB].socket, 'round:start', { eventId: evt1.id, durationSec: 120 });
  const bPlayers = playersOf(teamB);
  await call(playerConns[bPlayers[0].playerId].socket, 'player:vote', { choice: 'A' });
  await call(playerConns[bPlayers[1].playerId].socket, 'player:vote', { choice: 'B' });
  await call(playerConns[bPlayers[2].playerId].socket, 'player:vote', { choice: 'C' });

  const tied = await waitForState(
    admins[teamB].tracker,
    (s) => s.round && s.round.status === 'arbitration',
    'B en arbitrage'
  );
  assert.deepStrictEqual(tied.round.tied, ['A', 'B', 'C'], 'trois options à égalité');
  assert.ok(tied.round.dgPlayerId, 'le DG est identifié');
  step('table B : égalité 1/1/1 → passage en arbitrage');

  const dgId = tied.round.dgPlayerId;
  const notDg = bPlayers.find((p) => p.playerId !== dgId);
  await expectFail(playerConns[notDg.playerId].socket, 'player:arbitrate', { choice: 'C' });
  step('un joueur non-DG ne peut pas trancher');

  await expectFail(playerConns[dgId].socket, 'player:arbitrate', { choice: 'Z' });
  step('arbitrage hors options à égalité refusé');

  await call(playerConns[dgId].socket, 'player:arbitrate', { choice: 'C' });
  const arbitrated = await waitForState(
    admins[teamB].tracker,
    (s) => s.round && s.round.status === 'closed',
    'B tranché'
  );
  assert.strictEqual(arbitrated.round.decision, 'C');
  assert.strictEqual(arbitrated.round.decidedBy, 'dg');
  step('le DG tranche : décision C au nom de l’équipe');

  await call(admins[teamB].socket, 'round:finish', {});

  /* ------------------------------------------- table C : chrono et prolongation */
  const teamC = teamIds[2];
  await call(admins[teamC].socket, 'round:start', { eventId: evt1.id, durationSec: 5 });
  const openC = await waitForState(
    admins[teamC].tracker,
    (s) => s.round && s.round.status === 'open',
    'C ouvert'
  );
  const firstDeadline = openC.round.endsAt;
  await call(admins[teamC].socket, 'round:addTime', { seconds: 60 });
  const extended = await waitForState(
    admins[teamC].tracker,
    (s) => s.round && s.round.endsAt > firstDeadline,
    'C prolongé'
  );
  assert.ok(extended.round.endsAt - firstDeadline >= 55000, 'une minute ajoutée');
  step('table C : animateur prolonge le vote de 60 s');

  await call(admins[teamC].socket, 'round:close', {});
  const emptyC = await waitForState(
    admins[teamC].tracker,
    (s) => s.round && s.round.status === 'closed',
    'C clos sans vote'
  );
  assert.strictEqual(emptyC.round.decision, null, 'aucun vote → aucune décision');
  assert.strictEqual(emptyC.round.decidedBy, 'none');
  step('table C : clôture sans vote, aucune décision et aucun point');

  await call(admins[teamC].socket, 'round:cancel', {});
  await waitForState(admins[teamC].tracker, (s) => !s.round && s.history.length === 0, 'C annulé');
  step('table C : événement annulé, hors historique');

  /* ------------------------------ chrono qui expire tout seul (table C, 5 s) */
  await call(admins[teamC].socket, 'round:start', { eventId: evt1.id, durationSec: 5 });
  const cPlayers = playersOf(teamC);
  await call(playerConns[cPlayers[0].playerId].socket, 'player:vote', { choice: 'C' });
  const timedOut = await waitForState(
    admins[teamC].tracker,
    (s) => s.round && s.round.status === 'closed',
    'C expiré',
    12000
  );
  assert.strictEqual(timedOut.round.closeReason, 'timeout');
  assert.strictEqual(timedOut.round.decision, 'C', 'le seul vote exprimé fait la décision');
  step('chrono écoulé → clôture automatique, vote unique retenu');
  await call(admins[teamC].socket, 'round:finish', {});

  /* ----------------------------------------- barèmes acte 1 et acte 2 (super) */
  const superState = superTracker.state;
  const byName = {};
  for (const t of superState.teams) byName[t.id] = t;
  assert.strictEqual(byName[teamA].total, 2, 'acte 1, choix B = +1 / +1 = 2');
  assert.strictEqual(byName[teamB].total, 1, 'acte 1, choix C = −2 / +3 = 1');
  assert.strictEqual(byName[teamC].total, 1, 'acte 1, choix C = 1');
  step('barème acte 1 appliqué (B = +2, C = +1)');

  const act2 = superState.events.find((e) => e.act === 2);
  await call(admins[teamA].socket, 'round:start', { eventId: act2.id, durationSec: 120 });
  for (const p of aPlayers) {
    await call(playerConns[p.playerId].socket, 'player:vote', { choice: 'C' });
  }
  await waitForState(admins[teamA].tracker, (s) => s.round && s.round.status === 'closed', 'A acte 2');
  await call(admins[teamA].socket, 'round:finish', {});
  await waitForState(superTracker, (s) => s.teams.find((t) => t.id === teamA).total === 6, 'A à 6');
  step('barème acte 2 appliqué (C = +4, total 6)');

  /* ------------------------------------------------- classement par événement */
  const rankings = superTracker.state.rankings;
  const evt1Ranking = rankings.find((r) => r.eventId === evt1.id);
  assert.strictEqual(evt1Ranking.rows.length, 3, 'les trois tables ont joué l’événement 1');
  assert.strictEqual(evt1Ranking.rows[0].teamId, teamA, 'table A gagne l’événement 1 (+2)');
  assert.strictEqual(evt1Ranking.rows[0].rank, 1);
  step('classement par événement calculé et conservé en interne');

  /* ------------------------------------- les scores restent invisibles aux tables */
  const playerMid = playerConns[aPlayers[0].playerId].tracker.state;
  assert.strictEqual(playerMid.scoresVisible, false);
  assert.deepStrictEqual(playerMid.leaderboard, [], 'aucun classement côté joueur');
  assert.deepStrictEqual(playerMid.rankings, [], 'aucun classement par événement côté joueur');
  assert.strictEqual(playerMid.history[0].total, undefined, 'aucun point dans l’historique du joueur');
  const adminMid = admins[teamA].tracker.state;
  assert.strictEqual(adminMid.scoresVisible, false, 'l’animateur de table ne voit pas les points');
  step('scores invisibles pour les joueurs et les animateurs de table');

  /* --------------------------------------------------------- ajustement manuel */
  await call(superSocket, 'super:adjustScore', { teamId: teamB, delta: 5, reason: 'Fair play' });
  await waitForState(superTracker, (s) => s.teams.find((t) => t.id === teamB).adjust === 5, 'ajout +5');
  step('ajustement manuel +5 pris en compte');

  await call(superSocket, 'super:adjustScore', { teamId: teamB, delta: -2, reason: 'Hors délai' });
  await waitForState(superTracker, (s) => s.teams.find((t) => t.id === teamB).adjust === 3, 'retrait −2');
  step('retrait de points (−2) pris en compte');

  /* ------------------------------------------ correction d'une décision (super) */
  await call(superSocket, 'super:setDecision', { teamId: teamC, eventId: evt1.id, choice: 'B' });
  await waitForState(superTracker, (s) => s.teams.find((t) => t.id === teamC).total === 2, 'C corrigé');
  step('correction de décision par le super animateur, scores recalculés');

  /* --------------------------------------------------------------- dévoilement */
  await call(superSocket, 'super:reveal', {});
  const revealed = await waitForState(
    playerConns[aPlayers[0].playerId].tracker,
    (s) => s.scoresVisible === true,
    'dévoilement joueur'
  );
  assert.ok(revealed.leaderboard.length === 3, 'classement général visible après dévoilement');
  assert.strictEqual(revealed.leaderboard[0].name, byName[teamA].name, 'table A première');
  assert.ok(revealed.team.total !== undefined, 'le joueur voit enfin le total de son équipe');
  assert.ok(revealed.team.act1Profile, 'profil acte 1 révélé');
  step('dévoilement simultané : classement et profils visibles par tous');

  /* --------------------------------------- aucune statistique individuelle nulle part */
  const playerFinal = playerConns[aPlayers[0].playerId].tracker.state;
  const serialized = JSON.stringify(playerFinal.team.players);
  assert.ok(!/"total"|"score"|"rank"|"points"/.test(serialized), 'aucun score individuel exposé');
  step('aucune statistique individuelle dans l’état des joueurs');

  /* ------------------------------------------------------------------ archive */
  const ended = await call(superSocket, 'super:endSession', {});
  assert.ok(ended.recordId, 'enregistrement créé');
  step('session terminée et archivée');

  const list = await rest('/api/records');
  const entry = list.records.find((r) => r.id === ended.recordId);
  assert.ok(entry, 'archive listée');
  assert.strictEqual(entry.playerCount, 9, '9 joueurs archivés');
  assert.strictEqual(entry.winner.name, byName[teamA].name, 'vainqueur archivé');
  step(`historique : vainqueur ${entry.winner.name} (${entry.winner.total} pts)`);

  const detail = await rest(`/api/records/${ended.recordId}`);
  assert.strictEqual(detail.record.teams.length, 3, 'composition des trois tables archivée');
  assert.ok(detail.record.teams[0].roster[0].role, 'rôles archivés dans la composition');
  assert.ok(detail.record.events.length >= 1, 'classements par événement archivés');
  assert.ok(detail.record.events[0].results[0].tally, 'décompte des votes archivé');
  step('détail de l’archive complet (rosters, rôles, votes, classements)');

  const csv = await fetch(`${BASE}/api/records/${ended.recordId}/csv`);
  const csvText = await csv.text();
  assert.ok(csvText.includes('CLASSEMENT FINAL'), 'CSV : classement final');
  assert.ok(csvText.includes('COMPOSITION DES ÉQUIPES'), 'CSV : composition des équipes');
  assert.ok(csvText.includes('CLASSEMENT PAR ÉVÉNEMENT'), 'CSV : classement par événement');
  step('export CSV généré (classement, rosters, événements)');

  await call(superSocket, 'super:reopenSession', {});
  await waitForState(superTracker, (s) => s.session.status !== 'finished', 'session réouverte');
  step('session réouverte par le super animateur');

  /* ------------------------------------------------------------------- fin */
  superSocket.close();
  for (const key of Object.keys(admins)) admins[key].socket.close();
  for (const key of Object.keys(playerConns)) playerConns[key].socket.close();
  await sleep(100);
}

main()
  .then(() => {
    console.log(`\n${steps.length} vérifications passées.\n`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 500).unref();
  })
  .catch((err) => {
    console.error('\n✗ échec :', err.message);
    console.error(err.stack);
    server.close(() => process.exit(1));
    setTimeout(() => process.exit(1), 500).unref();
  });
