/* Console de l'animateur de table : il encadre une équipe, il ne vote pas. */
(function () {
  'use strict';

  const { $, h, clear, api, toast, tableStore, t, L, connect, startTicker, qs, toMinutes, toSeconds } =
    window.SG;
  const C = window.CARDS;

  window.SG.initChrome();

  const stage = $('#stage');
  const dock = $('#dock');
  const dockActions = $('#dock-actions');
  const timer = C.createTimer();
  $('#dock-timer').appendChild(timer.node);

  let socket = null;
  let state = null;
  let creds = null;
  /** Numéro de manche déjà affiché : sert à ne rejouer les animations qu'une fois. */
  let shownRound = null;
  let shownClosed = null;

  /* ------------------------------------------------------------ identification */

  async function resolveCreds() {
    const teamId = qs('tid');
    if (teamId) {
      const saved = tableStore.find(teamId);
      if (saved) return saved;
    }
    const code = (qs('code') || '').toUpperCase();
    if (code) {
      const saved = tableStore.all().find((e) => e.adminCode === code);
      if (saved) return saved;
      const res = await api('/api/team-admin', { method: 'POST', body: { code } });
      const entry = {
        sessionId: res.sessionId,
        code: res.code,
        adminCode: res.adminCode || code,
        teamId: res.teamId,
        teamName: res.teamName,
        adminToken: res.adminToken,
        sessionName: res.sessionName,
      };
      tableStore.save(entry);
      return entry;
    }
    return tableStore.latest();
  }

  /* ------------------------------------------------------------------- rendu */

  function statusBadge(session) {
    const badge = $('#session-status');
    const key =
      session.status === 'finished'
        ? 'admin.status.finished'
        : session.status === 'running'
          ? 'admin.status.running'
          : 'admin.status.lobby';
    badge.textContent = t(key);
    badge.className = `badge ${session.status === 'finished' ? '' : 'accent'}`.trim();
  }

  function renderHeader() {
    const team = state.team;
    const progress = team.progress;
    $('#team-name').textContent = team.name;
    $('#team-title').textContent = team.name;
    $('#progress-count').textContent = `${progress.played}/${progress.total}`;
    $('#progress-fill').style.width = `${
      progress.total ? Math.round((progress.played / progress.total) * 100) : 0
    }%`;
    $('#progress-label').textContent = t('team.progress', {
      done: progress.played,
      total: progress.total,
    });

    const online = team.players.filter((p) => p.online).length;
    const offline = team.players.length - online;
    const presence = $('#presence-label');
    presence.textContent = offline
      ? t('team.someOffline', { n: offline })
      : team.players.length
        ? t('team.allConnected')
        : t('admin.waitingPlayers');
    presence.classList.toggle('warn', offline > 0);
    statusBadge(state.session);
  }

  function renderRoster() {
    const team = state.team;
    $('#roster-count').textContent = t('team.connected', {
      n: team.players.filter((p) => p.online).length,
      total: team.players.length,
    });
    const host = clear($('#roster-host'));
    host.appendChild(
      C.rosterList(team.players, {
        round: state.round,
        showVotes: Boolean(state.round && state.round.status === 'open'),
      })
    );
  }

  function renderSealed() {
    const host = clear($('#sealed-host'));
    if (state.scoresVisible) return;
    host.appendChild(C.sealedNotice('team.scoresSealed'));
  }

  function renderHistory() {
    const host = clear($('#history-host'));
    host.appendChild(C.historyTable(state.history, { showScores: state.scoresVisible }));
  }

  /* --------------------------------------------------------------- la scène */

  function startPanel() {
    const next = state.nextEvent;
    if (!next) {
      return h('div', { class: 'stage-empty' }, [
        h('div', { class: 'eyebrow', text: t('admin.tableDone') }),
        h('h2', { text: t('team.done') }),
      ]);
    }

    const defaultSec = state.session.settings.defaultDuration || 300;
    const input = h('input', {
      type: 'number',
      id: 'duration',
      min: '0.5',
      max: '60',
      step: '0.5',
      value: String(toMinutes(defaultSec)),
    });

    return h('div', { class: 'panel' }, [
      h('div', { class: 'panel-head' }, [
        h('h2', { text: t('team.next') }),
        h('span', { class: 'badge accent', text: L(next.ref) }),
      ]),
      h('div', { class: 'team-title', text: L(next.title) }),
      h('div', { class: 'small muted', text: L(next.tag) }),
      h('div', { class: 'launch-row' }, [
        h('label', { class: 'field', style: 'margin:0' }, [
          h('span', { text: `${t('team.duration')} (min)` }),
          C.stepper(input),
        ]),
        h('button', {
          class: 'btn btn-primary',
          type: 'button',
          text: t('team.start'),
          onClick: () =>
            socket.callSafe('round:start', {
              eventId: next.id,
              durationSec: toSeconds(input.value) || defaultSec,
            }),
        }),
      ]),
    ]);
  }

  /** Bandeau d'égalité : le DG tranche, l'animateur peut suppléer. */
  function arbitrationPanel(round) {
    const tied = round.tied || [];
    const event = round.event;
    return h('div', { class: 'arb' }, [
      h('div', { class: 'row', style: 'gap:10px;align-items:center' }, [
        C.dgBadge(),
        h('div', { class: 'grow' }, [
          h('div', { style: 'font-weight:620', text: t('play.tie') }),
          h('div', {
            class: 'small',
            text: round.dgName ? t('play.tieWaitDg', { name: round.dgName }) : t('team.tieHint'),
          }),
        ]),
      ]),
      C.tallyBars(round.tally, { winners: tied }),
      h('div', { class: 'small muted', text: t('team.tieHint') }),
      h(
        'div',
        { class: 'arb-choices' },
        tied.map((key) => {
          const option = event ? event.options.find((o) => o.key === key) : null;
          return h('button', {
            class: 'btn btn-sm',
            type: 'button',
            text: option ? `${key} — ${L(option.label)}`.slice(0, 60) : key,
            onClick: () => socket.callSafe('round:arbitrate', { choice: key }),
          });
        })
      ),
      h('div', { class: 'small muted', text: t('team.arbitrateFor') }),
    ]);
  }

  function decisionPanel(round) {
    const event = round.event;
    const option = event && round.decision
      ? event.options.find((o) => o.key === round.decision)
      : null;
    return h('div', { class: 'panel' }, [
      h('div', { class: 'panel-head' }, [h('h2', { text: t('team.decisionTaken') })]),
      round.decision
        ? h('div', {}, [
            h('div', { class: 'row', style: 'gap:10px;align-items:baseline' }, [
              h('span', { class: 'choice-key', text: round.decision }),
              h('div', { class: 'team-title', style: 'font-size:1.05rem', text: L(option && option.label) }),
            ]),
            h('div', { class: 'small muted', text: C.decidedByText(round.decidedBy) }),
          ])
        : h('div', { class: 'small warn', text: t('play.noDecision') }),
      h('div', { style: 'margin-top:14px' }, [
        h('div', { class: 'meta-label', text: t('play.tally') }),
        C.tallyBars(round.tally, { decision: round.decision }),
      ]),
    ]);
  }

  function renderStage() {
    clear(stage);
    const round = state.round;

    if (!round) {
      shownRound = null;
      shownClosed = null;
      if (!state.team.rolesAssigned && state.team.players.length) {
        stage.appendChild(
          /* L'action est dans le bloc qui l'explique : l'animateur peut forcer
             le tirage sans attendre que la table soit au complet. */
          h('div', { class: 'stage-empty' }, [
            h('div', { class: 'pulse-dot' }),
            h('h2', { text: t('play.waitingRole') }),
            h('div', { class: 'small muted', text: t('team.waitingRoles') }),
            h('button', {
              class: 'btn btn-primary',
              type: 'button',
              text: t('team.assignNow'),
              onClick: () => socket.callSafe('team:assignRoles', {}),
            }),
          ])
        );
        return;
      }
      stage.appendChild(startPanel());
      return;
    }

    const isNew = shownRound !== round.no;
    shownRound = round.no;

    stage.appendChild(
      C.renderCard(round.event, {
        flipIn: isNew,
        selected: round.decision,
        revealed: round.status === 'closed' && Boolean(round.decision),
        winningKeys: round.decision ? [round.decision] : [],
        animateReveal: round.status === 'closed' && shownClosed !== round.no,
        promptKey: 'team.cardOptions',
      })
    );
    if (round.status === 'closed') shownClosed = round.no;

    if (round.status === 'arbitration') stage.appendChild(arbitrationPanel(round));
    else if (round.status === 'closed') stage.appendChild(decisionPanel(round));
    else {
      const pct = round.headcount
        ? Math.round((round.votedCount / round.headcount) * 100)
        : 0;
      stage.appendChild(
        h('div', { class: 'panel tight' }, [
          h('div', { class: 'row' }, [
            h('div', { class: 'grow' }, [
              h('div', { class: 'label', text: t('team.waitingVotes') }),
              h('div', {
                class: 'team-title',
                style: 'font-size:1.05rem',
                text: t('team.voted', { n: round.votedCount, total: round.headcount }),
              }),
            ]),
            h('span', {
              class: `badge ${pct === 100 ? 'green' : ''}`.trim(),
              text: `${pct} %`,
            }),
          ]),
          h('div', { class: 'progress-track', style: 'margin-top:10px' }, [
            h('i', { class: 'progress-fill', style: `width:${pct}%` }),
          ]),
        ])
      );
    }
  }

  /* ---------------------------------------------------------- barre de commandes */

  function renderDock() {
    const round = state.round;
    dock.classList.toggle('hidden', !round);
    clear(dockActions);
    if (!round) {
      timer.update(null);
      return;
    }

    const btn = (labelKey, event, payload, cls) =>
      h('button', {
        class: `btn btn-sm ${cls || ''}`.trim(),
        type: 'button',
        text: t(labelKey),
        onClick: () => socket.callSafe(event, payload || {}),
      });

    if (round.status === 'open') {
      dockActions.appendChild(btn('team.addTime', 'round:addTime', { seconds: 60 }));
      dockActions.appendChild(
        round.pausedAt ? btn('team.resume', 'round:resume') : btn('team.pause', 'round:pause')
      );
      dockActions.appendChild(btn('team.closeVote', 'round:close', {}, 'btn-primary'));
    } else if (round.status === 'closed') {
      dockActions.appendChild(btn('team.finish', 'round:finish', {}, 'btn-primary'));
    }

    if (round.status !== 'closed') {
      dockActions.appendChild(
        h('button', {
          class: 'btn btn-sm btn-ghost btn-danger',
          type: 'button',
          text: t('team.cancel'),
          onClick: () => {
            if (window.confirm(t('team.cancelConfirm'))) socket.callSafe('round:cancel', {});
          },
        })
      );
    }
    timer.update(round);
  }

  /* -------------------------------------------------------------- application */

  function render() {
    if (!state || !state.team) return;
    renderHeader();
    renderRoster();
    renderStage();
    renderDock();
    renderSealed();
    renderHistory();
  }

  function applyState(next) {
    state = next;
    render();
  }

  startTicker(() => {
    if (!state || !state.round) return;
    timer.update(state.round);
  });

  /* --------------------------------------------------------------- démarrage */

  window.I18N.onChange(() => render());

  (async function boot() {
    try {
      creds = await resolveCreds();
    } catch (err) {
      toast(err.message, 'error');
    }
    if (!creds) {
      stage.appendChild(
        h('div', { class: 'stage-empty' }, [
          h('h2', { text: t('err.team_not_found') }),
          h('a', { class: 'btn btn-primary', href: '/', text: t('nav.home') }),
        ])
      );
      return;
    }

    socket = connect(applyState, (payload) => {
      if (!payload || !payload.type) return;
      const message = t(`flash.${payload.type}`);
      if (message) toast(message, payload.type === 'round_tied' ? 'warn' : '');
    });

    /* La session vient d'être supprimée : cette console n'anime plus rien. */
    socket.on('session:deleted', () => {
      toast(t('err.session_deleted'), 'error');
      tableStore.remove(creds.teamId);
      setTimeout(() => {
        window.location.href = '/';
      }, 1800);
    });

    socket.on('connect', async () => {
      try {
        const res = await socket.call('teamAdmin:join', {
          sessionId: creds.sessionId,
          teamId: creds.teamId,
          adminToken: creds.adminToken,
        });
        applyState(res.state);
      } catch (err) {
        /* La session a disparu : on le dit clairement au lieu de renvoyer le
           « introuvable » du serveur, qui parle d'un code mal saisi. */
        const gone = err.code === 'session_not_found';
        toast(gone ? t('err.session_deleted') : err.message, 'error');
        if (gone || err.code === 'forbidden') {
          tableStore.remove(creds.teamId);
          setTimeout(() => {
            window.location.href = '/';
          }, 1800);
        }
      }
    });
  })();
})();
