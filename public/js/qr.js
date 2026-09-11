/* Générateur de QR code — mode octet, correction de niveau M, versions 1 à 10.
 *
 * Écrit ici plutôt qu'importé : la salle n'a pas toujours Internet, et un lien
 * de session part vers un service extérieur si on délègue le rendu. 213 octets
 * utiles suffisent largement pour une URL du type https://…/join/ABC123.
 *
 * Référence : ISO/IEC 18004. La sélection du masque suit les quatre règles de
 * pénalité de la norme.
 */
(function () {
  'use strict';

  /* Par version : [octets de correction par bloc, [[nombre de blocs, octets de
     données par bloc], …]]. Niveau M uniquement. */
  const ECC = [
    [10, [[1, 16]]],
    [16, [[1, 28]]],
    [26, [[1, 44]]],
    [18, [[2, 32]]],
    [24, [[2, 43]]],
    [16, [[4, 27]]],
    [18, [[4, 31]]],
    [22, [[2, 38], [2, 39]]],
    [22, [[3, 36], [2, 37]]],
    [26, [[4, 43], [1, 44]]],
  ];

  /* Centres des motifs d'alignement, par version. */
  const ALIGN = [
    [],
    [6, 18],
    [6, 22],
    [6, 26],
    [6, 30],
    [6, 34],
    [6, 22, 38],
    [6, 24, 42],
    [6, 26, 46],
    [6, 28, 50],
  ];

  const MASKS = [
    (y, x) => (y + x) % 2 === 0,
    (y) => y % 2 === 0,
    (y, x) => x % 3 === 0,
    (y, x) => (y + x) % 3 === 0,
    (y, x) => (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0,
    (y, x) => ((y * x) % 2) + ((y * x) % 3) === 0,
    (y, x) => (((y * x) % 2) + ((y * x) % 3)) % 2 === 0,
    (y, x) => (((y + x) % 2) + ((y * x) % 3)) % 2 === 0,
  ];

  /* ------------------------------------------------------ arithmétique GF(256) */

  const EXP = new Uint8Array(256);
  const LOG = new Uint8Array(256);
  (function buildTables() {
    let x = 1;
    for (let i = 0; i < 255; i++) {
      EXP[i] = x;
      LOG[x] = i;
      x <<= 1;
      if (x & 0x100) x ^= 0x11d;
    }
    EXP[255] = 1;
  })();

  const mul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[(LOG[a] + LOG[b]) % 255]);

  /** Polynôme générateur de Reed-Solomon, coefficient de plus haut degré en tête. */
  function generator(degree) {
    let poly = [1];
    for (let i = 0; i < degree; i++) {
      const next = new Array(poly.length + 1).fill(0);
      for (let j = 0; j < poly.length; j++) {
        next[j] ^= poly[j];
        next[j + 1] ^= mul(poly[j], EXP[i]);
      }
      poly = next;
    }
    return poly;
  }

  /** Reste de la division du bloc de données par le polynôme générateur. */
  function correction(data, length) {
    const gen = generator(length);
    const rem = new Uint8Array(length);
    for (const byte of data) {
      const factor = byte ^ rem[0];
      rem.copyWithin(0, 1);
      rem[length - 1] = 0;
      for (let j = 0; j < length; j++) rem[j] ^= mul(gen[j + 1], factor);
    }
    return rem;
  }

  /* ------------------------------------------------------------- encodage des données */

  const dataCodewords = (version) =>
    ECC[version - 1][1].reduce((sum, [blocks, len]) => sum + blocks * len, 0);

  /* 4 bits de mode + 8 ou 16 bits de longueur, arrondis à l'octet. */
  const capacity = (version) => dataCodewords(version) - (version >= 10 ? 3 : 2);

  function pushBits(value, length, out) {
    for (let i = length - 1; i >= 0; i--) out.push((value >>> i) & 1);
  }

  function encode(text, forcedVersion) {
    const bytes = new TextEncoder().encode(String(text));
    let version = forcedVersion || 0;
    if (!version) {
      for (let v = 1; v <= ECC.length; v++) {
        if (bytes.length <= capacity(v)) {
          version = v;
          break;
        }
      }
    }
    if (!version || bytes.length > capacity(version)) {
      throw new Error(`QR : ${bytes.length} octets, au-delà de la capacité`);
    }

    const bits = [];
    pushBits(0b0100, 4, bits); // mode octet
    pushBits(bytes.length, version >= 10 ? 16 : 8, bits);
    for (const byte of bytes) pushBits(byte, 8, bits);

    const total = dataCodewords(version);
    for (let i = 0; i < 4 && bits.length < total * 8; i++) bits.push(0); // terminateur
    while (bits.length % 8 !== 0) bits.push(0);

    const words = [];
    for (let i = 0; i < bits.length; i += 8) {
      let byte = 0;
      for (let j = 0; j < 8; j++) byte = (byte << 1) | bits[i + j];
      words.push(byte);
    }
    /* Octets de remplissage normalisés, en alternance. */
    for (let pad = 0xec; words.length < total; pad ^= 0xec ^ 0x11) words.push(pad);

    /* Découpage en blocs, correction, puis entrelacement. */
    const [ecLength, groups] = ECC[version - 1];
    const blocks = [];
    let pos = 0;
    for (const [count, length] of groups) {
      for (let i = 0; i < count; i++) {
        const data = words.slice(pos, pos + length);
        pos += length;
        blocks.push({ data, ec: correction(data, ecLength) });
      }
    }
    const codewords = [];
    const longest = Math.max(...blocks.map((b) => b.data.length));
    for (let i = 0; i < longest; i++) {
      for (const block of blocks) if (i < block.data.length) codewords.push(block.data[i]);
    }
    for (let i = 0; i < ecLength; i++) for (const block of blocks) codewords.push(block.ec[i]);

    return { version, codewords };
  }

  /* --------------------------------------------------------------- construction */

  function bchFormat(mask) {
    let data = mask; // niveau M = 00
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    return ((data << 10) | rem) ^ 0x5412;
  }

  function bchVersion(version) {
    let rem = version;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    return (version << 12) | rem;
  }

  function skeleton(version, codewords) {
    const size = version * 4 + 17;
    const modules = [];
    const fixed = [];
    for (let i = 0; i < size; i++) {
      modules.push(new Uint8Array(size));
      fixed.push(new Uint8Array(size));
    }
    const set = (y, x, dark) => {
      if (y < 0 || y >= size || x < 0 || x >= size) return;
      modules[y][x] = dark ? 1 : 0;
      fixed[y][x] = 1;
    };

    /* Motifs de repérage et leurs séparateurs : anneaux concentriques. */
    for (const [y0, x0] of [[0, 0], [0, size - 7], [size - 7, 0]]) {
      for (let dy = -1; dy <= 7; dy++) {
        for (let dx = -1; dx <= 7; dx++) {
          const ring = Math.max(Math.abs(dy - 3), Math.abs(dx - 3));
          set(y0 + dy, x0 + dx, ring <= 1 || ring === 3);
        }
      }
    }

    /* Motifs de synchronisation. */
    for (let i = 0; i < size; i++) {
      if (!fixed[6][i]) set(6, i, i % 2 === 0);
      if (!fixed[i][6]) set(i, 6, i % 2 === 0);
    }

    /* Motifs d'alignement, sauf ceux qui tomberaient sur un motif de repérage. */
    const centers = ALIGN[version - 1];
    for (const cy of centers) {
      for (const cx of centers) {
        const onFinder =
          (cy === 6 && cx === 6) ||
          (cy === 6 && cx === size - 7) ||
          (cy === size - 7 && cx === 6);
        if (onFinder) continue;
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            set(cy + dy, cx + dx, Math.max(Math.abs(dy), Math.abs(dx)) !== 1);
          }
        }
      }
    }

    /* Zones réservées : information de format, de version, module toujours sombre. */
    for (let i = 0; i < 9; i++) {
      if (!fixed[8][i]) set(8, i, false);
      if (!fixed[i][8]) set(i, 8, false);
    }
    for (let i = 0; i < 8; i++) {
      set(8, size - 1 - i, false);
      set(size - 1 - i, 8, false);
    }
    set(size - 8, 8, true);
    if (version >= 7) {
      for (let i = 0; i < 18; i++) {
        set(size - 11 + (i % 3), Math.floor(i / 3), false);
        set(Math.floor(i / 3), size - 11 + (i % 3), false);
      }
    }

    /* Données : colonnes de deux modules, en zigzag, de droite à gauche. */
    const bitCount = codewords.length * 8;
    let bit = 0;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5; // la colonne 6 porte la synchronisation
      for (let vert = 0; vert < size; vert++) {
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          const upward = ((right + 1) & 2) === 0;
          const y = upward ? size - 1 - vert : vert;
          if (fixed[y][x]) continue;
          if (bit < bitCount) {
            modules[y][x] = (codewords[bit >>> 3] >>> (7 - (bit & 7))) & 1;
          }
          bit++;
        }
      }
    }

    return { size, modules, fixed };
  }

  /** Applique un masque sur les modules libres et inscrit les informations de format. */
  function stamp(base, version, mask) {
    const { size, fixed } = base;
    const modules = base.modules.map((row) => Uint8Array.from(row));
    const rule = MASKS[mask];
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (!fixed[y][x] && rule(y, x)) modules[y][x] ^= 1;
      }
    }

    /* Deux copies de l'information de format : colonne 8 puis ligne 8 en haut à
       gauche, ligne 8 à droite et colonne 8 en bas pour la seconde. */
    const format = bchFormat(mask);
    const bitOf = (value, i) => (value >>> i) & 1;
    for (let i = 0; i <= 5; i++) modules[i][8] = bitOf(format, i);
    modules[7][8] = bitOf(format, 6);
    modules[8][8] = bitOf(format, 7);
    modules[8][7] = bitOf(format, 8);
    for (let i = 9; i < 15; i++) modules[8][14 - i] = bitOf(format, i);
    for (let i = 0; i < 8; i++) modules[8][size - 1 - i] = bitOf(format, i);
    for (let i = 8; i < 15; i++) modules[size - 15 + i][8] = bitOf(format, i);
    modules[size - 8][8] = 1;

    if (version >= 7) {
      const info = bchVersion(version);
      for (let i = 0; i < 18; i++) {
        const value = bitOf(info, i);
        modules[size - 11 + (i % 3)][Math.floor(i / 3)] = value;
        modules[Math.floor(i / 3)][size - 11 + (i % 3)] = value;
      }
    }
    return modules;
  }

  /* --------------------------------------------------------------- pénalités */

  function addRun(history, run, size) {
    if (history[0] === 0) run += size; // bordure claire virtuelle avant le premier segment
    history.pop();
    history.unshift(run);
  }

  /** Nombre de motifs 1:1:3:1:1 entourés de blanc trouvés dans l'historique. */
  function countFinderLike(history) {
    const n = history[1];
    const core =
      n > 0 && history[2] === n && history[3] === n * 3 && history[4] === n && history[5] === n;
    return (
      (core && history[0] >= n * 4 && history[6] >= n ? 1 : 0) +
      (core && history[6] >= n * 4 && history[0] >= n ? 1 : 0)
    );
  }

  function closeRun(history, dark, run, size) {
    if (dark) {
      addRun(history, run, size);
      run = 0;
    }
    addRun(history, run + size, size);
    return countFinderLike(history);
  }

  function penalty(modules, size) {
    let score = 0;

    for (let pass = 0; pass < 2; pass++) {
      for (let a = 0; a < size; a++) {
        let dark = false;
        let run = 0;
        const history = [0, 0, 0, 0, 0, 0, 0];
        for (let b = 0; b < size; b++) {
          const value = pass === 0 ? modules[a][b] === 1 : modules[b][a] === 1;
          if (value === dark) {
            run++;
            if (run === 5) score += 3;
            else if (run > 5) score++;
          } else {
            addRun(history, run, size);
            if (!dark) score += countFinderLike(history) * 40;
            dark = value;
            run = 1;
          }
        }
        score += closeRun(history, dark, run, size) * 40;
      }
    }

    for (let y = 0; y < size - 1; y++) {
      for (let x = 0; x < size - 1; x++) {
        const value = modules[y][x];
        if (value === modules[y][x + 1] && value === modules[y + 1][x] && value === modules[y + 1][x + 1]) {
          score += 3;
        }
      }
    }

    let darkCount = 0;
    for (const row of modules) for (const value of row) if (value) darkCount++;
    const total = size * size;
    score += (Math.ceil(Math.abs(darkCount * 20 - total * 10) / total) - 1) * 10;
    return score;
  }

  /* ------------------------------------------------------------------- sortie */

  /** { size, modules } où modules[y][x] vaut 1 pour un module sombre. */
  function matrix(text, opts) {
    const o = opts || {};
    const { version, codewords } = encode(text, o.version);
    const base = skeleton(version, codewords);
    if (o.mask != null) {
      return { version, size: base.size, modules: stamp(base, version, o.mask), mask: o.mask };
    }
    let best = null;
    for (let mask = 0; mask < 8; mask++) {
      const modules = stamp(base, version, mask);
      const score = penalty(modules, base.size);
      if (!best || score < best.score) best = { modules, score, mask };
    }
    return { version, size: base.size, modules: best.modules, mask: best.mask };
  }

  /* Le QR reste noir sur blanc dans les deux thèmes : un code inversé n'est pas
     lu par tous les appareils, et il est aussi souvent imprimé que projeté. */
  function element(text, opts) {
    const o = opts || {};
    const { size, modules } = matrix(text, o);
    const quiet = o.quiet == null ? 3 : o.quiet;
    const side = size + quiet * 2;

    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', `0 0 ${side} ${side}`);
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', '100%');
    svg.setAttribute('shape-rendering', 'crispEdges');
    svg.setAttribute('role', 'img');
    if (o.label) svg.setAttribute('aria-label', o.label);

    const background = document.createElementNS(ns, 'rect');
    background.setAttribute('width', String(side));
    background.setAttribute('height', String(side));
    background.setAttribute('fill', o.light || '#ffffff');
    svg.appendChild(background);

    let path = '';
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (modules[y][x]) path += `M${x + quiet} ${y + quiet}h1v1h-1z`;
      }
    }
    const shape = document.createElementNS(ns, 'path');
    shape.setAttribute('d', path);
    shape.setAttribute('fill', o.dark || '#101014');
    svg.appendChild(shape);
    return svg;
  }

  window.QR = { matrix, element, capacity };
})();
