/* Accueil : la partie en cours et ses accès, ou la création d'une partie. */
(function () {
  'use strict';

  const {
    $,
    $$,
    h,
    clear,
    api,
    toast,
    superStore,
    tableStore,
    playerStore,
    t,
    fmtDateTime,
    gameTitle,
    qs,
  } = window.SG;

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

  /* Déclarés ici : ouvrir la porte animateur rafraîchit la liste des tables,
     avant que sa section, plus bas dans le fichier, ne soit évaluée. */
  const tableSheet = $('#table-sheet');
  let tables = [];
  let tablesTimer = null;

  /* ------------------------------------------------- portes (une à la fois) */

  const doors = {
    player: { panel: $('#door-player'), firstInput: '#player-name' },
    table: { panel: $('#door-table'), firstInput: '#table-host-name' },
  };
  let openDoor = null;

  /* Une seule porte visible et dépliée ; `null` les masque toutes. */
  function openOnly(which) {
    openDoor = which;
    for (const [name, door] of Object.entries(doors)) {
      const isOpen = name === which;
      door.panel.classList.toggle('hidden', !isOpen);
      door.panel.classList.toggle('is-open', isOpen);
      door.panel.querySelector('.door-face').setAttribute('aria-expanded', String(isOpen));
    }
    /* Aucun formulaire ouvert : le conteneur disparaît, sans laisser d'espace. */
    $('.doors').classList.toggle('hidden', !which);
    $('#btn-join-player').classList.toggle('is-active', which === 'player');
    $('#btn-join-table').classList.toggle('is-active', which === 'table');
    if (which === 'table' && tableCode.value.trim().length === 6) lookupTables();
    if (which) {
      const input = $(doors[which].firstInput);
      /* On attend la fin du dépliage pour ne pas casser l'animation par le scroll. */
      setTimeout(() => input && input.focus({ preventScroll: true }), 260);
    }
  }

  /* Partie en cours : les boutons ouvrent le formulaire voulu, un second clic
     le referme. */
  $('#btn-join-player').addEventListener('click', () =>
    openOnly(openDoor === 'player' ? null : 'player')
  );
  $('#btn-join-table').addEventListener('click', () =>
    openOnly(openDoor === 'table' ? null : 'table')
  );

  /* Code de session déjà connu (QR, ou partie en cours) : inutile de le
     redemander, les formulaires ne gardent que le nom. */
  function hideCodeFields(known) {
    $('#join-code-field').classList.toggle('hidden', known);
    $('#table-code-field').classList.toggle('hidden', known);
  }

  /* Trois accueils :
     - avec un code de session (QR / lien d'inscription) : seul le formulaire
       joueur, déjà ouvert ;
     - sans code, une partie en cours : la partie, puis ses trois accès
       (joueur, animateur de table, direction de jeu) ;
     - sans code, aucune partie : « Démarrer une partie », puis deux réglages. */
  openOnly(null);
  if (prefill) {
    hideCodeFields(true);
    openOnly('player');
    const steps = $('.steps');
    if (steps) steps.classList.add('hidden');
  }

  $('#btn-start-game').addEventListener('click', () => {
    $('#landing-cta').classList.add('hidden');
    $('#new-game').classList.remove('hidden');
    setTimeout(() => $('#team-count').focus({ preventScroll: true }), 50);
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
    /* La liste des tables affichait peut-être celles qui viennent de mourir. */
    if (tableCode.value.trim() === (entry.code || '')) lookupTables();
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
  }

  renderAll();
  window.I18N.onChange(renderAll);

  /* ------------------------------------------ état de la session (places) */

  const joinInfo = $('#join-info');
  let lookupTimer = null;

  async function lookupSession() {
    const code = joinCode.value.trim();
    joinInfo.classList.add('hidden');
    if (code.length !== 6) return;
    try {
      const res = await api(`/api/sessions/${encodeURIComponent(code)}`);
      if (!res.joinOpen) {
        joinInfo.textContent = `${gameTitle(res.name)} — ${t('err.join_closed')}`;
        joinInfo.classList.remove('hidden');
      }
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

  async function openTable(code, button, teamId) {
    if (code.length !== 6) return toast(t('err.team_not_found'), 'error');
    const facilitatorName = $('#table-host-name').value.trim();
    if (!facilitatorName) {
      $('#table-host-name').focus();
      return toast(t('err.name_required'), 'error');
    }
    try {
      localStorage.setItem('sg.hostName', facilitatorName);
    } catch (err) {
      /* ignore */
    }
    if (button) button.disabled = true;
    try {
      const res = await api('/api/team-admin', {
        method: 'POST',
        body: { code, teamId, facilitatorName },
      });
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

  /* Le nom saisi la dernière fois sur cet appareil est proposé d'office. */
  try {
    $('#table-host-name').value = localStorage.getItem('sg.hostName') || '';
  } catch (err) {
    /* ignore */
  }

  $('#table-form').addEventListener('submit', (event) => {
    event.preventDefault();
    openTable(tableCode.value.trim().toUpperCase(), event.target.querySelector('button[type="submit"]'));
  });

  /* Les tables de la session telles que le serveur les connaît : tout appareil
     voit les mêmes, y compris celles ouvertes ailleurs. Un animateur passé du
     téléphone à l'ordinateur retrouve donc la sienne au lieu d'en prendre une
     autre. */
  function renderTables() {
    const host = clear($('#table-sheet-list'));
    tableSheet.classList.toggle('hidden', !tables.length);
    for (const table of tables) {
      const mine = tableStore.find(table.id);
      const status = table.hosted
        ? table.facilitatorName
          ? t('home.tableHostedBy', { name: table.facilitatorName })
          : t('home.tableHosted')
        : t('home.tableFree');
      const details = [status, table.adminCode];
      if (table.headcount) details.push(t('home.tablePlayers', { n: table.headcount }));
      host.appendChild(
        h('div', { class: 'list-item' }, [
          h('div', { class: 'grow' }, [
            h('div', { class: 'title', text: table.name }),
            h('div', {
              class: 'small muted',
              text: details.filter(Boolean).join(' • '),
            }),
          ]),
          h('button', {
            class: mine ? 'btn btn-sm btn-primary' : 'btn btn-sm',
            type: 'button',
            text: t(mine ? 'home.resumeTable' : 'home.openTable'),
            onClick: (e) => openTable(tableCode.value.trim().toUpperCase(), e.target, table.id),
          }),
        ])
      );
    }
  }

  async function lookupTables() {
    const code = tableCode.value.trim();
    try {
      tables =
        code.length === 6
          ? (await api(`/api/sessions/${encodeURIComponent(code)}`)).tables || []
          : [];
    } catch (err) {
      /* Code inconnu, ou code d'une table : rien à lister, le formulaire répondra. */
      tables = [];
    }
    renderTables();
  }

  /* Un code complet donne la liste tout de suite ; une saisie partielle la vide
     sans requête. */
  tableCode.addEventListener('input', () => {
    clearTimeout(tablesTimer);
    if (tableCode.value.trim().length === 6) lookupTables();
    else tablesTimer = setTimeout(lookupTables, 250);
  });
  window.I18N.onChange(renderTables);

  /* Les tables se prennent et se remplissent pendant que la porte est ouverte :
     on rafraîchit l'état tant qu'elle reste affichée. */
  setInterval(() => {
    if (openDoor === 'table' && tableCode.value.trim().length === 6) lookupTables();
    if (!prefill) loadActiveGame();
  }, 8000);

  /* ------------------------------------------------------- partie en cours */

  /** La partie en cours : la plus récente des sessions non terminées. */
  let activeGame = null;

  async function resumeDirection(code, button) {
    if (button) button.disabled = true;
    try {
      const res = await api('/api/super-admin', { method: 'POST', body: { code } });
      superStore.save({
        sessionId: res.sessionId,
        code: res.code,
        superKey: res.superKey,
        name: res.name,
      });
      window.location.href = `/admin.html?s=${encodeURIComponent(res.sessionId)}`;
    } catch (err) {
      toast(err.message, 'error');
      if (button) button.disabled = false;
    }
    return undefined;
  }

  function renderActiveGame() {
    if (prefill) return;
    const game = activeGame;
    const creating = !$('#new-game').classList.contains('hidden');
    $('#active-game').classList.toggle('hidden', !game);
    /* Pas de partie : l'appel à l'action, sauf si le formulaire est déjà ouvert. */
    $('#landing-cta').classList.toggle('hidden', Boolean(game) || creating);
    if (game) $('#new-game').classList.add('hidden');
    $$('.home-action').forEach((btn) => btn.classList.toggle('hidden', !game));
    /* Les actes sont repris dans le bloc de la partie : pas de doublon. */
    $('.hero .acts').classList.toggle('hidden', Boolean(game));
    /* Sous les boutons, seul le formulaire compte : pas de carte d'en-tête. */
    $('.doors').classList.toggle('doors-compact', Boolean(game));
    hideCodeFields(Boolean(game));
    if (!game) {
      if (openDoor) openOnly(null);
      return;
    }
    $('#active-game-name').textContent = gameTitle(game.name);
    $('#active-game-meta').textContent = t('home.activeGameMeta', {
      code: game.code,
      tables: game.teamCount,
      players: game.playerCount,
    });
    /* Les deux portes visent cette partie : son code est prérempli. */
    if (joinCode.value !== game.code) {
      joinCode.value = game.code;
      lookupSession();
    }
    if (tableCode.value !== game.code) {
      tableCode.value = game.code;
      lookupTables();
    }
  }

  async function loadActiveGame() {
    try {
      const res = await api('/api/sessions');
      activeGame = (res.sessions || [])[0] || null;
    } catch (err) {
      activeGame = null;
      if (err.code !== 'unauthorized') toast(err.message, 'error');
    }
    renderActiveGame();
  }

  /* Direction de jeu : pas de formulaire, on entre directement dans la console. */
  $('#btn-go-admin').addEventListener('click', (event) => {
    if (activeGame) resumeDirection(activeGame.code, event.currentTarget);
  });

  if (!prefill) loadActiveGame();
  window.I18N.onChange(renderActiveGame);

  $('#create-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = event.target.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      const res = await api('/api/sessions', {
        method: 'POST',
        body: {
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
