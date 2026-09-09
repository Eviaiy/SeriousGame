'use strict';

const crypto = require('crypto');
const store = require('./store');
const deck = require('./deck');

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_TEAMS = 24;
const MAX_EVENTS = 60;
const DEFAULT_DURATION = 120;
const MIN_DURATION = 5;

const DEFAULT_SETTINGS = {
  defaultDuration: DEFAULT_DURATION,
  autoReveal: true,
  autoCloseOnAllAnswers: false,
  allowChangeBeforeDeadline: false,
  allowLateJoin: true,
  showLeaderboardToTeams: true,
  noAnswerPenalty: 0,
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

class GameError extends Error {
  constructor(code, message) {
    super(message || code);
    this.code = code;
  }
}

/* --------------------------------------------------------------- sessions */

function createSession({ name, lang, facilitator } = {}) {
  let code = newCode();
  let guard = 0;
  while (findByCode(code) && guard < 50) {
    code = newCode();
    guard += 1;
  }

  const session = {
    id: id('sess'),
    code,
    adminKey: token(),
    name: cleanText(name, 80) || 'Serious Game — Facturation électronique',
    facilitator: cleanText(facilitator, 60),
    lang: lang === 'en' ? 'en' : 'fr',
    status: 'lobby',
    createdAt: Date.now(),
    startedAt: null,
    endedAt: null,
    settings: { ...DEFAULT_SETTINGS },
    teams: [],
    events: deck.cloneDefaultEvents(),
    round: null,
    history: [],
    log: [],
    archivedRecordId: null,
  };

  addLog(session, 'session_created', { name: session.name });
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

function requireSession(sessionId) {
  const session = getSession(sessionId);
  if (!session) throw new GameError('session_not_found', 'Session introuvable');
  return session;
}

function assertAdmin(session, adminKey) {
  if (!adminKey || adminKey !== session.adminKey) {
    throw new GameError('forbidden', 'Clé animateur invalide');
  }
}

function deleteSession(session) {
  delete store.state.sessions[session.id];
  store.persistSessions();
}

/** Supprime les sessions terminées ou inactives depuis plus de 30 jours. */
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
  if (session.log.length > 500) session.log.splice(0, session.log.length - 500);
}

/* ------------------------------------------------------------------ teams */

function addTeam(session, name) {
  if (session.status === 'finished') throw new GameError('session_finished', 'Session terminée');
  if (!session.settings.allowLateJoin && session.status === 'running') {
    throw new GameError('join_closed', 'Les inscriptions sont fermées');
  }
  if (session.teams.length >= MAX_TEAMS) throw new GameError('too_many_teams', 'Trop d’équipes');

  const clean = cleanText(name, 40);
  if (clean.length < 2) throw new GameError('bad_name', 'Nom d’équipe trop court');
  const exists = session.teams.some((t) => t.name.toLowerCase() === clean.toLowerCase());
  if (exists) throw new GameError('name_taken', 'Ce nom d’équipe est déjà pris');

  const team = {
    id: id('team'),
    token: token(),
    name: clean,
    createdAt: Date.now(),
    sockets: 0,
    answers: {},
    adjustments: [],
    short: 0,
    long: 0,
    points: 0,
    adjust: 0,
    wins: 0,
  };
  session.teams.push(team);
  addLog(session, 'team_joined', { team: team.name });
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

function authTeam(session, teamId, teamToken) {
  const team = getTeam(session, teamId);
  if (!team || team.token !== teamToken) throw new GameError('forbidden', 'Accès équipe invalide');
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
  session.teams = session.teams.filter((t) => t.id !== teamId);
  if (session.round && session.round.submissions[teamId]) {
    delete session.round.submissions[teamId];
    if (session.round.status === 'closed') computeRoundResults(session);
  }
  addLog(session, 'team_removed', { team: team.name });
  store.persistSessions();
  return team;
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
    return {
      short: null,
      long: null,
      points: clamp(toInt(opt.points, 0), -50, 50),
    };
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
  const fallbackOptions = existing ? existing.options : [];
  const rawOptions = source || fallbackOptions;

  const options = ['A', 'B', 'C']
    .map((key) => {
      const raw = rawOptions.find((o) => o && o.key === key) || {};
      const scores = normalizeOptionScores(act, {
        short: raw.short != null ? raw.short : act === 1 ? deck.ACT1_MATRIX[key].short : 0,
        long: raw.long != null ? raw.long : act === 1 ? deck.ACT1_MATRIX[key].long : 0,
        points: raw.points != null ? raw.points : deck.ACT2_MATRIX[key],
      });
      return {
        key,
        label: bilingual(raw.label, key),
        ...scores,
        reveal: raw.reveal ? bilingual(raw.reveal) : null,
      };
    })
    .filter(Boolean);

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
  const index = session.events.findIndex((e) => e.id === eventId);
  session.events[index] = updated;
  if (session.round && session.round.eventId === eventId && session.round.status === 'closed') {
    computeRoundResults(session);
  }
  recomputeAllScores(session);
  addLog(session, 'event_updated', { event: updated.title.fr });
  store.persistSessions();
  return updated;
}

function removeEvent(session, eventId) {
  const event = requireEvent(session, eventId);
  if (session.round && session.round.eventId === eventId) {
    throw new GameError('event_in_play', 'Événement en cours');
  }
  session.events = session.events.filter((e) => e.id !== eventId);
  for (const team of session.teams) delete team.answers[eventId];
  session.history = session.history.filter((h) => h.eventId !== eventId);
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

function eventPlayed(session, eventId) {
  return session.history.some((h) => h.eventId === eventId);
}

/* ------------------------------------------------------------------ round */

function startRound(session, eventId, durationSec) {
  const event = requireEvent(session, eventId);
  if (session.status === 'finished') throw new GameError('session_finished', 'Session terminée');
  if (session.round && session.round.status === 'open') {
    throw new GameError('round_open', 'Un événement est déjà en cours');
  }
  if (!session.teams.length) throw new GameError('no_teams', 'Aucune équipe inscrite');

  const duration = clamp(toInt(durationSec, session.settings.defaultDuration), MIN_DURATION, 3600);
  const now = Date.now();

  session.status = 'running';
  if (!session.startedAt) session.startedAt = now;

  session.round = {
    eventId: event.id,
    no: session.history.length + 1,
    startedAt: now,
    durationSec: duration,
    endsAt: now + duration * 1000,
    pausedAt: null,
    closedAt: null,
    status: 'open',
    revealed: false,
    submissions: {},
    results: null,
    winners: [],
    replay: eventPlayed(session, event.id),
  };

  addLog(session, 'round_started', {
    event: event.title.fr,
    eventEn: event.title.en,
    seconds: duration,
  });
  store.persistSessions();
  return session.round;
}

function requireOpenRound(session) {
  if (!session.round || session.round.status !== 'open') {
    throw new GameError('no_open_round', 'Aucun événement ouvert');
  }
  return session.round;
}

function pauseRound(session) {
  const round = requireOpenRound(session);
  if (round.pausedAt) return round;
  round.pausedAt = Date.now();
  addLog(session, 'round_paused', {});
  store.persistSessions();
  return round;
}

function resumeRound(session) {
  const round = requireOpenRound(session);
  if (!round.pausedAt) return round;
  const paused = Date.now() - round.pausedAt;
  round.endsAt += paused;
  round.pausedAt = null;
  addLog(session, 'round_resumed', {});
  store.persistSessions();
  return round;
}

function addTime(session, seconds) {
  const round = requireOpenRound(session);
  const delta = clamp(toInt(seconds, 0), -3600, 3600);
  round.endsAt = Math.max(Date.now() + 3000, round.endsAt + delta * 1000);
  round.durationSec = Math.max(MIN_DURATION, Math.round((round.endsAt - round.startedAt) / 1000));
  addLog(session, 'round_time_changed', { seconds: delta });
  store.persistSessions();
  return round;
}

function submit(session, teamId, choice) {
  const round = requireOpenRound(session);
  if (round.pausedAt) throw new GameError('round_paused', 'Événement en pause');
  const team = requireTeam(session, teamId);
  const event = requireEvent(session, round.eventId);
  const key = String(choice || '').toUpperCase();
  if (!event.options.some((o) => o.key === key)) throw new GameError('bad_choice', 'Choix invalide');

  const existing = round.submissions[teamId];
  if (existing && !session.settings.allowChangeBeforeDeadline) {
    throw new GameError('already_submitted', 'Réponse déjà enregistrée');
  }
  if (Date.now() > round.endsAt) throw new GameError('time_up', 'Temps écoulé');

  const at = Date.now();
  round.submissions[teamId] = {
    choice: key,
    at,
    ms: Math.max(0, at - round.startedAt),
    changed: Boolean(existing),
  };
  addLog(session, 'team_submitted', { team: team.name, choice: key });

  let closed = false;
  if (
    session.settings.autoCloseOnAllAnswers &&
    session.teams.length > 0 &&
    session.teams.every((t) => round.submissions[t.id])
  ) {
    closeRound(session, 'all_answered');
    closed = true;
  }
  store.persistSessions();
  return { submission: round.submissions[teamId], closed };
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

/** Recalcule le classement de l'événement courant à partir des réponses. */
function computeRoundResults(session) {
  const round = session.round;
  if (!round) return null;
  const event = requireEvent(session, round.eventId);
  const penalty = clamp(toInt(session.settings.noAnswerPenalty, 0), -20, 0);

  const results = session.teams.map((team) => {
    const sub = round.submissions[team.id];
    if (!sub) {
      return {
        teamId: team.id,
        teamName: team.name,
        choice: null,
        ms: null,
        short: event.act === 1 ? penalty : 0,
        long: 0,
        points: event.act === 2 ? penalty : 0,
        total: penalty,
        answered: false,
      };
    }
    const score = optionScore(event, sub.choice);
    return {
      teamId: team.id,
      teamName: team.name,
      choice: sub.choice,
      ms: sub.ms,
      short: score.short,
      long: score.long,
      points: score.points,
      total: score.total,
      answered: true,
    };
  });

  const answered = results.filter((r) => r.answered);
  let winners = [];
  if (answered.length) {
    const best = Math.max(...answered.map((r) => r.total));
    const tied = answered.filter((r) => r.total === best);
    const fastest = Math.min(...tied.map((r) => r.ms));
    winners = tied.filter((r) => r.ms === fastest).map((r) => r.teamId);
  }

  results.sort((a, b) => {
    if (b.total !== a.total) return b.total - a.total;
    if (a.answered !== b.answered) return a.answered ? -1 : 1;
    return (a.ms == null ? Infinity : a.ms) - (b.ms == null ? Infinity : b.ms);
  });

  round.results = results;
  round.winners = winners;
  return results;
}

function closeRound(session, reason = 'manual') {
  const round = session.round;
  if (!round) throw new GameError('no_round', 'Aucun événement');
  if (round.status === 'closed') return round;

  round.status = 'closed';
  round.closedAt = Date.now();
  round.pausedAt = null;
  round.closeReason = reason;
  computeRoundResults(session);

  const event = requireEvent(session, round.eventId);
  for (const team of session.teams) {
    const result = round.results.find((r) => r.teamId === team.id);
    if (!result) continue;
    team.answers[event.id] = {
      eventId: event.id,
      act: event.act,
      choice: result.choice,
      ms: result.ms,
      short: result.short,
      long: result.long,
      points: result.points,
      total: result.total,
      answeredAt: result.answered ? round.submissions[team.id].at : null,
      roundNo: round.no,
    };
  }
  recomputeAllScores(session);

  if (session.settings.autoReveal) {
    round.revealed = true;
    applyWins(session, round);
  }

  addLog(session, 'round_closed', {
    event: event.title.fr,
    eventEn: event.title.en,
    reason,
    winners: round.winners.map((wid) => {
      const t = getTeam(session, wid);
      return t ? t.name : wid;
    }),
  });
  store.persistSessions();
  return round;
}

function applyWins(session, round) {
  if (round.winsApplied) return;
  round.winsApplied = true;
  for (const teamId of round.winners) {
    const team = getTeam(session, teamId);
    if (team) team.wins += 1;
  }
}

function revealRound(session) {
  const round = session.round;
  if (!round) throw new GameError('no_round', 'Aucun événement');
  if (round.status === 'open') closeRound(session, 'manual');
  round.revealed = true;
  applyWins(session, round);
  addLog(session, 'round_revealed', {});
  store.persistSessions();
  return round;
}

/** Archive l'événement courant et libère la table pour le suivant. */
function finishRound(session) {
  const round = session.round;
  if (!round) return null;
  if (round.status === 'open') closeRound(session, 'manual');
  if (!round.revealed) {
    round.revealed = true;
    applyWins(session, round);
  }

  const event = getEvent(session, round.eventId);
  const entry = {
    eventId: round.eventId,
    eventTitle: event ? event.title : { fr: '?', en: '?' },
    eventRef: event ? event.ref : { fr: '', en: '' },
    act: event ? event.act : 1,
    no: round.no,
    startedAt: round.startedAt,
    closedAt: round.closedAt,
    durationSec: round.durationSec,
    results: round.results || [],
    winners: round.winners || [],
  };
  session.history = session.history.filter((h) => h.eventId !== round.eventId);
  session.history.push(entry);
  session.history.sort((a, b) => a.startedAt - b.startedAt);
  session.round = null;
  addLog(session, 'round_archived', { event: entry.eventTitle.fr, eventEn: entry.eventTitle.en });
  store.persistSessions();
  return entry;
}

/** Annule l'événement courant sans conserver les points. */
function cancelRound(session) {
  const round = session.round;
  if (!round) return null;
  const event = getEvent(session, round.eventId);
  for (const team of session.teams) delete team.answers[round.eventId];
  if (round.winsApplied) {
    for (const teamId of round.winners) {
      const team = getTeam(session, teamId);
      if (team) team.wins = Math.max(0, team.wins - 1);
    }
  }
  session.round = null;
  recomputeAllScores(session);
  addLog(session, 'round_cancelled', { event: event ? event.title.fr : '?' });
  store.persistSessions();
  return true;
}

/** Rejoue un événement déjà archivé : on retire son score puis on le relance. */
function replayEvent(session, eventId, durationSec) {
  requireEvent(session, eventId);
  if (session.round) finishRound(session);
  session.history = session.history.filter((h) => h.eventId !== eventId);
  for (const team of session.teams) delete team.answers[eventId];
  recomputeAllScores(session);
  return startRound(session, eventId, durationSec);
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
  const entry = {
    id: id('adj'),
    delta: value,
    reason: cleanText(reason, 120),
    ts: Date.now(),
  };
  team.adjustments.push(entry);
  recomputeTeamScore(team);
  addLog(session, 'score_adjusted', {
    team: team.name,
    delta: value,
    reason: entry.reason,
  });
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

/** L'animateur corrige la réponse d'une équipe (saisie papier, erreur de clic...). */
function setAnswer(session, teamId, eventId, choice) {
  const team = requireTeam(session, teamId);
  const event = requireEvent(session, eventId);
  const key = choice ? String(choice).toUpperCase() : null;

  if (!key) {
    delete team.answers[eventId];
  } else {
    if (!event.options.some((o) => o.key === key)) throw new GameError('bad_choice', 'Choix invalide');
    const score = optionScore(event, key);
    const previous = team.answers[eventId];
    team.answers[eventId] = {
      eventId,
      act: event.act,
      choice: key,
      ms: previous ? previous.ms : null,
      short: score.short,
      long: score.long,
      points: score.points,
      total: score.total,
      answeredAt: previous ? previous.answeredAt : Date.now(),
      roundNo: previous ? previous.roundNo : null,
      overridden: true,
    };
  }

  if (session.round && session.round.eventId === eventId) {
    if (key) {
      session.round.submissions[teamId] = {
        choice: key,
        at: Date.now(),
        ms: session.round.submissions[teamId] ? session.round.submissions[teamId].ms : null,
        byAdmin: true,
      };
    } else {
      delete session.round.submissions[teamId];
    }
    if (session.round.status === 'closed') computeRoundResults(session);
  }

  const historyEntry = session.history.find((h) => h.eventId === eventId);
  if (historyEntry) {
    const row = historyEntry.results.find((r) => r.teamId === teamId);
    const answer = team.answers[eventId];
    if (row) {
      row.choice = answer ? answer.choice : null;
      row.short = answer ? answer.short : 0;
      row.long = answer ? answer.long : 0;
      row.points = answer ? answer.points : 0;
      row.total = answer ? answer.total : 0;
      row.answered = Boolean(answer);
    }
  }

  recomputeTeamScore(team);
  addLog(session, 'answer_overridden', {
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
  for (const key of [
    'autoReveal',
    'autoCloseOnAllAnswers',
    'allowChangeBeforeDeadline',
    'allowLateJoin',
    'showLeaderboardToTeams',
  ]) {
    if (patch[key] !== undefined) s[key] = Boolean(patch[key]);
  }
  if (patch.noAnswerPenalty !== undefined) {
    s.noAnswerPenalty = clamp(toInt(patch.noAnswerPenalty, 0), -20, 0);
  }
  if (patch.lang === 'fr' || patch.lang === 'en') session.lang = patch.lang;
  if (patch.name !== undefined) session.name = cleanText(patch.name, 80) || session.name;
  addLog(session, 'settings_updated', {});
  store.persistSessions();
  return session.settings;
}

/* ------------------------------------------------------- classement final */

function leaderboard(session) {
  return session.teams
    .map((team) => {
      const totals = teamTotals(team);
      return {
        teamId: team.id,
        name: team.name,
        ...totals,
        wins: team.wins,
        answered: Object.keys(team.answers).length,
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
      const previous = arr[index - 1];
      const rank =
        previous && previous.total === row.total && previous.wins === row.wins
          ? previous.rank
          : index + 1;
      row.rank = rank;
      return row;
    });
}

function finishSession(session) {
  if (session.round) finishRound(session);
  session.status = 'finished';
  session.endedAt = Date.now();
  addLog(session, 'session_ended', {});

  const record = buildRecord(session);
  const existingIndex = store.state.records.findIndex((r) => r.sessionId === session.id);
  if (existingIndex >= 0) store.state.records[existingIndex] = record;
  else store.state.records.unshift(record);
  store.state.records = store.state.records.slice(0, 500);
  session.archivedRecordId = record.id;

  store.persistRecords();
  store.persistSessions();
  return record;
}

function reopenSession(session) {
  session.status = session.history.length ? 'running' : 'lobby';
  session.endedAt = null;
  addLog(session, 'session_reopened', {});
  store.persistSessions();
  return session;
}

function buildRecord(session) {
  const board = leaderboard(session);
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
    eventCount: session.history.length,
    winner: board.length ? { name: board[0].name, total: board[0].total } : null,
    leaderboard: board,
    events: session.history.map((entry) => ({
      eventId: entry.eventId,
      title: entry.eventTitle,
      ref: entry.eventRef,
      act: entry.act,
      no: entry.no,
      startedAt: entry.startedAt,
      closedAt: entry.closedAt,
      durationSec: entry.durationSec,
      winners: entry.winners.map((wid) => {
        const t = session.teams.find((x) => x.id === wid);
        return t ? t.name : wid;
      }),
      results: entry.results.map((r) => ({
        team: r.teamName,
        choice: r.choice,
        total: r.total,
        short: r.short,
        long: r.long,
        points: r.points,
        seconds: r.ms == null ? null : Math.round(r.ms / 100) / 10,
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

function roundState(session, { role, teamId }) {
  const round = session.round;
  if (!round) return null;
  const event = getEvent(session, round.eventId);
  const revealed = Boolean(round.revealed);
  const isAdmin = role === 'admin';

  const answered = session.teams.map((t) => ({
    teamId: t.id,
    name: t.name,
    answered: Boolean(round.submissions[t.id]),
    choice: isAdmin || revealed ? (round.submissions[t.id] || {}).choice || null : null,
    seconds:
      (isAdmin || revealed) && round.submissions[t.id] && round.submissions[t.id].ms != null
        ? Math.round(round.submissions[t.id].ms / 100) / 10
        : null,
  }));

  return {
    eventId: round.eventId,
    event: event ? publicEvent(event) : null,
    no: round.no,
    status: round.status,
    revealed,
    startedAt: round.startedAt,
    endsAt: round.endsAt,
    durationSec: round.durationSec,
    pausedAt: round.pausedAt,
    closedAt: round.closedAt,
    closeReason: round.closeReason || null,
    replay: Boolean(round.replay),
    answeredCount: Object.keys(round.submissions).length,
    teamCount: session.teams.length,
    answers: answered,
    myChoice: teamId && round.submissions[teamId] ? round.submissions[teamId].choice : null,
    results: revealed || isAdmin ? round.results : null,
    winners: revealed || isAdmin ? round.winners : [],
    winnerNames: (revealed || isAdmin ? round.winners : []).map((wid) => {
      const t = getTeam(session, wid);
      return t ? t.name : wid;
    }),
  };
}

function stateFor(session, audience = {}) {
  const role = audience.role === 'admin' ? 'admin' : 'team';
  const teamId = audience.teamId || null;
  const board = leaderboard(session);
  const showBoard = role === 'admin' || session.settings.showLeaderboardToTeams;

  return {
    serverNow: Date.now(),
    role,
    teamId,
    session: {
      id: session.id,
      code: session.code,
      name: session.name,
      facilitator: session.facilitator,
      lang: session.lang,
      status: session.status,
      createdAt: session.createdAt,
      startedAt: session.startedAt,
      endedAt: session.endedAt,
      settings: session.settings,
      archivedRecordId: session.archivedRecordId,
    },
    events: session.events.map((event) => ({
      ...publicEvent(event),
      played: eventPlayed(session, event.id),
      current: Boolean(session.round && session.round.eventId === event.id),
    })),
    teams: session.teams.map((team) => {
      const totals = teamTotals(team);
      return {
        id: team.id,
        name: team.name,
        online: team.sockets > 0,
        wins: team.wins,
        ...totals,
        answers: role === 'admin' || team.id === teamId ? team.answers : undefined,
        adjustments: role === 'admin' || team.id === teamId ? team.adjustments : undefined,
        act1Profile: deck.profileFor(deck.ACT1_PROFILES, totals.act1),
        act2Profile: deck.profileFor(deck.ACT2_PROFILES, totals.act2),
      };
    }),
    leaderboard: showBoard ? board : board.filter((row) => row.teamId === teamId),
    leaderboardHidden: !showBoard,
    round: roundState(session, { role, teamId }),
    history: session.history.map((h) => ({
      eventId: h.eventId,
      title: h.eventTitle,
      ref: h.eventRef,
      act: h.act,
      no: h.no,
      startedAt: h.startedAt,
      closedAt: h.closedAt,
      winners: h.winners,
      winnerNames: h.winners.map((wid) => {
        const t = getTeam(session, wid);
        return t ? t.name : wid;
      }),
      results:
        role === 'admin' || session.settings.showLeaderboardToTeams
          ? h.results
          : h.results.filter((r) => r.teamId === teamId),
    })),
    roles: deck.ROLES,
    log: role === 'admin' ? session.log.slice(-120) : [],
  };
}

module.exports = {
  GameError,
  DEFAULT_SETTINGS,
  MAX_TEAMS,
  MIN_DURATION,
  createSession,
  getSession,
  requireSession,
  findByCode,
  assertAdmin,
  deleteSession,
  pruneSessions,
  addTeam,
  getTeam,
  requireTeam,
  authTeam,
  renameTeam,
  removeTeam,
  addEvent,
  updateEvent,
  removeEvent,
  moveEvent,
  getEvent,
  startRound,
  submit,
  closeRound,
  revealRound,
  finishRound,
  cancelRound,
  replayEvent,
  pauseRound,
  resumeRound,
  addTime,
  adjustScore,
  removeAdjustment,
  setAnswer,
  updateSettings,
  leaderboard,
  finishSession,
  reopenSession,
  buildRecord,
  stateFor,
  recomputeAllScores,
  addLog,
};
