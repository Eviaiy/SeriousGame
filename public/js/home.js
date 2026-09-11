/* Accueil : trois entrées — joueur, animateur de table, direction de jeu. */
(function () {
  'use strict';

  const { $, $$, h, clear, api, toast, superStore, tableStore, playerStore, t, fmtDateTime, qs } =
    window.SG;

  window.SG.initChrome();

  /* ------------------------------------------------------- saisie des codes */

  function codeField(input) {
    input.addEventListener('input', () => {
      input.value = input.value
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '')
        .slice(0, 6);
    });
  }

  const joinCode = $('#join-code');
  const tableCode = $('#table-code');
  codeField(joinCode);
  codeField(tableCode);

  const prefill = (qs('code') || '').toUpperCase().slice(0, 6);
  if (prefill) joinCode.value = prefill;
  /* Table scannée sur place : le joueur y sera assis au lieu d'être réparti. */
  const wantedTable = (qs('t') || '').slice(0, 40);

  /* ------------------------------------------------- portes (une à la fois) */

  const doors = {
    player: { panel: $('#door-player'), firstInput: '#join-code' },
    table: { panel: $('#door-table'), firstInput: '#table-code' },
    super: { panel: $('#door-super'), firstInput: '#session-name' },
  };
  let openDoor = 'player';

  function setDoor(which) {
    openDoor = openDoor === which ? null : which;
    for (const [name, door] of Object.entries(doors)) {
      const isOpen = name === openDoor;
      door.panel.classList.toggle('is-open', isOpen);
      door.panel.classList.toggle('is-dim', Boolean(openDoor) && !isOpen);
      door.panel.querySelector('.door-face').setAttribute('aria-expanded', String(isOpen));
    }
    if (openDoor) {
      const input = $(doors[openDoor].firstInput);
      /* On attend la fin du dépliage pour ne pas casser l'animation par le scroll. */
      setTimeout(() => input && input.focus({ preventScroll: true }), 260);
    }
  }

  $$('[data-door]').forEach((btn) => {
    btn.addEventListener('click', () => setDoor(btn.getAttribute('data-door')));
  });

  /* ------------------------------------------------------- listes mémorisées */

  /**
   * Supprimer une session la supprime pour de bon : le serveur efface ses
   * tables, leurs codes et les postes de ses joueurs, puis cet appareil oublie
   * les accès qu'il en gardait.
   */
  async function deleteSession(entry) {
    if (!window.confirm(t('home.deleteSessionConfirm', { code: entry.code || '' }))) return;
    try {
      await api(`/api/sessions/${encodeURIComponent(entry.sessionId)}`, {
        method: 'DELETE',
        body: { superKey: entry.superKey },
      });
    } catch (err) {
      /* Déjà disparue du serveur : il ne reste qu'à ranger cet appareil. */
      if (err.code !== 'session_not_found') return toast(err.message, 'error');
    }
    const mine = (list) => list.filter((e) => e.sessionId === entry.sessionId);
    mine(tableStore.all()).forEach((e) => tableStore.remove(e.teamId));
    mine(playerStore.all()).forEach((e) => playerStore.remove(e.playerId));
    superStore.remove(entry.sessionId);
    renderAll();
    return toast(t('home.sessionDeleted'));
  }

  /**
   * Rend une liste d'accès mémorisés.
   * cfg : { store, idField, boxId, listId, title, sub, href, cta, onRemove }
   */
  function renderList(cfg) {
    const list = cfg.store.all();
    const box = $(cfg.boxId);
    const host = clear($(cfg.listId));
    if (!list.length) {
      box.classList.add('hidden');
      return;
    }
    box.classList.remove('hidden');
    for (const entry of list) {
      host.appendChild(
        h('div', { class: 'list-item' }, [
          h('div', { class: 'grow' }, [
            h('div', { class: 'title', text: cfg.title(entry) }),
            h('div', { class: 'small muted', text: cfg.sub(entry) }),
          ]),
          h('a', { class: 'btn btn-sm btn-primary', href: cfg.href(entry), text: t(cfg.cta) }),
          h('button', {
            class: 'btn btn-sm btn-ghost btn-danger',
            text: '×',
            title: t('btn.delete'),
            onClick: () => {
              if (cfg.onRemove) return cfg.onRemove(entry);
              cfg.store.remove(entry[cfg.idField]);
              return renderAll();
            },
          }),
        ])
      );
    }
  }

  function renderAll() {
    renderList({
      store: playerStore,
      idField: 'playerId',
      boxId: '#player-resume',
      listId: '#player-list',
      title: (e) => e.playerName || t('nav.play'),
      sub: (e) => `${e.teamName || ''} · ${e.code} · ${fmtDateTime(e.ts)}`,
      href: (e) => `/play.html?p=${encodeURIComponent(e.playerId)}`,
      cta: 'home.resumePlayer',
    });
    renderList({
      store: tableStore,
      idField: 'teamId',
      boxId: '#table-resume',
      listId: '#table-list',
      title: (e) => e.teamName || t('nav.team'),
      sub: (e) => `${e.adminCode} · ${fmtDateTime(e.ts)}`,
      href: (e) => `/team.html?tid=${encodeURIComponent(e.teamId)}`,
      cta: 'home.resumeTable',
    });
    renderList({
      store: superStore,
      idField: 'sessionId',
      boxId: '#super-resume',
      listId: '#super-list',
      title: (e) => e.name || t('app.title'),
      sub: (e) => `${e.code} · ${fmtDateTime(e.ts)}`,
      href: (e) => `/admin.html?s=${encodeURIComponent(e.sessionId)}`,
      cta: 'nav.admin',
      onRemove: deleteSession,
    });
  }

  renderAll();
  window.I18N.onChange(renderAll);

  /* Porte ouverte par défaut : le lien d'invitation mène au formulaire joueur,
     sinon on rouvre celle de l'accès déjà en cours sur ce navigateur. */
  if (!prefill && !playerStore.all().length) {
    if (tableStore.all().length) setDoor('table');
    else if (superStore.all().length) setDoor('super');
  }

  /* ------------------------------------------ état de la session (places) */

  const joinInfo = $('#join-info');
  let lookupTimer = null;

  async function lookupSession() {
    const code = joinCode.value.trim();
    joinInfo.classList.add('hidden');
    if (code.length !== 6) return;
    try {
      const res = await api(`/api/sessions/${encodeURIComponent(code)}`);
      const seats = Math.max(0, res.teamCount * res.teamSize - res.playerCount);
      const table = wantedTable ? (res.tables || []).find((x) => x.id === wantedTable) : null;
      joinInfo.textContent = !res.joinOpen
        ? `${res.name} — ${t('err.join_closed')}`
        : table
          ? `${res.name} — ${t('home.joiningTable', { name: table.name })}`
          : `${res.name} — ${t('home.seats', { n: seats })}`;
      joinInfo.classList.remove('hidden');
    } catch (err) {
      joinInfo.textContent = err.message;
      joinInfo.classList.remove('hidden');
    }
  }

  joinCode.addEventListener('input', () => {
    clearTimeout(lookupTimer);
    lookupTimer = setTimeout(lookupSession, 350);
  });
  if (prefill) lookupSession();

  /* --------------------------------------------------------------- joueur */

  $('#join-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const code = joinCode.value.trim().toUpperCase();
    const name = $('#player-name').value.trim();
    if (code.length !== 6) return toast(t('err.session_not_found'), 'error');
    if (name.length < 2) return toast(t('err.bad_name'), 'error');

    const button = event.target.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      const res = await api(`/api/sessions/${encodeURIComponent(code)}/players`, {
        method: 'POST',
        body: wantedTable ? { name, teamId: wantedTable } : { name },
      });
      playerStore.save({
        sessionId: res.sessionId,
        code: res.code,
        teamId: res.teamId,
        teamName: res.teamName,
        playerId: res.playerId,
        playerToken: res.playerToken,
        playerName: res.playerName,
      });
      window.location.href = `/play.html?p=${encodeURIComponent(res.playerId)}`;
    } catch (err) {
      toast(err.message, 'error');
      button.disabled = false;
    }
    return undefined;
  });

  /* --------------------------------------------------- animateur de table */

  async function openTable(code, button) {
    if (code.length !== 6) return toast(t('err.team_not_found'), 'error');
    if (button) button.disabled = true;
    try {
      const res = await api('/api/team-admin', { method: 'POST', body: { code } });
      tableStore.save({
        sessionId: res.sessionId,
        code: res.code,
        /* Le serveur renvoie le code de la table attribuée, pas celui saisi. */
        adminCode: res.adminCode || code,
        teamId: res.teamId,
        teamName: res.teamName,
        adminToken: res.adminToken,
        sessionName: res.sessionName,
      });
      window.location.href = `/team.html?tid=${encodeURIComponent(res.teamId)}`;
    } catch (err) {
      toast(err.message, 'error');
      if (button) button.disabled = false;
    }
    return undefined;
  }

  $('#table-form').addEventListener('submit', (event) => {
    event.preventDefault();
    openTable(tableCode.value.trim().toUpperCase(), event.target.querySelector('button[type="submit"]'));
  });

  /* Le code de session déjà connu de ce navigateur est prérempli : l'animateur
     n'a plus qu'à ouvrir sa console. On garde l'accès le plus récent, sinon une
     session tout juste créée serait masquée par un atelier précédent. */
  const lastAccess = [tableStore.latest(), superStore.latest()]
    .filter(Boolean)
    .sort((a, b) => (b.ts || 0) - (a.ts || 0))[0];
  const knownCode = (lastAccess || {}).code || prefill;
  if (knownCode && !tableCode.value) tableCode.value = knownCode;

  /* ----------------------------------------------------- direction de jeu */

  $('#create-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = event.target.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      const res = await api('/api/sessions', {
        method: 'POST',
        body: {
          name: $('#session-name').value.trim(),
          facilitator: $('#facilitator').value.trim(),
          lang: window.I18N.getLang(),
          teamCount: Number($('#team-count').value) || 3,
          teamSize: Number($('#team-size').value) || 6,
        },
      });
      superStore.save({
        sessionId: res.sessionId,
        code: res.code,
        superKey: res.superKey,
        name: res.name,
      });
      window.location.href = `/admin.html?s=${encodeURIComponent(res.sessionId)}`;
    } catch (err) {
      toast(err.message, 'error');
      button.disabled = false;
    }
  });
})();
