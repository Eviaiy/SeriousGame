'use strict';

const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, '..', 'data');

const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');
const RECORDS_FILE = path.join(DATA_DIR, 'records.json');

const state = {
  sessions: {},
  records: [],
};

const pendingWrites = new Map();
/* Passe à false si le dossier de données n'est pas accessible en écriture :
   le jeu continue en mémoire au lieu de refuser de démarrer. */
let writable = true;

function ensureDir() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    return true;
  } catch (err) {
    if (writable) {
      console.warn(`[store] ${DATA_DIR} inaccessible en écriture (${err.message}) — état en mémoire seulement.`);
    }
    writable = false;
    return false;
  }
}

function readJson(file, fallback) {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed;
  } catch (err) {
    // Dossier inutilisable : déjà signalé par ensureDir, inutile d'alerter deux fois.
    if (err.code !== 'ENOENT' && writable) {
      console.warn(`[store] impossible de lire ${path.basename(file)} : ${err.message}`);
      backupCorrupt(file);
    }
    return fallback;
  }
}

function backupCorrupt(file) {
  try {
    if (fs.existsSync(file)) {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      fs.renameSync(file, `${file}.corrupt-${stamp}`);
    }
  } catch (err) {
    console.warn(`[store] sauvegarde du fichier corrompu impossible : ${err.message}`);
  }
}

/** Écriture atomique : fichier temporaire puis rename. */
function writeJsonNow(file, value) {
  if (!ensureDir()) return;
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

/** Écriture regroupée : au plus une écriture disque toutes les 250 ms par fichier. */
function scheduleWrite(file, getValue) {
  if (pendingWrites.has(file)) return;
  const timer = setTimeout(() => {
    pendingWrites.delete(file);
    try {
      writeJsonNow(file, getValue());
    } catch (err) {
      console.error(`[store] échec d'écriture ${path.basename(file)} : ${err.message}`);
    }
  }, 250);
  if (timer.unref) timer.unref();
  pendingWrites.set(file, timer);
}

function load() {
  ensureDir();
  const sessions = readJson(SESSIONS_FILE, { sessions: {} });
  const records = readJson(RECORDS_FILE, { records: [] });
  state.sessions = (sessions && sessions.sessions) || {};
  state.records = (records && records.records) || [];
  return state;
}

function persistSessions() {
  scheduleWrite(SESSIONS_FILE, () => ({ savedAt: Date.now(), sessions: state.sessions }));
}

function persistRecords() {
  scheduleWrite(RECORDS_FILE, () => ({ savedAt: Date.now(), records: state.records }));
}

function flush() {
  for (const [file, timer] of pendingWrites) {
    clearTimeout(timer);
    pendingWrites.delete(file);
    try {
      if (file === SESSIONS_FILE) writeJsonNow(file, { savedAt: Date.now(), sessions: state.sessions });
      if (file === RECORDS_FILE) writeJsonNow(file, { savedAt: Date.now(), records: state.records });
    } catch (err) {
      console.error(`[store] échec d'écriture ${path.basename(file)} : ${err.message}`);
    }
  }
}

module.exports = {
  DATA_DIR,
  state,
  load,
  persistSessions,
  persistRecords,
  flush,
  get writable() {
    return writable;
  },
};
