/* Écran des résultats : projeté en plein écran par la direction de jeu quand
   toutes les tables ont fini. Il reprend, pour chaque table, les trois bilans
   que la table voit elle-même à la fin des deux actes. */
(function () {
  'use strict';

  const {
    $,
    h,
    clear,
    toast,
    superStore,
    forgetSession,
    t,
    L,
    qs,
    fmtSigned,
    signClass,
    gameTitle,
  } = window.SG;
  const C = window.CARDS;

  window.SG.initChrome();

  /* -------------------------------------------------------- identification */

  /* La clé de direction est déjà mémorisée par la console d'où l'on vient. */
  const sessionId = qs('s');
  const entry = sessionId ? superStore.find(sessionId) : null;

  if (!sessionId || !entry) {
    toast(t('err.forbidden'), 'error');
    setTimeout(() => {
      window.location.href = '/';
    }, 1200);
    return;
  }

  $('#btn-back').href = `/admin.html?s=${encodeURIComponent(sessionId)}`;

  /* ------------------------------------------------------------------ état */

  let state = null;

  const socket = window.SG.connect(onState, () => {});
  socket.on('connect', joinSession);
  socket.on('session:deleted', () => {
    forgetSession(sessionId);
    toast(t('err.session_deleted'), 'error');
    setTimeout(() => {
      window.location.href = '/';
    }, 1800);
  });

  async function joinSession() {
    try {
      const res = await socket.call('super:join', { sessionId, superKey: entry.superKey });
      onState(res.state);
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  function onState(next) {
    state = next;
    render();
  }

  /* ------------------------------------------------------------------ rendu */

  function render() {
    if (!state) return;
    const title = gameTitle(state.session.name);
    document.title = `${t('results.title')} — ${title}`;

    const allDone = state.session.allTeamsDone;
    const status = $('#results-status');
    status.textContent = allDone ? t('results.allDone') : t('results.inProgress');
    status.className = `badge ${allDone ? 'green' : 'accent'}`;

    clear($('#results-board')).appendChild(
      C.leaderboardTable(state.leaderboard, { noAdjust: true })
    );

    /* Les tables suivent l'ordre du classement général partout sur l'écran. */
    const byId = new Map(state.teams.map((team) => [team.id, team]));
    const teams = state.leaderboard.map((row) => byId.get(row.teamId)).filter(Boolean);

    [1, 2].forEach((act) => {
      clear($(`#results-profile-${act}`)).appendChild(profileInContext(act, teams));
    });
    clear($('#results-decisions')).appendChild(decisionsTable(teams));
  }

  /** Échelle d'un acte : chaque niveau porte les tables qui l'ont atteint. */
  function profileInContext(act, teams) {
    const levels = (state.profileScales && state.profileScales[act]) || [];
    const placed = new Map(levels.map((level) => [level.id, []]));
    const pending = [];
    teams.forEach((team) => {
      const result = (team.actResults || []).find((r) => Number(r.act) === act);
      /* Une table n'a de profil qu'une fois l'acte fini : avant, elle serait
         rangée au plus bas niveau sans l'avoir mérité. */
      if (result && result.profile && placed.has(result.profile.id)) {
        placed.get(result.profile.id).push({ team, score: result.score });
      } else {
        pending.push(team.name);
      }
    });

    return h('div', { class: 'act-profile-scale' }, [
      h(
        'div',
        { class: 'act-profile-levels' },
        levels.map((level, index) => {
          const here = placed.get(level.id);
          return h(
            'div',
            {
              class: ['act-profile-level', `level-${index + 1}`, here.length ? 'is-current' : '']
                .filter(Boolean)
                .join(' '),
            },
            [
              h('span', { class: 'level-dot', 'aria-hidden': 'true' }),
              h('strong', { class: 'level-range', text: level.range }),
              h('div', { class: 'level-copy' }, [
                h('strong', { text: L(level.label) }),
                h('span', { class: 'small muted', text: L(level.desc) }),
              ]),
              h(
                'div',
                { class: 'level-teams' },
                here.map(({ team, score }) =>
                  h('span', { class: 'badge orange', text: `${team.name} · ${fmtSigned(score)}` })
                )
              ),
            ]
          );
        })
      ),
      pending.length
        ? h('p', {
            class: 'small muted',
            style: 'margin:0',
            text: t('results.notYet', { names: pending.join(', ') }),
          })
        : null,
    ]);
  }

  /** Toutes les décisions : une ligne par événement, une colonne par table. */
  function decisionsTable(teams) {
    if (!state.events.length) return h('p', { class: 'muted small', text: t('results.noEvents') });
    const answers = new Map(
      teams.map((team) => [team.id, new Map((team.history || []).map((e) => [e.eventId, e]))])
    );

    const rows = [];
    [1, 2].forEach((act) => {
      const events = state.events.filter((event) => Number(event.act || 1) === act);
      if (!events.length) return;
      rows.push(
        h('tr', { class: 'results-act-row' }, [
          h('th', { colspan: String(teams.length + 1), text: t(`score.act${act}`) }),
        ])
      );
      events.forEach((event) => {
        rows.push(
          h('tr', {}, [
            h('td', {}, [
              h('div', { text: L(event.title) }),
              h('div', { class: 'small muted', text: L(event.ref) }),
            ]),
            ...teams.map((team) => {
              const entry = answers.get(team.id).get(event.id);
              if (!entry) return h('td', { class: 'center muted', text: '—' });
              /* Le choix puis ses points, sur la même ligne. */
              return h('td', { class: 'center' }, [
                h('span', { class: 'results-choice', text: entry.decision || '—' }),
                h('span', {
                  class: `results-points ${signClass(entry.total)}`,
                  text: fmtSigned(entry.total),
                }),
              ]);
            }),
          ])
        );
      });
    });

    return h('table', { class: 'table results-decisions' }, [
      h('thead', {}, [
        h('tr', {}, [
          h('th', { text: t('score.event') }),
          ...teams.map((team) => h('th', { class: 'center', text: team.name })),
        ]),
      ]),
      h('tbody', {}, rows),
    ]);
  }

  /* ------------------------------------------------------------ plein écran */

  const fsBtn = $('#btn-fullscreen');
  function syncFullscreen() {
    const on = Boolean(document.fullscreenElement);
    fsBtn.textContent = t(on ? 'results.exitFullscreen' : 'results.fullscreen');
    document.body.classList.toggle('is-fullscreen', on);
  }
  fsBtn.addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen();
  });
  document.addEventListener('fullscreenchange', syncFullscreen);

  window.I18N.onChange(() => {
    syncFullscreen();
    render();
  });
})();
