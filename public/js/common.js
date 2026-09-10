/* Utilitaires partagés : DOM, stockage local, API REST, socket, toasts, chrono. */
(function () {
  'use strict';

  const { t, L, errorText } = window.I18N;

  /* -------------------------------------------------------------------- DOM */

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  function h(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const [key, value] of Object.entries(attrs)) {
        if (value === null || value === undefined || value === false) continue;
        if (key === 'class') node.className = value;
        else if (key === 'text') node.textContent = value;
        else if (key === 'html') node.innerHTML = value;
        else if (key === 'dataset') Object.assign(node.dataset, value);
        else if (key.startsWith('on') && typeof value === 'function') {
          node.addEventListener(key.slice(2).toLowerCase(), value);
        } else node.setAttribute(key, value === true ? '' : value);
      }
    }
    for (const child of [].concat(children || [])) {
      if (child === null || child === undefined || child === false) continue;
      node.appendChild(typeof child === 'object' ? child : document.createTextNode(String(child)));
    }
    return node;
  }

  /* createElement ne suffit pas pour du SVG : sans le namespace, le navigateur
     crée un élément HTML inconnu et ne dessine rien. */
  function svg(tag, attrs, children) {
    const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
    if (attrs) {
      for (const [key, value] of Object.entries(attrs)) {
        if (value === null || value === undefined || value === false) continue;
        node.setAttribute(key, value === true ? '' : value);
      }
    }
    for (const child of [].concat(children || [])) {
      if (child === null || child === undefined || child === false) continue;
      node.appendChild(child);
    }
    return node;
  }

  function clear(node) {
    while (node && node.firstChild) node.removeChild(node.firstChild);
    return node;
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    })[c]);
  }

  /* ---------------------------------------------------------------- formats */

  function fmtSigned(n) {
    const value = Number(n) || 0;
    return value > 0 ? `+${value}` : String(value);
  }

  function signClass(n) {
    const value = Number(n) || 0;
    if (value > 0) return 'pos';
    if (value < 0) return 'neg';
    return '';
  }

  function fmtClock(ms) {
    const total = Math.max(0, Math.ceil(ms / 1000));
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  function fmtDateTime(ts) {
    if (!ts) return '—';
    const locale = window.I18N.getLang() === 'en' ? 'en-GB' : 'fr-FR';
    return new Date(ts).toLocaleString(locale, {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  function fmtTimeOnly(ts) {
    if (!ts) return '';
    const locale = window.I18N.getLang() === 'en' ? 'en-GB' : 'fr-FR';
    return new Date(ts).toLocaleTimeString(locale, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  }

  function fmtDuration(ms) {
    if (!ms || ms < 0) return '—';
    const min = Math.round(ms / 60000);
    if (min < 1) return '< 1 min';
    if (min < 60) return `${min} min`;
    return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`;
  }

  /* ----------------------------------------------------------- stockage web */

  const LS = {
    get(key, fallback) {
      try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
      } catch (err) {
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch (err) {
        /* quota ou navigation privée */
      }
    },
    del(key) {
      try {
        localStorage.removeItem(key);
      } catch (err) {
        /* ignore */
      }
    },
  };

  /**
   * Trois accès mémorisés séparément : direction de jeu, animateur de table,
   * joueur. Un même navigateur peut porter les trois (poste de démonstration).
   */
  function makeStore(lsKey, idField) {
    const store = {
      all() {
        const list = LS.get(lsKey, []);
        return Array.isArray(list) ? list : [];
      },
      save(entry) {
        const list = store.all().filter((s) => s[idField] !== entry[idField]);
        list.unshift({ ...entry, ts: Date.now() });
        LS.set(lsKey, list.slice(0, 12));
      },
      find(id) {
        return store.all().find((s) => s[idField] === id) || null;
      },
      findByCode(code) {
        const wanted = String(code || '').toUpperCase();
        return store.all().find((s) => (s.code || '').toUpperCase() === wanted) || null;
      },
      latest() {
        return store.all()[0] || null;
      },
      remove(id) {
        LS.set(
          lsKey,
          store.all().filter((s) => s[idField] !== id)
        );
      },
    };
    return store;
  }

  const superStore = makeStore('sg.super.sessions', 'sessionId');
  const tableStore = makeStore('sg.table.sessions', 'teamId');
  const playerStore = makeStore('sg.player.sessions', 'playerId');

  /* --------------------------------------------------------------- REST API */

  /* Phrase d'accès animateur, utilisée seulement si le serveur la réclame
     (variable ADMIN_PASSPHRASE, typiquement en hébergement public). */
  const PASS_KEY = 'sg.pass';
  const passStore = {
    get() {
      return LS.get(PASS_KEY, '') || '';
    },
    set(value) {
      LS.set(PASS_KEY, String(value || '').trim());
    },
    clear() {
      LS.del(PASS_KEY);
    },
  };

  function authHeaders(headers) {
    const pass = passStore.get();
    if (pass) headers['X-SG-Pass'] = pass;
    return headers;
  }

  async function api(path, options, retried) {
    const opts = Object.assign({}, options || {});
    opts.headers = authHeaders(Object.assign({}, (options || {}).headers));
    if (opts.body && typeof opts.body !== 'string') {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(opts.body);
    }
    let res;
    try {
      res = await fetch(path, opts);
    } catch (err) {
      throw Object.assign(new Error(t('err.network')), { code: 'network' });
    }
    let data = {};
    try {
      data = await res.json();
    } catch (err) {
      data = {};
    }
    if (!res.ok || data.ok === false) {
      const code = data.error || 'generic';
      if (code === 'unauthorized' && !retried) {
        const given = window.prompt(t('pass.prompt'), '');
        if (given && given.trim()) {
          passStore.set(given);
          return api(path, options, true);
        }
        passStore.clear();
      }
      throw Object.assign(new Error(errorText(code, data.message)), { code });
    }
    return data;
  }

  /** Téléchargement d'un fichier servi par l'API (transmet la phrase d'accès). */
  async function download(path, filename) {
    const res = await fetch(path, { headers: authHeaders({}) });
    if (!res.ok) {
      const code = res.status === 401 ? 'unauthorized' : 'generic';
      throw Object.assign(new Error(errorText(code)), { code });
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const link = h('a', { href: url, download: filename || 'export.csv' });
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  /* ----------------------------------------------------------------- toasts */

  function toastHost() {
    let host = $('.toasts');
    if (!host) {
      host = h('div', { class: 'toasts' });
      document.body.appendChild(host);
    }
    return host;
  }

  function toast(message, type, ttl) {
    if (!message) return;
    const node = h('div', { class: `toast ${type || ''}`.trim(), text: message });
    toastHost().appendChild(node);
    setTimeout(() => {
      node.style.opacity = '0';
      node.style.transition = 'opacity .25s ease';
      setTimeout(() => node.remove(), 260);
    }, ttl || 3600);
  }

  /* ---------------------------------------------------- horloge et cadences */

  let serverOffset = 0;

  function syncClock(serverNow) {
    if (typeof serverNow === 'number') serverOffset = serverNow - Date.now();
  }

  function now() {
    return Date.now() + serverOffset;
  }

  const tickers = new Set();
  let tickHandle = null;

  function startTicker(fn) {
    tickers.add(fn);
    if (!tickHandle) {
      tickHandle = setInterval(() => {
        tickers.forEach((cb) => {
          try {
            cb();
          } catch (err) {
            console.error(err);
          }
        });
      }, 250);
    }
    return () => {
      tickers.delete(fn);
      if (!tickers.size && tickHandle) {
        clearInterval(tickHandle);
        tickHandle = null;
      }
    };
  }

  /* ----------------------------------------------------------------- socket */

  function connect(onState, onFlash) {
    const socket = window.io({ transports: ['websocket', 'polling'] });
    const dot = $('[data-conn-dot]');
    const label = $('[data-conn-label]');

    function setConn(state) {
      if (dot) dot.classList.toggle('on', state === 'online');
      if (label) label.textContent = t(`conn.${state}`);
    }

    setConn('connecting');
    socket.on('connect', () => setConn('online'));
    socket.on('disconnect', () => setConn('offline'));
    socket.on('connect_error', () => setConn('offline'));

    socket.on('state', (state) => {
      syncClock(state && state.serverNow);
      if (onState) onState(state);
    });

    socket.on('flash', (payload) => {
      if (onFlash) onFlash(payload);
      else if (payload && payload.type) toast(t(`flash.${payload.type}`));
    });

    /** Émission avec accusé de réception, sous forme de promesse. */
    socket.call = (event, payload) =>
      new Promise((resolve, reject) => {
        let settled = false;
        const timer = setTimeout(() => {
          if (settled) return;
          settled = true;
          reject(Object.assign(new Error(t('err.network')), { code: 'timeout' }));
        }, 12000);

        socket.emit(event, payload || {}, (res) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (res && res.ok) resolve(res);
          else {
            const code = (res && res.error) || 'generic';
            reject(Object.assign(new Error(errorText(code, res && res.message)), { code }));
          }
        });
      });

    socket.callSafe = async (event, payload) => {
      try {
        return await socket.call(event, payload);
      } catch (err) {
        toast(err.message, 'error');
        return null;
      }
    };

    return socket;
  }

  /* -------------------------------------------------------------- interface */

  /* ------------------------------------------------------------------ thème */

  /* La clé est écrite en clair (pas de JSON) : le script inline des pages la lit
     avant le rendu pour poser data-theme sans clignotement. */
  const THEME_KEY = 'sg.theme';
  const THEME_BG = { light: '#f1eee4', dark: '#0a0a0d' };

  const theme = {
    current() {
      return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
    },
    apply(name) {
      const next = name === 'light' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      const meta = $('meta[name="theme-color"]');
      if (meta) meta.setAttribute('content', THEME_BG[next]);
      $$('[data-theme-btn]').forEach((btn) => {
        btn.textContent = next === 'light' ? '☾' : '☀';
        btn.setAttribute('aria-label', t(next === 'light' ? 'theme.toDark' : 'theme.toLight'));
        btn.setAttribute('title', btn.getAttribute('aria-label'));
      });
      return next;
    },
    toggle() {
      const next = this.current() === 'light' ? 'dark' : 'light';
      try {
        localStorage.setItem(THEME_KEY, next);
      } catch (err) {
        /* navigation privée : le thème reste valable pour la page en cours */
      }
      return this.apply(next);
    },
  };

  function initChrome() {
    document.documentElement.setAttribute('lang', window.I18N.getLang());
    window.I18N.applyStatic();
    $$('[data-lang-btn]').forEach((btn) => {
      btn.addEventListener('click', () => window.I18N.setLang(btn.getAttribute('data-lang-btn')));
    });

    /* Bascule clair/sombre insérée devant le sélecteur de langue de chaque page. */
    const langRow = $('[data-lang-btn]') ? $('[data-lang-btn]').parentNode : null;
    if (langRow && !$('[data-theme-btn]')) {
      const btn = h('button', { class: 'btn btn-icon', type: 'button' });
      btn.setAttribute('data-theme-btn', '');
      btn.addEventListener('click', () => theme.toggle());
      langRow.parentNode.insertBefore(btn, langRow);
    }
    theme.apply(theme.current());
  }

  async function copyText(text, btn) {
    try {
      await navigator.clipboard.writeText(text);
    } catch (err) {
      const tmp = h('textarea', { style: 'position:fixed;opacity:0' });
      tmp.value = text;
      document.body.appendChild(tmp);
      tmp.select();
      try {
        document.execCommand('copy');
      } catch (e) {
        /* ignore */
      }
      tmp.remove();
    }
    if (btn) {
      const before = btn.textContent;
      btn.textContent = t('btn.copied');
      setTimeout(() => {
        btn.textContent = before;
      }, 1400);
    }
  }

  /** Boîte de dialogue générique ; renvoie le noeud pour composition. */
  function modal(contentNode, { onClose } = {}) {
    const backdrop = h('div', { class: 'modal-backdrop' });
    const box = h('div', { class: 'modal' }, [contentNode]);
    backdrop.appendChild(box);
    function close() {
      backdrop.remove();
      document.removeEventListener('keydown', onKey);
      if (onClose) onClose();
    }
    function onKey(event) {
      if (event.key === 'Escape') close();
    }
    backdrop.addEventListener('click', (event) => {
      if (event.target === backdrop) close();
    });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(backdrop);
    return { backdrop, box, close };
  }

  function qs(name) {
    return new URLSearchParams(window.location.search).get(name);
  }

  function joinUrl(code) {
    return `${window.location.origin}/join/${encodeURIComponent(code)}`;
  }

  function tableUrl(code) {
    return `${window.location.origin}/table/${encodeURIComponent(code)}`;
  }

  window.SG = {
    $,
    $$,
    h,
    svg,
    clear,
    escapeHtml,
    fmtSigned,
    signClass,
    fmtClock,
    fmtDateTime,
    fmtTimeOnly,
    fmtDuration,
    LS,
    superStore,
    tableStore,
    playerStore,
    passStore,
    api,
    download,
    toast,
    syncClock,
    now,
    startTicker,
    connect,
    initChrome,
    theme,
    copyText,
    modal,
    qs,
    joinUrl,
    tableUrl,
    t,
    L,
  };
})();
