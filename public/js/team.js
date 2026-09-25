/* Console de l'animateur de table : il encadre une équipe, il ne vote pas. */
(function () {
  'use strict';

  const {
    $,
    h,
    clear,
    api,
    toast,
    tableStore,
    forgetSession,
    t,
    L,
    connect,
    startTicker,
    gameTitle,
    qs,
    toMinutes,
    toSeconds,
    joinUrl,
    resolveOrigin,
    copyText,
    modal,
  } = window.SG;
  const C = window.CARDS;

  window.SG.initChrome();
  resolveOrigin();

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

  function openPlayerQrModal() {
    if (!state || !state.team) return;
    const url = joinUrl(state.session.code, state.team.id);
    const title = t('admin.playerTableQrTitle', { table: state.team.name });
    const body = h('div', { class: 'qr-full' }, [
      h('div', { class: 'row' }, [
        h('div', { class: 'eyebrow', text: title }),
        h('div', { class: 'spacer' }),
        h('button', {
          class: 'btn btn-sm btn-ghost',
          type: 'button',
          text: '×',
          onClick: () => dialog.close(),
        }),
      ]),
      h('div', { class: 'team-title center', text: state.team.name }),
      h('div', { class: 'qr-canvas' }, [window.QR.element(url, { label: title })]),
      h('div', { class: 'join-url center', text: url }),
      h('p', { class: 'small muted center', text: t('admin.playerTableQrHint') }),
      h('button', {
        class: 'btn btn-sm',
        type: 'button',
        text: t('admin.playerTableQrCopy'),
        onClick: (e) => copyText(url, e.target),
      }),
    ]);
    const dialog = modal(body);
  }

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
    if (session.status === 'lobby') {
      badge.textContent = '';
      badge.className = 'hidden';
      return;
    }
    const key = session.status === 'finished' ? 'admin.status.finished' : 'admin.status.running';
    badge.textContent = t(key);
    badge.className = `badge ${session.status === 'finished' ? '' : 'accent'}`.trim();
  }

  function renderHeader() {
    const team = state.team;
    const progress = team.progress;
    $('#team-title').textContent = team.name;
    const host = $('#team-host');
    host.textContent = team.facilitatorName ? t('play.tableHost', { name: team.facilitatorName }) : '';
    host.classList.toggle('hidden', !team.facilitatorName);
    $('#table-game-name').textContent = gameTitle(state.session.name);
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
    const lastHistory = state.history && state.history[state.history.length - 1];
    const results = state.actResults || [];
    const result = results.slice(-1)[0];
    const isCurrentResult =
      !state.round &&
      result &&
      lastHistory &&
      Number(lastHistory.act) === Number(result.act);
    /* Un bloc de résultats vide gardait malgré tout sa marge supérieure entre
       la scène et la composition, ce qui doublait visuellement l'espacement. */
    host.classList.toggle('hidden', !isCurrentResult);
    if (isCurrentResult) {
      const overview = C.gameCompletedOverview(results);
      if (overview) host.appendChild(overview);
      results
        .slice()
        .sort((a, b) => Number(b.act) - Number(a.act))
        .forEach((entry) => host.appendChild(C.actResultCard(entry)));
    }
  }

  function renderHistory() {
    const host = clear($('#history-host'));
    host.appendChild(C.historyTable(state.history, { showScores: state.scoresVisible }));
  }

  /* --------------------------------------------------------------- la scène */

  function startPanel() {
    const next = state.nextEvent;
    if (!next) return null;

    const defaultSec = state.session.settings.defaultDuration || 360;
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
      const panel = startPanel();
      if (panel) stage.appendChild(panel);
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
    /* En fin de partie il n'y a plus de scène à afficher. La masquer retire
       aussi sa marge, afin de conserver le même intervalle entre les cartes. */
    stage.classList.toggle('hidden', stage.childElementCount === 0);
    renderDock();
    renderSealed();
    renderHistory();
  }

  function applyState(next) {
    state = next;
    render();
    if (state && state.team && !state.team.facilitatorName) askName();
  }

  /* Arrivé par le QR ou le lien de la table, l'animateur n'a pas encore donné
     son nom : on le lui demande une fois, sans pouvoir l'ignorer. */
  let nameDialog = null;
  function askName() {
    if (nameDialog) return;
    const input = h('input', { type: 'text', maxlength: '40', autocomplete: 'name' });
    try {
      input.value = localStorage.getItem('sg.hostName') || '';
    } catch (err) {
      /* ignore */
    }
    const submit = async (event) => {
      event.preventDefault();
      const name = input.value.trim();
      if (!name) {
        input.focus();
        return;
      }
      const res = await socket.callSafe('teamAdmin:setName', { name });
      if (!res) return;
      try {
        localStorage.setItem('sg.hostName', name);
      } catch (err) {
        /* ignore */
      }
      const dialog = nameDialog;
      nameDialog = null;
      dialog.close();
    };
    const form = h('form', { class: 'stack', autocomplete: 'off' }, [
      h('h2', { text: t('team.askNameTitle') }),
      h('p', { class: 'small muted', style: 'margin:0', text: t('team.askNameHint') }),
      h('label', { class: 'field', style: 'margin:0' }, [
        h('span', { text: t('home.facilitatorName') }),
        input,
      ]),
      h('button', { class: 'btn btn-primary btn-block', type: 'submit', text: t('btn.save') }),
    ]);
    form.addEventListener('submit', submit);
    nameDialog = window.SG.modal(form, {
      /* Fermé sans nom (Échap, clic à côté) : on redemande au prochain état. */
      onClose: () => {
        nameDialog = null;
      },
    });
    input.focus();
  }

  startTicker(() => {
    if (!state || !state.round) return;
    timer.update(state.round);
  });

  /* --------------------------------------------------------------- démarrage */

  window.I18N.onChange(() => render());
  $('#btn-player-qr').addEventListener('click', openPlayerQrModal);

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
      if (payload.type === 'twist') {
        let dialog;
        dialog = window.SG.modal(C.twistCard(payload, { onClose: () => dialog.close() }));
        return;
      }
      const message = t(`flash.${payload.type}`);
      if (message) toast(message, payload.type === 'round_tied' ? 'warn' : '');
    });

    /* La session vient d'être supprimée : cette console n'anime plus rien. */
    socket.on('session:deleted', () => {
      toast(t('err.session_deleted'), 'error');
      forgetSession(creds.sessionId);
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
