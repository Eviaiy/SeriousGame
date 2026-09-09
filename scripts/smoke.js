'use strict';

/**
 * Test de bout en bout : un animateur, trois équipes, deux événements joués,
 * un événement annulé, un ajustement manuel, une correction de réponse,
 * puis archivage et export.
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

function totals(state) {
  const out = {};
  for (const team of state.teams) out[team.name] = team.total;
  return out;
}

async function main() {
  /* --------------------------------------------------------------- session */
  const created = await post('/api/sessions', { name: 'Smoke test', facilitator: 'QA', lang: 'fr' });
  assert.ok(created.code && created.code.length === 6, 'code de session sur 6 caractères');
  assert.ok(created.adminKey, 'clé animateur générée');
  step(`session créée (${created.code})`);

  const teamNames = ['Alpha', 'Beta', 'Gamma'];
  const teams = {};
  for (const name of teamNames) {
    teams[name] = await post(`/api/sessions/${created.code}/teams`, { name });
  }
  step('3 équipes inscrites');

  await assert.rejects(
    () => post(`/api/sessions/${created.code}/teams`, { name: 'alpha' }),
    /name_taken|409|400/,
    'nom en doublon refusé'
  );
  step('doublon de nom d’équipe refusé');

  /* --------------------------------------------------------------- sockets */
  const adminSocket = await connect();
  const adminTracker = track(adminSocket);
  const joined = await call(adminSocket, 'admin:join', {
    sessionId: created.sessionId,
    adminKey: created.adminKey,
  });
  adminTracker.state = joined.state;
  assert.strictEqual(joined.state.role, 'admin');
  assert.strictEqual(joined.state.events.length, 10, '10 événements par défaut');
  step('animateur connecté, deck par défaut chargé (10 événements)');

  await assert.rejects(
    () => call(adminSocket, 'admin:join', { sessionId: created.sessionId, adminKey: 'faux' }),
    /forbidden/,
    'clé animateur invalide rejetée'
  );
  step('clé animateur invalide rejetée');

  const teamSockets = {};
  const teamTrackers = {};
  for (const name of teamNames) {
    const socket = await connect();
    teamSockets[name] = socket;
    teamTrackers[name] = track(socket);
    const res = await call(socket, 'team:join', {
      sessionId: created.sessionId,
      teamId: teams[name].teamId,
      teamToken: teams[name].teamToken,
    });
    teamTrackers[name].state = res.state;
  }
  step('3 équipes connectées en temps réel');

  /* ------------------------------------------------------ acte 1 : carte 1 */
  await call(adminSocket, 'admin:updateSettings', {
    settings: { defaultDuration: 5, autoReveal: true },
  });

  await call(adminSocket, 'admin:startRound', { eventId: 'act1-card1', durationSec: 5 });
  await waitForState(teamTrackers.Alpha, (s) => s.round && s.round.status === 'open', 'round ouvert');
  step('événement 1 lancé (5 s)');

  const teamStateBeforeVote = teamTrackers.Alpha.state;
  assert.strictEqual(teamStateBeforeVote.round.myChoice, null);
  assert.ok(
    teamStateBeforeVote.round.answers.every((a) => a.choice === null),
    'les équipes ne voient pas les choix des autres avant la révélation'
  );
  step('choix des autres équipes masqués pendant le vote');

  await call(teamSockets.Alpha, 'team:submit', { choice: 'A' });
  await new Promise((r) => setTimeout(r, 120));
  await call(teamSockets.Beta, 'team:submit', { choice: 'B' });
  await new Promise((r) => setTimeout(r, 120));
  await call(teamSockets.Gamma, 'team:submit', { choice: 'C' });

  await assert.rejects(
    () => call(teamSockets.Alpha, 'team:submit', { choice: 'C' }),
    /already_submitted/,
    'double vote refusé'
  );
  step('3 votes enregistrés, double vote refusé');

  const closed1 = await waitForState(
    adminTracker,
    (s) => s.round && s.round.status === 'closed',
    'fermeture automatique par le chrono',
    15000
  );
  assert.strictEqual(closed1.round.closeReason, 'timeout', 'fermeture déclenchée par le chrono');
  assert.strictEqual(closed1.round.revealed, true, 'révélation automatique');
  assert.deepStrictEqual(closed1.round.winnerNames, ['Beta'], 'B (+1/+1) remporte l’événement');
  step('chrono écoulé → clôture + révélation automatiques, gagnant Beta');

  assert.deepStrictEqual(totals(closed1), { Alpha: -1, Beta: 2, Gamma: 1 }, 'barème acte 1 appliqué');
  step('barème acte 1 appliqué (A = −1, B = +2, C = +1)');

  await call(adminSocket, 'admin:finishRound');
  await waitForState(adminTracker, (s) => !s.round, 'événement archivé');
  assert.strictEqual(adminTracker.state.history.length, 1);
  step('événement 1 archivé dans l’historique');

  /* ---------------------------------------------- acte 2 : étape 1 (points) */
  await call(adminSocket, 'admin:startRound', { eventId: 'act2-step1', durationSec: 60 });
  await waitForState(teamTrackers.Beta, (s) => s.round && s.round.status === 'open', 'round 2 ouvert');

  await call(teamSockets.Alpha, 'team:submit', { choice: 'C' });
  await call(teamSockets.Beta, 'team:submit', { choice: 'A' });
  await call(teamSockets.Gamma, 'team:submit', { choice: 'B' });
  await call(adminSocket, 'admin:closeRound');

  const closed2 = await waitForState(
    adminTracker,
    (s) => s.round && s.round.status === 'closed',
    'clôture manuelle'
  );
  assert.deepStrictEqual(closed2.round.winnerNames, ['Alpha'], 'C (+4) remporte l’étape');
  assert.deepStrictEqual(totals(closed2), { Alpha: 3, Beta: 2, Gamma: 3 }, 'points acte 2 cumulés');
  step('clôture manuelle, barème acte 2 appliqué (0 / +2 / +4)');

  const board = closed2.leaderboard;
  assert.deepStrictEqual(
    board.map((r) => `${r.name}:${r.rank}`),
    ['Alpha:1', 'Gamma:2', 'Beta:3'],
    'égalité arbitrée par le nombre de victoires'
  );
  step('classement trié (total, puis victoires)');

  await call(adminSocket, 'admin:finishRound');

  /* ------------------------------------- événement sans réponse, puis annulé */
  await call(adminSocket, 'admin:startRound', { eventId: 'act1-card2', durationSec: 5 });
  const closed3 = await waitForState(
    adminTracker,
    (s) => s.round && s.round.status === 'closed',
    'clôture sans réponse',
    15000
  );
  assert.deepStrictEqual(closed3.round.winnerNames, [], 'aucun gagnant sans réponse');
  assert.deepStrictEqual(totals(closed3), { Alpha: 3, Beta: 2, Gamma: 3 }, 'scores inchangés');
  step('événement sans réponse : aucun gagnant, scores inchangés');

  await call(adminSocket, 'admin:cancelRound');
  const cancelled = await waitForState(adminTracker, (s) => !s.round, 'événement annulé');
  assert.strictEqual(cancelled.history.length, 2, 'l’événement annulé n’est pas archivé');
  step('événement annulé, hors historique');

  /* ------------------------------------------------- ajustement et correction */
  await call(adminSocket, 'admin:adjustScore', {
    teamId: teams.Beta.teamId,
    delta: 5,
    reason: 'Argumentation remarquable',
  });
  const adjusted = await waitForState(
    adminTracker,
    (s) => totals(s).Beta === 7,
    'ajustement manuel'
  );
  assert.strictEqual(adjusted.leaderboard[0].name, 'Beta', 'Beta passe premier');
  step('ajustement manuel +5 pris en compte dans le classement');

  await call(adminSocket, 'admin:setAnswer', {
    teamId: teams.Beta.teamId,
    eventId: 'act1-card1',
    choice: 'C',
  });
  const overridden = await waitForState(adminTracker, (s) => totals(s).Beta === 6, 'réponse corrigée');
  const betaHistory = overridden.history.find((h) => h.eventId === 'act1-card1');
  assert.strictEqual(
    betaHistory.results.find((r) => r.teamName === 'Beta').choice,
    'C',
    'historique mis à jour'
  );
  step('correction de réponse par l’animateur, historique recalculé');

  await call(adminSocket, 'admin:adjustScore', {
    teamId: teams.Beta.teamId,
    delta: -2,
    reason: 'Retard',
  });
  await waitForState(adminTracker, (s) => totals(s).Beta === 4, 'ajustement négatif');
  step('retrait de points (−2) pris en compte');

  /* --------------------------------------------------- classement masqué côté équipe */
  await call(adminSocket, 'admin:updateSettings', {
    settings: { showLeaderboardToTeams: false },
  });
  const hidden = await waitForState(
    teamTrackers.Gamma,
    (s) => s.leaderboardHidden === true,
    'classement masqué'
  );
  assert.strictEqual(hidden.leaderboard.length, 1, 'l’équipe ne voit que sa ligne');
  assert.strictEqual(hidden.leaderboard[0].name, 'Gamma');
  step('classement masquable pour les équipes');

  /* ------------------------------------------------- événement personnalisé */
  const customRes = await call(adminSocket, 'admin:addEvent', {
    event: {
      act: 2,
      round: 5,
      color: 'gold',
      title: { fr: 'Carte maison', en: 'Custom card' },
      situation: { fr: 'Situation locale', en: 'Local situation' },
      motif: [],
      impact: [],
      options: [
        { key: 'A', label: { fr: 'Rien', en: 'Nothing' }, points: 0 },
        { key: 'B', label: { fr: 'Un peu', en: 'A bit' }, points: 3 },
        { key: 'C', label: { fr: 'Beaucoup', en: 'A lot' }, points: 7 },
      ],
    },
  });
  const withCustom = await waitForState(
    adminTracker,
    (s) => s.events.some((e) => e.id === customRes.eventId),
    'événement personnalisé'
  );
  const custom = withCustom.events.find((e) => e.id === customRes.eventId);
  assert.strictEqual(custom.options.find((o) => o.key === 'C').points, 7, 'barème personnalisé');
  step('événement personnalisé créé avec son propre barème');

  await call(adminSocket, 'admin:removeEvent', { eventId: customRes.eventId });
  step('événement personnalisé supprimé');

  /* -------------------------------------------------------------- archivage */
  const ended = await call(adminSocket, 'admin:endSession');
  assert.ok(ended.recordId, 'identifiant d’enregistrement retourné');
  await waitForState(adminTracker, (s) => s.session.status === 'finished', 'session terminée');
  step('session terminée et archivée');

  const list = await rest('/api/records');
  assert.strictEqual(list.records.length, 1);
  // Beta : acte 1 corrigé en C (+1) + acte 2 A (0) + ajustements (+5 −2) = 4.
  assert.strictEqual(list.records[0].winner.name, 'Beta', 'vainqueur = total le plus élevé');
  assert.strictEqual(list.records[0].winner.total, 4);
  step(`historique : vainqueur ${list.records[0].winner.name} (${list.records[0].winner.total} pts)`);

  const detail = await rest(`/api/records/${list.records[0].id}`);
  assert.strictEqual(detail.record.events.length, 2, '2 événements dans l’enregistrement');
  assert.strictEqual(detail.record.adjustments.length, 2, '2 ajustements tracés');
  step('détail de l’enregistrement complet (événements + ajustements)');

  const csvRes = await fetch(`${BASE}/api/records/${list.records[0].id}/csv`);
  const csv = await csvRes.text();
  assert.ok(csv.includes('CLASSEMENT FINAL'), 'export CSV avec le classement');
  assert.ok(csv.includes('Gamma'), 'export CSV avec les équipes');
  step('export CSV généré');

  /* --------------------------------------------------------- reprise animateur */
  await call(adminSocket, 'admin:reopenSession');
  await waitForState(adminTracker, (s) => s.session.status !== 'finished', 'session reprise');
  step('session réouverte par l’animateur');

  for (const socket of Object.values(teamSockets)) socket.close();
  adminSocket.close();
}

main()
  .then(() => {
    console.log(`\n${steps.length} vérifications passées.\n`);
    server.close(() => {
      fs.rmSync(DATA_DIR, { recursive: true, force: true });
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 1200).unref();
  })
  .catch((err) => {
    console.error('\n✗ ÉCHEC :', err.message);
    console.error(err.stack);
    server.close(() => {
      fs.rmSync(DATA_DIR, { recursive: true, force: true });
      process.exit(1);
    });
    setTimeout(() => process.exit(1), 1200).unref();
  });
