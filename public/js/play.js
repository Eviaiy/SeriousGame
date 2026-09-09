/* Espace équipe : vote A/B/C, chrono, résultats, classement. */
(function () {
  'use strict';

  const {
    $,
    h,
    clear,
    toast,
    teamStore,
    t,
    L,
    fmtSigned,
    signClass,
    qs,
    startTicker,
  } = window.SG;
  const C = window.CARDS;

  window.SG.initChrome();

  /* -------------------------------------------------------- identification */

  const sessionId = qs('s');
  const code = (qs('code') || '').toUpperCase();
  let creds = sessionId ? teamStore.find(sessionId) : code ? teamStore.findByCode(code) : null;
  if (!creds) creds = teamStore.latest();

  if (!creds) {
    window.location.href = code ? `/?code=${encodeURIComponent(code)}` : '/';
    return;
  }

  /* ------------------------------------------------------------------ état */

  let state = null;
  let lastEventId = null;
  let lastRoundStatus = null;
  const timer = C.createTimer();
  let submitting = false;

  const socket = window.SG.connect(onState, onFlash);
  socket.on('connect', joinSession);

  async function joinSession() {
    try {
      const res = await socket.call('team:join', {
        sessionId: creds.sessionId,
        code: creds.code,
        teamId: creds.teamId,
        teamToken: creds.teamToken,
      });
      onState(res.state);
    } catch (err) {
      toast(err.message, 'error');
      if (err.code === 'forbidden' || err.code === 'session_not_found') {
        teamStore.remove(creds.sessionId);
        setTimeout(() => {
          window.location.href = '/';
        }, 1600);
      }
    }
  }

  function onState(next) {
    state = next;
    const me = myTeam();
    if (me) {
      teamStore.save({
        sessionId: state.session.id,
        code: state.session.code,
        teamId: creds.teamId,
        teamToken: creds.teamToken,
        teamName: me.name,
      });
    }
    render();
  }

  function onFlash(payload) {
    if (!payload || !payload.type) return;
    toast(t(`flash.${payload.type}`));
  }

  function myTeam() {
    if (!state) return null;
    return state.teams.find((x) => x.id === state.teamId) || null;
  }

  function buzz(pattern) {
    if (navigator.vibrate) {
      try {
        navigator.vibrate(pattern);
      } catch (err) {
        /* ignore */
      }
    }
  }

  /* ---------------------------------------------------------------- entête */

  function renderHeader() {
    const me = myTeam();
    const name = me ? me.name : creds.teamName;
    $('#team-name').textContent = name;
    $('#team-title').textContent = name;

    const badge = $('#session-status');
    const status = state.session.status;
    badge.textContent = t(`admin.status.${status}`);
    badge.className = `badge ${status === 'running' ? 'green' : status === 'finished' ? 'red' : 'gold'}`;

    const row = (state.leaderboard || []).find((r) => r.teamId === state.teamId);
    $('#my-rank').textContent = row && !state.leaderboardHidden ? `#${row.rank}` : '—';
    $('#my-total').textContent = me ? fmtSigned(me.total) : '0';
    $('#my-total').className = `v small ${signClass(me ? me.total : 0)}`;
    $('#my-act1').textContent = me ? fmtSigned(me.act1) : '0';
    $('#my-act2').textContent = me ? fmtSigned(me.act2) : '0';
    $('#my-wins').textContent = me ? me.wins : 0;
  }

  /* ----------------------------------------------------------------- scène */

  function renderStage() {
    const host = clear($('#stage'));
    const round = state.round;

    if (state.session.status === 'finished' && !round) {
      host.appendChild(
        h('div', { class: 'panel center' }, [
          h('h2', { text: t('play.sessionEnded') }),
          h('p', { class: 'muted small', text: t('play.finalProfile') }),
        ])
      );
      return;
    }

    if (!round) {
      host.appendChild(
        h('div', { class: 'panel center' }, [
          h('div', { class: 'eyebrow', text: t('app.tagline') }),
          h('h2', { text: t('play.waiting') }),
          h('p', { class: 'muted small', text: t('play.waitingHint') }),
        ])
      );
      return;
    }

    const open = round.status === 'open' && !round.pausedAt;
    const alreadyAnswered = Boolean(round.myChoice);
    const canChange = state.session.settings.allowChangeBeforeDeadline;
    const interactive = open && (!alreadyAnswered || canChange) && !submitting;

    const winningKeys = (round.results || [])
      .filter((r) => (round.winners || []).includes(r.teamId))
      .map((r) => r.choice)
      .filter(Boolean);

    host.appendChild(
      C.renderCard(round.event, {
        interactive,
        disabled: !interactive,
        selected: round.myChoice,
        revealed: round.revealed,
        winningKeys,
        showPoints: round.revealed,
        onChoose: choose,
      })
    );

    /* --- chrono et état de la table --- */
    const statusLine = h('div', { class: 'row' }, [
      alreadyAnswered
        ? h('span', { class: 'badge green', text: `${t('play.submitted')} · ${round.myChoice}` })
        : h('span', { class: 'badge', text: t('play.chooseNow') }),
      round.status === 'closed' && !round.revealed
        ? h('span', { class: 'badge gold', text: t('play.waitingReveal') })
        : null,
      h('div', { class: 'spacer' }),
      h('span', {
        class: 'small muted',
        text: t('admin.answered', { n: round.answeredCount, total: round.teamCount }),
      }),
    ]);

    host.appendChild(
      h('div', { class: 'panel tight' }, [
        timer.node,
        statusLine,
        h('div', { style: 'margin-top:10px' }, [C.answerChips(round, { showSeconds: round.revealed })]),
      ])
    );
    timer.update(round);

    /* --- résultats --- */
    if (round.revealed) {
      host.appendChild(
        h('div', { class: 'stack' }, [
          C.winnerBanner(round, { teamId: state.teamId }),
          h('div', { class: 'panel tight' }, [
            h('div', { class: 'label', text: t('play.results') }),
            C.resultsTable(round, { teamId: state.teamId }),
          ]),
        ])
      );
    }
  }

  async function choose(key) {
    if (submitting) return;
    submitting = true;
    render();
    const res = await socket.callSafe('team:submit', { choice: key });
    submitting = false;
    if (res) {
      buzz(40);
      toast(t('play.submitted'), 'success');
    }
    render();
  }

  /* ------------------------------------------------------------ classement */

  function renderBoard() {
    const host = clear($('#board-host'));
    if (state.leaderboardHidden) {
      host.appendChild(h('p', { class: 'muted small', text: t('play.leaderboardHidden') }));
      const me = (state.leaderboard || [])[0];
      if (me) host.appendChild(C.leaderboardTable([me], { compact: true, teamId: state.teamId }));
      return;
    }
    host.appendChild(C.leaderboardTable(state.leaderboard, { compact: true, teamId: state.teamId }));
  }

  function renderProfiles() {
    const host = clear($('#profiles-host'));
    const me = myTeam();
    if (!me) return;
    host.appendChild(C.profileCard('score.profile1', me.act1Profile, 'orange'));
    host.appendChild(C.profileCard('score.profile2', me.act2Profile, 'blue'));
  }

  function renderRoles() {
    const host = clear($('#roles-host'));
    host.appendChild(C.rolesGrid(state.roles));
  }

  /* ---------------------------------------------------------------- render */

  function render() {
    if (!state) return;
    renderHeader();
    renderStage();
    renderBoard();
    renderProfiles();
    renderRoles();

    const round = state.round;
    const eventId = round ? round.eventId : null;
    const status = round ? `${round.status}:${round.revealed}` : 'none';
    if (eventId && eventId !== lastEventId) buzz([60, 40, 60]);
    if (status !== lastRoundStatus && round && round.revealed) buzz(120);
    lastEventId = eventId;
    lastRoundStatus = status;
  }

  startTicker(() => {
    if (state) timer.update(state.round);
  });

  window.I18N.onChange(() => {
    window.I18N.applyStatic();
    render();
  });

  /* ----------------------------------------------------------------- events */

  $('#btn-rename').addEventListener('click', async () => {
    const me = myTeam();
    const next = window.prompt(t('play.rename'), me ? me.name : '');
    if (!next) return;
    await socket.callSafe('team:rename', { name: next.trim() });
  });

  $('#btn-leave').addEventListener('click', () => {
    if (!window.confirm(t('play.leaveConfirm'))) return;
    teamStore.remove(creds.sessionId);
    window.location.href = '/';
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && socket.connected) {
      socket
        .call('state:refresh')
        .then((res) => res && res.state && onState(res.state))
        .catch(() => {});
    }
  });
})();
