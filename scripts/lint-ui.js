#!/usr/bin/env node
/**
 * Vérifications statiques du front : parité des dictionnaires FR/EN, clés i18n
 * réellement définies, et identifiants DOM utilisés par le JS présents dans la
 * page correspondante. Complète `npm run smoke`, qui couvre le serveur.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const PUB = path.join(ROOT, 'public');
const problems = [];
const fail = (msg) => problems.push(msg);

/* ---------- dictionnaires ---------- */

const sandbox = { window: {}, document: { documentElement: {}, querySelectorAll: () => [] }, localStorage: null };
sandbox.window.localStorage = null;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(PUB, 'js/i18n.js'), 'utf8'), sandbox, { filename: 'i18n.js' });
const I18N = sandbox.window.I18N;
if (!I18N || !I18N.DICT) throw new Error('i18n.js n’expose pas window.I18N.DICT');

const fr = I18N.DICT.fr;
const en = I18N.DICT.en;
const frKeys = Object.keys(fr).sort();
const enKeys = Object.keys(en).sort();

for (const k of frKeys) if (!(k in en)) fail(`clé EN manquante : ${k}`);
for (const k of enKeys) if (!(k in fr)) fail(`clé FR manquante : ${k}`);
for (const k of frKeys) {
  if (typeof fr[k] !== 'string' || !fr[k].trim()) fail(`valeur FR vide : ${k}`);
  if (k in en && (typeof en[k] !== 'string' || !en[k].trim())) fail(`valeur EN vide : ${k}`);
}

/* ---------- clés utilisées ---------- */

const jsFiles = fs.readdirSync(path.join(PUB, 'js')).filter((f) => f.endsWith('.js'));
const htmlFiles = fs.readdirSync(PUB).filter((f) => f.endsWith('.html'));
const used = new Set();

for (const f of jsFiles) {
  const src = fs.readFileSync(path.join(PUB, 'js', f), 'utf8');
  for (const m of src.matchAll(/\bt\(\s*'([a-zA-Z0-9_.]+)'/g)) used.add(m[1]);
  for (const m of src.matchAll(/I18N\.t\(\s*'([a-zA-Z0-9_.]+)'/g)) used.add(m[1]);
}
for (const f of htmlFiles) {
  const src = fs.readFileSync(path.join(PUB, f), 'utf8');
  for (const m of src.matchAll(/data-i18n(?:-placeholder|-title)?="([a-zA-Z0-9_.]+)"/g)) used.add(m[1]);
}

// Clés construites dynamiquement (log.*, flash.*, err.*, profils, choix) :
// on ne les résout pas ici, elles sont validées par le smoke test.
const dynamicPrefixes = ['log.', 'flash.', 'err.', 'profile.', 'act.'];
for (const key of [...used].sort()) {
  if (dynamicPrefixes.some((p) => key.startsWith(p))) continue;
  if (!(key in fr)) fail(`clé i18n utilisée mais absente du dictionnaire : ${key}`);
}

/* ---------- identifiants DOM ---------- */

const pageOfScript = {
  'home.js': 'index.html',
  'admin.js': 'admin.html',
  'play.js': 'play.html',
  'records.js': 'records.html',
};

for (const [script, page] of Object.entries(pageOfScript)) {
  const js = fs.readFileSync(path.join(PUB, 'js', script), 'utf8');
  const html = fs.readFileSync(path.join(PUB, page), 'utf8');
  const shared = fs.readFileSync(path.join(PUB, 'js/common.js'), 'utf8');
  const ids = new Set();
  for (const m of js.matchAll(/\$\(\s*'#([a-zA-Z0-9_-]+)'/g)) ids.add(m[1]);
  for (const m of js.matchAll(/getElementById\(\s*'([a-zA-Z0-9_-]+)'/g)) ids.add(m[1]);
  for (const id of [...ids].sort()) {
    if (!html.includes(`id="${id}"`) && !shared.includes(`id="${id}"`) && !js.includes(`id: '${id}'`)) {
      fail(`${script} cible #${id}, absent de ${page}`);
    }
  }
}

/* ---------- scripts et styles référencés ---------- */

for (const f of htmlFiles) {
  const src = fs.readFileSync(path.join(PUB, f), 'utf8');
  for (const m of src.matchAll(/(?:src|href)="(?!http|#|mailto)([^"]+)"/g)) {
    const rel = m[1].replace(/^\//, '');
    if (rel.endsWith('.html')) continue;
    if (rel.startsWith('socket.io/')) continue; // servi par Socket.IO, pas un fichier statique
    if (!fs.existsSync(path.join(PUB, rel))) fail(`${f} référence ${m[1]}, fichier introuvable`);
  }
}

/* ---------- rapport ---------- */

if (problems.length) {
  console.error('\n✗ ' + problems.length + ' problème(s) :');
  for (const p of problems) console.error('  - ' + p);
  process.exit(1);
}
console.log(
  `✓ front vérifié : ${frKeys.length} clés FR / ${enKeys.length} EN, ${used.size} clés utilisées, ` +
    `${htmlFiles.length} pages, ${jsFiles.length} scripts.`
);
