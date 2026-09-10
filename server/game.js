'use strict';

/**
 * Moteur de jeu / Game engine.
 *
 * Hiérarchie :
 *   super animateur  → crée la session, voit tout, dévoile les scores à la fin
 *   animateur d'équipe → lance et prolonge les événements de SA table
 *   joueur           → un rôle, une voix, un vote par événement
 *
 * Deux règles structurantes :
 *   1. Chaque équipe avance à son rythme : la manche est portée par l'équipe,
 *      pas par la session.
 *   2. Les scores restent invisibles (sauf pour le super animateur) jusqu'au
 *      dévoilement final, pour que personne n'ajuste sa stratégie en route.
 */

const crypto = require('crypto');
const store = require('./store');
const deck = require('./deck');

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_TEAMS = 12;
const MAX_EVENTS = 60;
const MAX_PLAYERS_PER_TEAM = 10;
const DEFAULT_DURATION = 300;
const MIN_DURATION = 5;
const DEFAULT_TEAM_SIZE = 6;
const DEFAULT_ARBITRATION = 90;

const DEFAULT_SETTINGS = {
  defaultDuration: DEFAULT_DURATION,
  teamSize: DEFAULT_TEAM_SIZE,
  arbitrationSeconds: DEFAULT_ARBITRATION,
  autoAssignRoles: true,
  autoCloseOnAllVotes: true,
  allowLateJoin: true,
  allowChangeVote: true,
};

/* ------------------------------------------------------------------ utils */

function id(prefix) {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

function token() {
  return crypto.randomBytes(16).toString('hex');
}

function newCode() {
  let out = '';
  const bytes = crypto.randomBytes(6);
  for (let i = 0; i < 6; i += 1) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return out;
}

function cleanText(value, max = 60) {
  return String(value == null ? '' : value)
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function toInt(value, fallback = 0) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

function bilingual(value, fallback = '') {
  if (value && typeof value === 'object') {
    const fr = cleanText(value.fr, 400) || cleanText(value.en, 400) || fallback;
    const en = cleanText(value.en, 400) || fr;
    return { fr, en };
  }
  const text = cleanText(value, 400) || fallback;
  return { fr: text, en: text };
}

/** Mélange de Fisher-Yates : le tirage des rôles doit être réellement uniforme. */
function shuffle(list) {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

class GameError extends Error {
  constructor(code, message) {
    super(message || code);
    this.code = code;
  }
}

/* --------------------------------------------------------------- sessions */

function usedCodes() {
  const codes = new Set();
  for (const s of Object.values(store.state.sessions)) {
    codes.add(s.code);
    for (const t of s.teams) codes.add(t.adminCode);
  }
  return codes;
}

function uniqueCode(taken = usedCodes()) {
  let code = newCode();
  let guard = 0;
  while (taken.has(code) && guard < 80) {
    code = newCode();
    guard += 1;
  }
  taken.add(code);
  return code;
}

function createSession({ name, lang, facilitator, teamCount, teamSize } = {}) {
  const taken = usedCodes();
  const session = {
    id: id('sess'),
    code: uniqueCode(taken),
    superKey: token(),
    name: cleanText(name, 80) || 'Serious Game — Facturation électronique',
    facilitator: cleanText(facilitator, 60),
    lang: lang === 'en' ? 'en' : 'fr',
    status: 'lobby',
    revealed: false,
    revealedAt: null,
    createdAt: Date.now(),
    startedAt: null,
    endedAt: null,
    settings: {
      ...DEFAULT_SETTINGS,
      teamSize: clamp(toInt(teamSize, DEFAULT_TEAM_SIZE), 2, MAX_PLAYERS_PER_TEAM),
    },
    teams: [],
    events: deck.cloneDefaultEvents(),
    log: [],
    archivedRecordId: null,
  };

  const count = clamp(toInt(teamCount, 4), 1, MAX_TEAMS);
  for (let i = 0; i < count; i += 1) createTeam(session, null, taken);

  addLog(session, 'session_created', { name: session.name, teams: count });
  store.state.sessions[session.id] = session;
  store.persistSessions();
  return session;
}

function getSession(sessionId) {
  return store.state.sessions[sessionId] || null;
}

function findByCode(code) {
  const wanted = cleanText(code, 12).toUpperCase();
  if (!wanted) return null;
  return Object.values(store.state.sessions).find((s) => s.code === wanted) || null;
}

/** Retrouve la table à partir du code remis à son animateur. */
function findByTeamCode(code) {
  const wanted = cleanText(code, 12).toUpperCase();
  if (!wanted) return null;
  for (const session of Object.values(store.state.sessions)) {
    const team = session.teams.find((t) => t.adminCode === wanted);
    if (team) return { session, team };
  }
  return null;
}

function requireSession(sessionId) {
  const session = getSession(sessionId);
  if (!session) throw new GameError('session_not_found', 'Session introuvable');
  return session;
}

function assertSuper(session, key) {
  if (!key || key !== session.superKey) {
    throw new GameError('forbidden', 'Clé super animateur invalide');
  }
}

function authTeamAdmin(session, teamId, adminToken) {
  const team = getTeam(session, teamId);
  if (!team || !adminToken || team.adminToken !== adminToken) {
    throw new GameError('forbidden', 'Accès animateur d’équipe invalide');
  }
  return team;
}

function authPlayer(session, playerId, playerToken) {
  for (const team of session.teams) {
    const player = team.players.find((p) => p.id === playerId);
    if (player) {
      if (player.token !== playerToken) throw new GameError('forbidden', 'Accès joueur invalide');
      return { team, player };
    }
  }
  throw new GameError('player_not_found', 'Joueur introuvable');
}

function deleteSession(session) {
  delete store.state.sessions[session.id];
  store.persistSessions();
}

function pruneSessions(maxAgeMs = 30 * 24 * 3600 * 1000) {
  const now = Date.now();
  let removed = 0;
  for (const session of Object.values(store.state.sessions)) {
    const last = session.endedAt || lastActivity(session);
    if (now - last > maxAgeMs) {
      delete store.state.sessions[session.id];
      removed += 1;
    }
  }
  if (removed) store.persistSessions();
  return removed;
}

function lastActivity(session) {
  const logTs = session.log.length ? session.log[session.log.length - 1].ts : 0;
  return Math.max(session.createdAt || 0, logTs);
}

/* -------------------------------------------------------------------- log */

function addLog(session, type, params = {}) {
  session.log.push({ id: id('log'), ts: Date.now(), type, params });
  if (session.log.length > 600) session.log.splice(0, session.log.length - 600);
}

/* ------------------------------------------------------------------ teams */

function createTeam(session, name, taken) {
  const index = session.teams.length + 1;
  const team = {
    id: id('team'),
    name: cleanText(name, 40) || `Table ${index}`,
    adminToken: token(),
    adminCode: uniqueCode(taken || usedCodes()),
    createdAt: Date.now(),
    players: [],
    rolesAssignedAt: null,
    round: null,
    answers: {},
    history: [],
    adjustments: [],
    short: 0,
    long: 0,
    points: 0,
    adjust: 0,
    wins: 0,
  };
  session.teams.push(team);
  return team;
}

function addTeam(session, name) {
  if (session.teams.length >= MAX_TEAMS) throw new GameError('too_many_teams', 'Trop d’équipes');
  const clean = cleanText(name, 40);
  if (clean && session.teams.some((t) => t.name.toLowerCase() === clean.toLowerCase())) {
    throw new GameError('name_taken', 'Ce nom d’équipe est déjà pris');
  }
  const team = createTeam(session, clean);
  addLog(session, 'team_added', { team: team.name });
  store.persistSessions();
  return team;
}

function getTeam(session, teamId) {
  return session.teams.find((t) => t.id === teamId) || null;
}

function requireTeam(session, teamId) {
  const team = getTeam(session, teamId);
  if (!team) throw new GameError('team_not_found', 'Équipe introuvable');
  return team;
}

function renameTeam(session, teamId, name) {
  const team = requireTeam(session, teamId);
  const clean = cleanText(name, 40);
  if (clean.length < 2) throw new GameError('bad_name', 'Nom d’équipe trop court');
  const clash = session.teams.some(
    (t) => t.id !== teamId && t.name.toLowerCase() === clean.toLowerCase()
  );
  if (clash) throw new GameError('name_taken', 'Ce nom d’équipe est déjà pris');
  const before = team.name;
  team.name = clean;
  addLog(session, 'team_renamed', { team: clean, from: before });
  store.persistSessions();
  return team;
}

function removeTeam(session, teamId) {
  const team = requireTeam(session, teamId);
  if (session.teams.length <= 1) throw new GameError('last_team', 'Il faut au moins une équipe');
  session.teams = session.teams.filter((t) => t.id !== teamId);
  addLog(session, 'team_removed', { team: team.name });
  store.persistSessions();
  return team;
}

function regenTeamCode(session, teamId) {
  const team = requireTeam(session, teamId);
  team.adminCode = uniqueCode();
  team.adminToken = token();
  addLog(session, 'team_code_reset', { team: team.name });
  store.persistSessions();
  return team;
}

/* ---------------------------------------------------------------- joueurs */

function findPlayerByName(session, name) {
  const wanted = name.toLowerCase();
  for (const team of session.teams) {
    const player = team.players.find((p) => p.name.toLowerCase() === wanted);
    if (player) return { team, player };
  }
  return null;
}

/** Répartition automatique : la table la moins remplie accueille le joueur. */
function pickTeamForJoin(session) {
  const size = session.settings.teamSize;
  const open = session.teams.filter((t) => t.players.length < size);
  const pool = open.length ? open : session.teams.filter((t) => t.players.length < MAX_PLAYERS_PER_TEAM);
  if (!pool.length) throw new GameError('session_full', 'Toutes les tables sont complètes');
  return pool.reduce((best, t) => (t.players.length < best.players.length ? t : best), pool[0]);
}

function joinPlayer(session, name) {
  if (session.status === 'finished') throw new GameError('session_finished', 'Session terminée');
  const clean = cleanText(name, 40);
  if (clean.length < 2) throw new GameError('bad_name', 'Nom trop court');
  if (findPlayerByName(session, clean)) throw new GameError('name_taken', 'Ce nom est déjà pris');
  if (!session.settings.allowLateJoin && session.status === 'running') {
    throw new GameError('join_closed', 'Les inscriptions sont fermées');
  }

  const team = pickTeamForJoin(session);
  const player = {
    id: id('pl'),
    token: token(),
    name: clean,
    roleId: null,
    sockets: 0,
    joinedAt: Date.now(),
  };
  team.players.push(player);
  addLog(session, 'player_joined', { player: clean, team: team.name });

  // Table complète : on distribue les rôles sans attendre l'animateur.
  let rolesJustAssigned = false;
  if (
    session.settings.autoAssignRoles &&
    !team.rolesAssignedAt &&
    team.players.length >= session.settings.teamSize
  ) {
    assignRoles(session, team.id);
    rolesJustAssigned = true;
  } else if (team.rolesAssignedAt) {
    // Arrivée tardive : le retardataire reçoit un rôle libre, jamais celui du DG.
    player.roleId = spareRoleFor(team);
  }

  store.persistSessions();
  return { team, player, rolesJustAssigned };
}

function spareRoleFor(team) {
  const taken = new Set(team.players.map((p) => p.roleId).filter(Boolean));
  const free = deck.ROLES.filter((r) => !r.dg && !taken.has(r.id));
  if (free.length) return shuffle(free)[0].id;
  const others = deck.ROLES.filter((r) => !r.dg);
  return shuffle(others)[0].id;
}

/**
 * Tirage des rôles. Le DG est placé en tête de liste avant de mélanger les
 * joueurs : la table a donc toujours exactement un arbitre, même incomplète.
 */
function assignRoles(session, teamId) {
  const team = requireTeam(session, teamId);
  if (!team.players.length) throw new GameError('no_players', 'Aucun joueur dans cette équipe');

  const dg = deck.dgRole();
  const others = shuffle(deck.ROLES.filter((r) => r.id !== dg.id));
  const order = [dg, ...others];
  const players = shuffle(team.players);

  players.forEach((player, index) => {
    const role = index < order.length ? order[index] : others[(index - order.length) % others.length];
    player.roleId = role.id;
  });

  team.rolesAssignedAt = Date.now();
  addLog(session, 'roles_assigned', { team: team.name, players: team.players.length });
  store.persistSessions();
  return team;
}

function renamePlayer(session, playerId, name) {
  const found = session.teams
    .flatMap((team) => team.players.map((player) => ({ team, player })))
    .find((x) => x.player.id === playerId);
  if (!found) throw new GameError('player_not_found', 'Joueur introuvable');
  const clean = cleanText(name, 40);
  if (clean.length < 2) throw new GameError('bad_name', 'Nom trop court');
  const clash = findPlayerByName(session, clean);
  if (clash && clash.player.id !== playerId) throw new GameError('name_taken', 'Ce nom est déjà pris');
  found.player.name = clean;
  store.persistSessions();
  return found.player;
}

function removePlayer(session, playerId) {
  for (const team of session.teams) {
    const player = team.players.find((p) => p.id === playerId);
    if (!player) continue;
    team.players = team.players.filter((p) => p.id !== playerId);
    if (team.round && team.round.votes[playerId]) delete team.round.votes[playerId];
    if (!team.players.length) team.rolesAssignedAt = null;
    addLog(session, 'player_removed', { player: player.name, team: team.name });
    store.persistSessions();
    return { team, player };
  }
  throw new GameError('player_not_found', 'Joueur introuvable');
}

function movePlayer(session, playerId, targetTeamId) {
  const target = requireTeam(session, targetTeamId);
  for (const team of session.teams) {
    const player = team.players.find((p) => p.id === playerId);
    if (!player) continue;
    if (team.id === target.id) return { team, player };
    if (target.players.length >= MAX_PLAYERS_PER_TEAM) {
      throw new GameError('team_full', 'Cette table est complète');
    }
    team.players = team.players.filter((p) => p.id !== playerId);
    if (team.round && team.round.votes[playerId]) delete team.round.votes[playerId];
    if (!team.players.length) team.rolesAssignedAt = null;
    target.players.push(player);
    player.roleId = target.rolesAssignedAt ? spareRoleFor(target) : null;
    addLog(session, 'player_moved', { player: player.name, team: target.name, from: team.name });
    store.persistSessions();
    return { team: target, player };
  }
  throw new GameError('player_not_found', 'Joueur introuvable');
}

function dgPlayer(team) {
  const dg = deck.dgRole();
  return team.players.find((p) => p.roleId === dg.id) || null;
}

/* ----------------------------------------------------------------- events */

function getEvent(session, eventId) {
  return session.events.find((e) => e.id === eventId) || null;
}

function requireEvent(session, eventId) {
  const event = getEvent(session, eventId);
  if (!event) throw new GameError('event_not_found', 'Événement introuvable');
  return event;
}

function normalizeOptionScores(act, opt) {
  if (act === 2) {
    return { short: null, long: null, points: clamp(toInt(opt.points, 0), -50, 50) };
  }
  return {
    short: clamp(toInt(opt.short, 0), -50, 50),
    long: clamp(toInt(opt.long, 0), -50, 50),
    points: null,
  };
}

function buildEvent(input, existing) {
  const act = toInt(input.act, existing ? existing.act : 1) === 2 ? 2 : 1;
  const source = Array.isArray(input.options) && input.options.length ? input.options : null;
  const rawOptions = source || (existing ? existing.options : []);

  const options = ['A', 'B', 'C'].map((key) => {
    const raw = rawOptions.find((o) => o && o.key === key) || {};
    const scores = normalizeOptionScores(act, {
      short: raw.short != null ? raw.short : deck.ACT1_MATRIX[key].short,
      long: raw.long != null ? raw.long : deck.ACT1_MATRIX[key].long,
      points: raw.points != null ? raw.points : deck.ACT2_MATRIX[key],
    });
    return {
      key,
      label: bilingual(raw.label, key),
      ...scores,
      reveal: raw.reveal ? bilingual(raw.reveal) : null,
    };
  });

  const listOf = (value) => {
    if (!Array.isArray(value)) return [];
    return value.slice(0, 8).map((item) => bilingual(item)).filter((b) => b.fr);
  };

  return {
    id: existing ? existing.id : id('evt'),
    act,
    round: clamp(toInt(input.round, existing ? existing.round : 1), 1, 9),
    ref: bilingual(input.ref || (existing && existing.ref), act === 1 ? 'Carte' : 'Étape'),
    tag: bilingual(input.tag || (existing && existing.tag), act === 1 ? 'Incident' : 'Transformation'),
    color: ['red', 'orange', 'blue', 'gold'].includes(input.color)
      ? input.color
      : existing
        ? existing.color
        : act === 1
          ? 'red'
          : 'blue',
    title: bilingual(input.title || (existing && existing.title), 'Événement'),
    situation: bilingual(input.situation || (existing && existing.situation)),
    motif: input.motif !== undefined ? listOf(input.motif) : existing ? existing.motif : [],
    impact: input.impact !== undefined ? listOf(input.impact) : existing ? existing.impact : [],
    tension: input.tension ? bilingual(input.tension) : existing ? existing.tension : null,
    options,
    custom: existing ? existing.custom : true,
  };
}

function addEvent(session, input) {
  if (session.events.length >= MAX_EVENTS) throw new GameError('too_many_events', 'Trop d’événements');
  const event = buildEvent(input || {}, null);
  session.events.push(event);
  addLog(session, 'event_added', { event: event.title.fr });
  store.persistSessions();
  return event;
}

function updateEvent(session, eventId, input) {
  const existing = requireEvent(session, eventId);
  const updated = buildEvent(input || {}, existing);
  session.events[session.events.findIndex((e) => e.id === eventId)] = updated;
  recomputeAllScores(session);
  addLog(session, 'event_updated', { event: updated.title.fr });
  store.persistSessions();
  return updated;
}

function removeEvent(session, eventId) {
  const event = requireEvent(session, eventId);
  if (session.teams.some((t) => t.round && t.round.eventId === eventId)) {
    throw new GameError('event_in_play', 'Événement en cours sur une table');
  }
  session.events = session.events.filter((e) => e.id !== eventId);
  for (const team of session.teams) {
    delete team.answers[eventId];
    team.history = team.history.filter((h) => h.eventId !== eventId);
  }
  recomputeAllScores(session);
  addLog(session, 'event_removed', { event: event.title.fr });
  store.persistSessions();
  return event;
}

function moveEvent(session, eventId, direction) {
  const index = session.events.findIndex((e) => e.id === eventId);
  if (index < 0) throw new GameError('event_not_found', 'Événement introuvable');
  const target = index + (direction < 0 ? -1 : 1);
  if (target < 0 || target >= session.events.length) return session.events;
  const [item] = session.events.splice(index, 1);
  session.events.splice(target, 0, item);
  store.persistSessions();
  return session.events;
}

function teamPlayed(team, eventId) {
  return team.history.some((h) => h.eventId === eventId);
}

/** Prochain événement de la liste que cette table n'a pas encore joué. */
function nextEventFor(session, team) {
  return session.events.find((e) => !teamPlayed(team, e.id)) || null;
}

function teamDone(session, team) {
  return session.events.length > 0 && session.events.every((e) => teamPlayed(team, e.id));
}

function activeTeams(session) {
  return session.teams.filter((t) => t.players.length > 0);
}

function allTeamsDone(session) {
  const active = activeTeams(session);
  if (!active.length) return false;
  return active.every((team) => teamDone(session, team) && !team.round);
}

/* --------------------------------------------------------- manche d'équipe */

function startRound(session, teamId, eventId, durationSec) {
  const team = requireTeam(session, teamId);
  if (session.status === 'finished') throw new GameError('session_finished', 'Session terminée');
  if (team.round) throw new GameError('round_open', 'Un événement est déjà en cours sur cette table');
  if (!team.players.length) throw new GameError('no_players', 'Aucun joueur à cette table');

  const event = eventId ? requireEvent(session, eventId) : nextEventFor(session, team);
  if (!event) throw new GameError('no_event_left', 'Tous les événements ont été joués');

  const duration = clamp(toInt(durationSec, session.settings.defaultDuration), MIN_DURATION, 3600);
  const now = Date.now();

  session.status = 'running';
  if (!session.startedAt) session.startedAt = now;

  team.round = {
    eventId: event.id,
    no: team.history.length + 1,
    startedAt: now,
    durationSec: duration,
    endsAt: now + duration * 1000,
    pausedAt: null,
    closedAt: null,
    status: 'open',
    votes: {},
    tally: { A: 0, B: 0, C: 0 },
    tied: [],
    decision: null,
    decidedBy: null,
    arbitrationEndsAt: null,
    replay: teamPlayed(team, event.id),
  };

  addLog(session, 'round_started', {
    team: team.name,
    event: event.title.fr,
    eventEn: event.title.en,
    seconds: duration,
  });
  store.persistSessions();
  return team.round;
}

function requireRound(team) {
  if (!team.round) throw new GameError('no_round', 'Aucun événement en cours');
  return team.round;
}

function requireOpenRound(team) {
  const round = requireRound(team);
  if (round.status !== 'open') throw new GameError('round_closed', 'Le vote est clos');
  return round;
}

function pauseRound(session, teamId) {
  const team = requireTeam(session, teamId);
  const round = requireOpenRound(team);
  if (round.pausedAt) return round;
  round.pausedAt = Date.now();
  addLog(session, 'round_paused', { team: team.name });
  store.persistSessions();
  return round;
}

function resumeRound(session, teamId) {
  const team = requireTeam(session, teamId);
  const round = requireOpenRound(team);
  if (!round.pausedAt) return round;
  round.endsAt += Date.now() - round.pausedAt;
  round.pausedAt = null;
  addLog(session, 'round_resumed', { team: team.name });
  store.persistSessions();
  return round;
}

function addTime(session, teamId, seconds) {
  const team = requireTeam(session, teamId);
  const round = requireRound(team);
  const delta = clamp(toInt(seconds, 0), -3600, 3600);

  if (round.status === 'arbitration') {
    round.arbitrationEndsAt = Math.max(Date.now() + 3000, round.arbitrationEndsAt + delta * 1000);
  } else {
    round.endsAt = Math.max(Date.now() + 3000, round.endsAt + delta * 1000);
    round.durationSec = Math.max(MIN_DURATION, Math.round((round.endsAt - round.startedAt) / 1000));
  }
  addLog(session, 'round_time_changed', { team: team.name, seconds: delta });
  store.persistSessions();
  return round;
}

function vote(session, teamId, playerId, choice) {
  const team = requireTeam(session, teamId);
  const round = requireOpenRound(team);
  if (round.pausedAt) throw new GameError('round_paused', 'Événement en pause');
  const player = team.players.find((p) => p.id === playerId);
  if (!player) throw new GameError('player_not_found', 'Joueur introuvable');

  const event = requireEvent(session, round.eventId);
  const key = String(choice || '').toUpperCase();
  if (!event.options.some((o) => o.key === key)) throw new GameError('bad_choice', 'Choix invalide');
  if (Date.now() > round.endsAt) throw new GameError('time_up', 'Temps écoulé');

  const existing = round.votes[playerId];
  if (existing && !session.settings.allowChangeVote) {
    throw new GameError('already_voted', 'Vote déjà enregistré');
  }

  const at = Date.now();
  round.votes[playerId] = {
    choice: key,
    at,
    ms: Math.max(0, at - round.startedAt),
    changed: Boolean(existing),
  };

  let closed = false;
  if (session.settings.autoCloseOnAllVotes && team.players.every((p) => round.votes[p.id])) {
    closeRound(session, teamId, 'all_voted');
    closed = true;
  }
  store.persistSessions();
  return { vote: round.votes[playerId], closed, round: team.round };
}

function computeTally(team, round) {
  const tally = { A: 0, B: 0, C: 0 };
  for (const player of team.players) {
    const v = round.votes[player.id];
    if (v && tally[v.choice] !== undefined) tally[v.choice] += 1;
  }
  return tally;
}

/**
 * Clôture du vote. Majorité simple ; en cas d'égalité la manche passe en
 * arbitrage et seul le DG (ou l'animateur d'équipe) peut trancher.
 */
function closeRound(session, teamId, reason = 'manual') {
  const team = requireTeam(session, teamId);
  const round = requireRound(team);
  if (round.status !== 'open') return round;

  round.pausedAt = null;
  round.closeReason = reason;
  const tally = computeTally(team, round);
  round.tally = tally;

  const cast = tally.A + tally.B + tally.C;
  if (!cast) {
    round.tied = [];
    finalizeRound(session, team, null, 'none');
    return team.round || round;
  }

  const best = Math.max(tally.A, tally.B, tally.C);
  const leaders = ['A', 'B', 'C'].filter((k) => tally[k] === best);

  if (leaders.length === 1) {
    round.tied = [];
    finalizeRound(session, team, leaders[0], 'majority');
    return team.round || round;
  }

  round.status = 'arbitration';
  round.tied = leaders;
  round.arbitrationEndsAt = Date.now() + session.settings.arbitrationSeconds * 1000;
  const dg = dgPlayer(team);
  addLog(session, 'round_tied', { team: team.name, options: leaders.join(' / '), dg: dg ? dg.name : '—' });
  store.persistSessions();
  return round;
}

function arbitrate(session, teamId, choice, by = 'dg') {
  const team = requireTeam(session, teamId);
  const round = requireRound(team);
  if (round.status !== 'arbitration') throw new GameError('no_arbitration', 'Aucun arbitrage en cours');
  const key = String(choice || '').toUpperCase();
  if (!round.tied.includes(key)) throw new GameError('bad_choice', 'Choix hors égalité');
  finalizeRound(session, team, key, by);
  return team.round;
}

/** L'arbitrage n'a pas eu lieu à temps : tirage au sort entre les options à égalité. */
function autoArbitrate(session, teamId) {
  const team = requireTeam(session, teamId);
  const round = requireRound(team);
  if (round.status !== 'arbitration') return round;
  const pick = round.tied[crypto.randomInt(round.tied.length)];
  finalizeRound(session, team, pick, 'draw');
  return team.round;
}

function optionScore(event, key) {
  const option = event.options.find((o) => o.key === key);
  if (!option) return { short: 0, long: 0, points: 0, total: 0 };
  if (event.act === 2) {
    const points = toInt(option.points, 0);
    return { short: 0, long: 0, points, total: points };
  }
  const short = toInt(option.short, 0);
  const long = toInt(option.long, 0);
  return { short, long, points: 0, total: short + long };
}

/** Fige la décision de la table, l'archive et libère le plateau. */
function finalizeRound(session, team, decision, decidedBy) {
  const round = team.round;
  const event = requireEvent(session, round.eventId);
  const now = Date.now();

  round.status = 'closed';
  round.closedAt = now;
  round.decision = decision;
  round.decidedBy = decidedBy;
  round.arbitrationEndsAt = null;

  const score = decision ? optionScore(event, decision) : { short: 0, long: 0, points: 0, total: 0 };
  const entry = {
    eventId: event.id,
    eventTitle: event.title,
    eventRef: event.ref,
    act: event.act,
    no: round.no,
    startedAt: round.startedAt,
    closedAt: now,
    durationSec: round.durationSec,
    decision,
    decidedBy,
    tally: { ...round.tally },
    voters: Object.keys(round.votes).length,
    headcount: team.players.length,
    decisionMs: Math.max(0, now - round.startedAt),
    ...score,
  };

  team.answers[event.id] = entry;
  team.history = team.history.filter((h) => h.eventId !== event.id);
  team.history.push(entry);
  team.history.sort((a, b) => a.startedAt - b.startedAt);
  recomputeTeamScore(team);

  addLog(session, 'round_decided', {
    team: team.name,
    event: event.title.fr,
    eventEn: event.title.en,
    choice: decision || '—',
    by: decidedBy,
  });
  store.persistSessions();
  return entry;
}

/** L'animateur d'équipe range la carte : le plateau est prêt pour la suivante. */
function finishRound(session, teamId) {
  const team = requireTeam(session, teamId);
  const round = requireRound(team);
  if (round.status === 'open') closeRound(session, teamId, 'manual');
  if (team.round && team.round.status === 'arbitration') autoArbitrate(session, teamId);
  team.round = null;
  store.persistSessions();
  return teamDone(session, team);
}

function cancelRound(session, teamId) {
  const team = requireTeam(session, teamId);
  const round = requireRound(team);
  const event = getEvent(session, round.eventId);
  delete team.answers[round.eventId];
  team.history = team.history.filter((h) => h.eventId !== round.eventId);
  team.round = null;
  recomputeTeamScore(team);
  addLog(session, 'round_cancelled', { team: team.name, event: event ? event.title.fr : '?' });
  store.persistSessions();
  return true;
}

function replayEvent(session, teamId, eventId, durationSec) {
  const team = requireTeam(session, teamId);
  requireEvent(session, eventId);
  if (team.round) finishRound(session, teamId);
  team.history = team.history.filter((h) => h.eventId !== eventId);
  delete team.answers[eventId];
  recomputeTeamScore(team);
  return startRound(session, teamId, eventId, durationSec);
}

/* ----------------------------------------------------------------- scores */

function recomputeTeamScore(team) {
  let short = 0;
  let long = 0;
  let points = 0;
  for (const answer of Object.values(team.answers)) {
    short += toInt(answer.short, 0);
    long += toInt(answer.long, 0);
    points += toInt(answer.points, 0);
  }
  team.short = short;
  team.long = long;
  team.points = points;
  team.adjust = team.adjustments.reduce((sum, a) => sum + toInt(a.delta, 0), 0);
  return team;
}

function recomputeAllScores(session) {
  for (const team of session.teams) recomputeTeamScore(team);
  return session.teams;
}

function teamTotals(team) {
  const act1 = team.short + team.long;
  const act2 = team.points;
  return {
    short: team.short,
    long: team.long,
    act1,
    act2,
    adjust: team.adjust,
    total: act1 + act2 + team.adjust,
  };
}

function adjustScore(session, teamId, delta, reason) {
  const team = requireTeam(session, teamId);
  const value = clamp(toInt(delta, 0), -100, 100);
  if (!value) throw new GameError('bad_delta', 'Valeur invalide');
  const entry = { id: id('adj'), delta: value, reason: cleanText(reason, 120), ts: Date.now() };
  team.adjustments.push(entry);
  recomputeTeamScore(team);
  addLog(session, 'score_adjusted', { team: team.name, delta: value, reason: entry.reason });
  store.persistSessions();
  return entry;
}

function removeAdjustment(session, teamId, adjustmentId) {
  const team = requireTeam(session, teamId);
  const entry = team.adjustments.find((a) => a.id === adjustmentId);
  if (!entry) throw new GameError('not_found', 'Ajustement introuvable');
  team.adjustments = team.adjustments.filter((a) => a.id !== adjustmentId);
  recomputeTeamScore(team);
  addLog(session, 'score_adjust_removed', { team: team.name, delta: entry.delta });
  store.persistSessions();
  return entry;
}

/** Le super animateur corrige la décision d'une table (erreur de saisie, litige). */
function setDecision(session, teamId, eventId, choice) {
  const team = requireTeam(session, teamId);
  const event = requireEvent(session, eventId);
  const key = choice ? String(choice).toUpperCase() : null;
  if (key && !event.options.some((o) => o.key === key)) {
    throw new GameError('bad_choice', 'Choix invalide');
  }

  if (!key) {
    delete team.answers[eventId];
    team.history = team.history.filter((h) => h.eventId !== eventId);
  } else {
    const score = optionScore(event, key);
    const previous = team.answers[eventId] || {};
    const entry = {
      ...previous,
      eventId,
      eventTitle: event.title,
      eventRef: event.ref,
      act: event.act,
      no: previous.no || team.history.length + 1,
      startedAt: previous.startedAt || Date.now(),
      closedAt: previous.closedAt || Date.now(),
      durationSec: previous.durationSec || session.settings.defaultDuration,
      decision: key,
      decidedBy: 'admin',
      tally: previous.tally || { A: 0, B: 0, C: 0 },
      voters: previous.voters || 0,
      headcount: previous.headcount || team.players.length,
      decisionMs: previous.decisionMs == null ? null : previous.decisionMs,
      ...score,
    };
    team.answers[eventId] = entry;
    team.history = team.history.filter((h) => h.eventId !== eventId);
    team.history.push(entry);
    team.history.sort((a, b) => a.startedAt - b.startedAt);
  }

  if (team.round && team.round.eventId === eventId && team.round.status === 'closed') {
    team.round.decision = key;
    team.round.decidedBy = 'admin';
  }

  recomputeTeamScore(team);
  addLog(session, 'decision_overridden', {
    team: team.name,
    event: event.title.fr,
    choice: key || '—',
  });
  store.persistSessions();
  return team.answers[eventId] || null;
}

function updateSettings(session, patch = {}) {
  const s = session.settings;
  if (patch.defaultDuration !== undefined) {
    s.defaultDuration = clamp(toInt(patch.defaultDuration, s.defaultDuration), MIN_DURATION, 3600);
  }
  if (patch.teamSize !== undefined) {
    s.teamSize = clamp(toInt(patch.teamSize, s.teamSize), 2, MAX_PLAYERS_PER_TEAM);
  }
  if (patch.arbitrationSeconds !== undefined) {
    s.arbitrationSeconds = clamp(toInt(patch.arbitrationSeconds, s.arbitrationSeconds), 10, 900);
  }
  for (const key of ['autoAssignRoles', 'autoCloseOnAllVotes', 'allowLateJoin', 'allowChangeVote']) {
    if (patch[key] !== undefined) s[key] = Boolean(patch[key]);
  }
  if (patch.lang === 'fr' || patch.lang === 'en') session.lang = patch.lang;
  if (patch.name !== undefined) session.name = cleanText(patch.name, 80) || session.name;
  addLog(session, 'settings_updated', {});
  store.persistSessions();
  return session.settings;
}

/* ------------------------------------------------------------ classements */

/**
 * Classement par événement : uniquement entre les tables qui l'ont joué,
 * départagées par le temps mis à décider. Conservé en interne jusqu'au
 * dévoilement.
 */
function eventRankings(session) {
  return session.events
    .map((event) => {
      const rows = session.teams
        .filter((team) => team.answers[event.id])
        .map((team) => {
          const answer = team.answers[event.id];
          return {
            teamId: team.id,
            teamName: team.name,
            decision: answer.decision,
            decidedBy: answer.decidedBy,
            tally: answer.tally,
            short: answer.short,
            long: answer.long,
            points: answer.points,
            total: answer.total,
            seconds: answer.decisionMs == null ? null : Math.round(answer.decisionMs / 100) / 10,
          };
        })
        .sort((a, b) => {
          if (b.total !== a.total) return b.total - a.total;
          const sa = a.seconds == null ? Infinity : a.seconds;
          const sb = b.seconds == null ? Infinity : b.seconds;
          return sa - sb;
        });

      rows.forEach((row, index, arr) => {
        const prev = arr[index - 1];
        row.rank = prev && prev.total === row.total && prev.seconds === row.seconds ? prev.rank : index + 1;
      });

      const winners = rows.filter((r) => r.rank === 1).map((r) => r.teamId);
      return {
        eventId: event.id,
        title: event.title,
        ref: event.ref,
        act: event.act,
        played: rows.length,
        rows,
        winners,
        winnerNames: rows.filter((r) => r.rank === 1).map((r) => r.teamName),
      };
    })
    .filter((entry) => entry.played > 0);
}

function recomputeWins(session) {
  const wins = new Map();
  for (const entry of eventRankings(session)) {
    for (const teamId of entry.winners) wins.set(teamId, (wins.get(teamId) || 0) + 1);
  }
  for (const team of session.teams) team.wins = wins.get(team.id) || 0;
  return session.teams;
}

function leaderboard(session) {
  recomputeWins(session);
  return session.teams
    .map((team) => {
      const totals = teamTotals(team);
      return {
        teamId: team.id,
        name: team.name,
        ...totals,
        wins: team.wins,
        played: team.history.length,
        headcount: team.players.length,
        act1Profile: deck.profileFor(deck.ACT1_PROFILES, totals.act1),
        act2Profile: deck.profileFor(deck.ACT2_PROFILES, totals.act2),
      };
    })
    .sort((a, b) => {
      if (b.total !== a.total) return b.total - a.total;
      if (b.wins !== a.wins) return b.wins - a.wins;
      return a.name.localeCompare(b.name);
    })
    .map((row, index, arr) => {
      const prev = arr[index - 1];
      row.rank = prev && prev.total === row.total && prev.wins === row.wins ? prev.rank : index + 1;
      return row;
    });
}

/** Dévoile les scores à toutes les tables, en même temps. */
function revealScores(session) {
  if (session.revealed) return session;
  session.revealed = true;
  session.revealedAt = Date.now();
  recomputeWins(session);
  addLog(session, 'scores_revealed', {});
  store.persistSessions();
  return session;
}

function finishSession(session) {
  for (const team of session.teams) {
    if (team.round) finishRound(session, team.id);
  }
  session.status = 'finished';
  session.endedAt = Date.now();
  if (!session.revealed) revealScores(session);
  addLog(session, 'session_ended', {});

  const record = buildRecord(session);
  const existing = store.state.records.findIndex((r) => r.sessionId === session.id);
  if (existing >= 0) store.state.records[existing] = record;
  else store.state.records.unshift(record);
  store.state.records = store.state.records.slice(0, 500);
  session.archivedRecordId = record.id;

  store.persistRecords();
  store.persistSessions();
  return record;
}

function reopenSession(session) {
  session.status = session.teams.some((t) => t.history.length) ? 'running' : 'lobby';
  session.endedAt = null;
  addLog(session, 'session_reopened', {});
  store.persistSessions();
  return session;
}

function buildRecord(session) {
  const board = leaderboard(session);
  const rankings = eventRankings(session);
  return {
    id: session.archivedRecordId || id('rec'),
    sessionId: session.id,
    code: session.code,
    name: session.name,
    facilitator: session.facilitator,
    lang: session.lang,
    createdAt: session.createdAt,
    startedAt: session.startedAt,
    endedAt: session.endedAt || Date.now(),
    teamCount: session.teams.length,
    playerCount: session.teams.reduce((sum, t) => sum + t.players.length, 0),
    eventCount: rankings.length,
    winner: board.length ? { name: board[0].name, total: board[0].total } : null,
    leaderboard: board,
    teams: session.teams.map((team) => ({
      name: team.name,
      headcount: team.players.length,
      roster: team.players.map((p) => ({
        name: p.name,
        role: (deck.roleById(p.roleId) || {}).name || null,
      })),
    })),
    events: rankings.map((entry) => ({
      eventId: entry.eventId,
      title: entry.title,
      ref: entry.ref,
      act: entry.act,
      winners: entry.winnerNames,
      results: entry.rows.map((r) => ({
        team: r.teamName,
        rank: r.rank,
        choice: r.decision,
        decidedBy: r.decidedBy,
        tally: r.tally,
        total: r.total,
        short: r.short,
        long: r.long,
        points: r.points,
        seconds: r.seconds,
      })),
    })),
    adjustments: session.teams.flatMap((team) =>
      team.adjustments.map((a) => ({ team: team.name, delta: a.delta, reason: a.reason, ts: a.ts }))
    ),
    log: session.log.slice(-200),
  };
}

/* ------------------------------------------------------------------ state */

function publicEvent(event) {
  return {
    id: event.id,
    act: event.act,
    round: event.round,
    ref: event.ref,
    tag: event.tag,
    color: event.color,
    title: event.title,
    situation: event.situation,
    motif: event.motif,
    impact: event.impact,
    tension: event.tension,
    custom: Boolean(event.custom),
    options: event.options.map((o) => ({
      key: o.key,
      label: o.label,
      short: o.short,
      long: o.long,
      points: o.points,
      reveal: o.reveal,
    })),
  };
}

function publicPlayer(player, { self = false } = {}) {
  const role = deck.roleById(player.roleId);
  return {
    id: player.id,
    name: player.name,
    online: player.sockets > 0,
    self,
    roleId: player.roleId,
    role: role
      ? {
          id: role.id,
          icon: role.icon,
          dg: Boolean(role.dg),
          name: role.name,
          mission: role.mission,
          focus: role.focus,
          quote: role.quote,
          stance: role.stance,
          power: role.power || null,
        }
      : null,
  };
}

/**
 * Manche vue par un public donné. Les votes individuels ne sortent jamais
 * nominativement : on expose qui a voté, jamais pour quoi.
 */
function roundStateFor(session, team, { canSeeScores, playerId }) {
  const round = team.round;
  if (!round) return null;
  const event = getEvent(session, round.eventId);
  const decided = round.status === 'closed';
  const dg = dgPlayer(team);

  return {
    teamId: team.id,
    eventId: round.eventId,
    event: event ? publicEvent(event) : null,
    no: round.no,
    status: round.status,
    startedAt: round.startedAt,
    endsAt: round.endsAt,
    durationSec: round.durationSec,
    pausedAt: round.pausedAt,
    closedAt: round.closedAt,
    closeReason: round.closeReason || null,
    replay: Boolean(round.replay),
    arbitrationEndsAt: round.arbitrationEndsAt,
    tied: round.tied,
    decision: round.decision,
    decidedBy: round.decidedBy,
    tally: decided || round.status === 'arbitration' ? round.tally : null,
    voted: team.players.map((p) => ({ id: p.id, name: p.name, voted: Boolean(round.votes[p.id]) })),
    votedCount: Object.keys(round.votes).length,
    headcount: team.players.length,
    myVote: playerId && round.votes[playerId] ? round.votes[playerId].choice : null,
    dgPlayerId: dg ? dg.id : null,
    dgName: dg ? dg.name : null,
    score: canSeeScores && decided ? optionScore(event, round.decision) : null,
  };
}

function teamProgress(session, team) {
  return {
    played: team.history.length,
    total: session.events.length,
    done: teamDone(session, team),
    current: team.round ? team.round.no : null,
    currentStatus: team.round ? team.round.status : null,
  };
}

function stateFor(session, audience = {}) {
  const role =
    audience.role === 'super' ? 'super' : audience.role === 'teamAdmin' ? 'teamAdmin' : 'player';
  const teamId = audience.teamId || null;
  const playerId = audience.playerId || null;
  const canSeeScores = role === 'super' || session.revealed;

  const base = {
    serverNow: Date.now(),
    role,
    teamId,
    playerId,
    session: {
      id: session.id,
      code: session.code,
      name: session.name,
      facilitator: session.facilitator,
      lang: session.lang,
      status: session.status,
      revealed: session.revealed,
      revealedAt: session.revealedAt,
      createdAt: session.createdAt,
      startedAt: session.startedAt,
      endedAt: session.endedAt,
      settings: session.settings,
      archivedRecordId: session.archivedRecordId,
      eventCount: session.events.length,
      teamCount: session.teams.length,
      playerCount: session.teams.reduce((sum, t) => sum + t.players.length, 0),
      allTeamsDone: allTeamsDone(session),
    },
    narrative: deck.NARRATIVE,
    scoresVisible: canSeeScores,
  };

  if (role === 'super') {
    return {
      ...base,
      events: session.events.map((event) => ({
        ...publicEvent(event),
        playedBy: session.teams.filter((t) => teamPlayed(t, event.id)).length,
      })),
      teams: session.teams.map((team) => {
        const totals = teamTotals(team);
        return {
          id: team.id,
          name: team.name,
          adminCode: team.adminCode,
          headcount: team.players.length,
          online: team.players.filter((p) => p.sockets > 0).length,
          rolesAssigned: Boolean(team.rolesAssignedAt),
          players: team.players.map((p) => publicPlayer(p)),
          progress: teamProgress(session, team),
          round: roundStateFor(session, team, { canSeeScores: true, playerId: null }),
          history: team.history,
          adjustments: team.adjustments,
          ...totals,
          wins: team.wins,
          act1Profile: deck.profileFor(deck.ACT1_PROFILES, totals.act1),
          act2Profile: deck.profileFor(deck.ACT2_PROFILES, totals.act2),
        };
      }),
      leaderboard: leaderboard(session),
      rankings: eventRankings(session),
      roles: deck.ROLES,
      log: session.log.slice(-140),
    };
  }

  const team = teamId ? getTeam(session, teamId) : null;
  if (!team) return { ...base, team: null };

  const totals = teamTotals(team);
  const myTeam = {
    id: team.id,
    name: team.name,
    headcount: team.players.length,
    teamSize: session.settings.teamSize,
    rolesAssigned: Boolean(team.rolesAssignedAt),
    players: team.players.map((p) => publicPlayer(p, { self: p.id === playerId })),
    progress: teamProgress(session, team),
    // Les points restent masqués jusqu'au dévoilement, y compris pour l'animateur d'équipe.
    ...(canSeeScores ? totals : {}),
    ...(canSeeScores ? { wins: team.wins } : {}),
    ...(canSeeScores
      ? {
          act1Profile: deck.profileFor(deck.ACT1_PROFILES, totals.act1),
          act2Profile: deck.profileFor(deck.ACT2_PROFILES, totals.act2),
        }
      : {}),
  };

  const me = playerId ? team.players.find((p) => p.id === playerId) : null;

  return {
    ...base,
    team: myTeam,
    me: me ? publicPlayer(me, { self: true }) : null,
    isDg: Boolean(me && (deck.roleById(me.roleId) || {}).dg),
    round: roundStateFor(session, team, { canSeeScores, playerId }),
    nextEvent: role === 'teamAdmin' ? (nextEventFor(session, team) || null) : null,
    events:
      role === 'teamAdmin'
        ? session.events.map((event) => ({
            id: event.id,
            act: event.act,
            ref: event.ref,
            title: event.title,
            color: event.color,
            played: teamPlayed(team, event.id),
            current: Boolean(team.round && team.round.eventId === event.id),
          }))
        : [],
    history: team.history.map((h) => ({
      eventId: h.eventId,
      title: h.eventTitle,
      ref: h.eventRef,
      act: h.act,
      no: h.no,
      decision: h.decision,
      decidedBy: h.decidedBy,
      tally: h.tally,
      closedAt: h.closedAt,
      ...(canSeeScores ? { short: h.short, long: h.long, points: h.points, total: h.total } : {}),
    })),
    leaderboard: canSeeScores ? leaderboard(session) : [],
    rankings: canSeeScores ? eventRankings(session) : [],
  };
}

module.exports = {
  GameError,
  DEFAULT_SETTINGS,
  MAX_TEAMS,
  MAX_PLAYERS_PER_TEAM,
  MIN_DURATION,
  createSession,
  getSession,
  requireSession,
  findByCode,
  findByTeamCode,
  assertSuper,
  authTeamAdmin,
  authPlayer,
  deleteSession,
  pruneSessions,
  addTeam,
  getTeam,
  requireTeam,
  renameTeam,
  removeTeam,
  regenTeamCode,
  joinPlayer,
  assignRoles,
  renamePlayer,
  removePlayer,
  movePlayer,
  dgPlayer,
  addEvent,
  updateEvent,
  removeEvent,
  moveEvent,
  getEvent,
  nextEventFor,
  teamDone,
  allTeamsDone,
  startRound,
  vote,
  closeRound,
  arbitrate,
  autoArbitrate,
  finishRound,
  cancelRound,
  replayEvent,
  pauseRound,
  resumeRound,
  addTime,
  adjustScore,
  removeAdjustment,
  setDecision,
  updateSettings,
  leaderboard,
  eventRankings,
  revealScores,
  finishSession,
  reopenSession,
  buildRecord,
  stateFor,
  recomputeAllScores,
  addLog,
};
