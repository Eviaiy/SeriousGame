/* Poste d'un joueur : son rôle, son vote, l'arbitrage s'il est DG. */
(function () {
  'use strict';

  const { $, h, clear, toast, playerStore, LS, t, L, connect, startTicker, qs } = window.SG;
  const C = window.CARDS;

  window.SG.initChrome();

  const stage = $('#stage');
  const dock = $('#dock');
  const timer = C.createTimer();
  $('#dock-timer').appendChild(timer.node);

  const NARRATIVE_SEEN = 'sg.narrative.seen';
  const NARRATIVE_KEEP = 40;

  /* L'acquittement du récit se retient joueur par joueur : deux joueurs peuvent
     partager un navigateur (téléphone prêté, poste de démonstration) et chacun
     doit lire la mise en situation avant de jouer. */
  function seenKey() {
    return `${creds.sessionId}:${creds.playerId}`;
  }

  function seenList() {
    const saved = LS.get(NARRATIVE_SEEN, []);
    return Array.isArray(saved) ? saved.filter((k) => typeof k === 'string') : [];
  }

  function markSeen() {
    const key = seenKey();
    LS.set(NARRATIVE_SEEN, [key, ...seenList().filter((k) => k !== key)].slice(0, NARRATIVE_KEEP));
  }

  let socket = null;
  let state = null;
  let creds = null;
  let shownRound = null;
  let shownClosed = null;
  let narrativeDone = false;

  /* ------------------------------------------------------------ identification */

  function resolveCreds() {
    const playerId = qs('p');
    if (playerId) {
      const saved = playerStore.find(playerId);
      if (saved) return saved;
    }
    return playerStore.latest();
  }

  /* ------------------------------------------------------------------ entête */

  function renderHeader() {
    const badge = $('#team-badge');
    badge.textContent = state.team.name;
    badge.className = 'badge accent';
  }

  /* --------------------------------------------------------- récit d'ouverture */

  function renderNarrative() {
    const host = clear($('#narrative-host'));
    /* Chaque joueur referme le récit lui-même : il reste affiché jusqu'à son
       clic, même si la table a déjà lancé un événement — sinon un joueur arrivé
       après le lancement n'aurait jamais lu la mise en situation. */
    if (narrativeDone || state.session.status === 'finished') return;
    host.appendChild(
      C.narrativeBlock(state.narrative, {
        onReady: () => {
          narrativeDone = true;
          markSeen();
          renderNarrative();
        },
      })
    );
  }

  /* ------------------------------------------------------------------ mon rôle */

  function renderRole() {
    const host = clear($('#role-host'));
    host.appendChild(
      C.roleHero(state.me && state.me.role, {
        eyebrow: t('play.myRole'),
        folded: Boolean(state.round),
      })
    );
  }

  function renderRoster() {
    $('#roster-count').textContent = t('team.connected', {
      n: state.team.players.filter((p) => p.online).length,
      total: state.team.players.length,
    });
    const host = clear($('#roster-host'));
    host.appendChild(
      C.rosterList(state.team.players, {
        round: state.round,
        showVotes: Boolean(state.round && state.round.status !== 'closed'),
      })
    );
  }

  /* ------------------------------------------------------------------ la scène */

  function waitingPanel() {
    if (state.session.status === 'finished') {
      return h('div', { class: 'stage-empty' }, [
        h('h2', { text: t('play.sessionEnded') }),
      ]);
    }
    if (!state.team.rolesAssigned) {
      return h('div', { class: 'stage-empty' }, [
        h('div', { class: 'pulse-dot' }),
        h('h2', { text: t('play.waitingRole') }),
        h('div', { class: 'small muted', text: t('play.waitingRoleHint') }),
      ]);
    }
    return h('div', { class: 'stage-empty' }, [
      h('div', { class: 'pulse-dot' }),
      h('h2', { text: t('play.waiting') }),
      h('div', { class: 'small muted', text: t('play.waitingHint') }),
    ]);
  }

  /** Le DG tranche l'égalité ; les autres attendent sa décision. */
  function arbitrationPanel(round) {
    const tied = round.tied || [];
    const event = round.event;
    const mine = state.isDg;
    return h('div', { class: 'arb' }, [
      h('div', { class: 'row', style: 'gap:10px;align-items:center' }, [
        C.dgBadge(),
        h('div', { class: 'grow' }, [
          h('div', { style: 'font-weight:620', text: t('play.tie') }),
          h('div', {
            class: 'small',
            text: mine ? t('play.tieYouDecide') : t('play.tieWaitDg', { name: round.dgName || '' }),
          }),
        ]),
      ]),
      C.tallyBars(round.tally, { winners: tied }),
      mine
        ? h(
            'div',
            { class: 'arb-choices' },
            tied.map((key) => {
              const option = event ? event.options.find((o) => o.key === key) : null;
              return h('button', {
                class: 'btn btn-sm btn-primary',
                type: 'button',
                text: option ? `${key} — ${L(option.label)}` : key,
                onClick: () => socket.callSafe('player:arbitrate', { choice: key }),
              });
            })
          )
        : null,
    ]);
  }

  function decisionPanel(round) {
    const event = round.event;
    const option =
      event && round.decision ? event.options.find((o) => o.key === round.decision) : null;
    return h('div', { class: 'panel' }, [
      h('div', { class: 'panel-head' }, [h('h2', { text: t('play.decision') })]),
      round.decision
        ? h('div', {}, [
            h('div', { class: 'row', style: 'gap:10px;align-items:baseline' }, [
              h('span', { class: 'choice-key', text: round.decision }),
              h('div', {
                class: 'team-title',
                style: 'font-size:1.05rem',
                text: L(option && option.label),
              }),
            ]),
            h('div', { class: 'small muted', text: C.decidedByText(round.decidedBy) }),
          ])
        : h('div', { class: 'small warn', text: t('play.noDecision') }),
      h('div', { style: 'margin-top:14px' }, [
        h('div', { class: 'meta-label', text: t('play.tally') }),
        C.tallyBars(round.tally, { decision: round.decision }),
      ]),
      state.scoresVisible && round.score
        ? h('div', { class: 'center', style: 'margin-top:14px' }, [
            C.deltaChip(round.score.total, 'score.points'),
          ])
        : null,
    ]);
  }

  /** Le vote est-il encore ouvert pour ce joueur ? */
  function voteOpen(round) {
    return Boolean(
      round &&
        round.status === 'open' &&
        !round.pausedAt &&
        (!round.myVote || state.session.settings.allowChangeVote)
    );
  }

  function renderStage() {
    clear(stage);
    const round = state.round;

    if (!round) {
      shownRound = null;
      shownClosed = null;
      /* Le bloc rôle porte déjà cet état : ne pas répéter le même message dans
         une carte d'attente temporaire. */
      if (!state.team.rolesAssigned) return;
      const lastHistory = state.history && state.history[state.history.length - 1];
      const results = state.actResults || [];
      const result = results.slice(-1)[0];
      if (result && lastHistory && Number(lastHistory.act) === Number(result.act)) {
        const overview = C.gameCompletedOverview(results);
        if (overview) stage.appendChild(overview);
        results
          .slice()
          .sort((a, b) => Number(b.act) - Number(a.act))
          .forEach((entry) => stage.appendChild(C.actResultCard(entry)));
        return;
      }
      if (state.team.progress.done) return;
      stage.appendChild(waitingPanel());
      return;
    }

    const isNew = shownRound !== round.no;
    shownRound = round.no;
    const closed = round.status === 'closed';
    const canVote = voteOpen(round);

    stage.appendChild(
      C.renderCard(round.event, {
        flipIn: isNew,
        interactive: canVote,
        disabled: !canVote,
        selected: round.myVote || (closed ? round.decision : null),
        /* Le barème n'apparaît qu'une fois les scores dévoilés : sinon on
           voterait pour les points, pas pour la décision. */
        showPoints: state.scoresVisible,
        revealed: closed && Boolean(round.decision),
        winningKeys: closed && round.decision ? [round.decision] : [],
        animateReveal: closed && shownClosed !== round.no,
        /* La carte demande toujours la même chose ; la confirmation du vote
           vit dans la barre du bas, pas dans l'énoncé. */
        promptKey: 'play.chooseNow',
        onChoose: (key) => socket.callSafe('player:vote', { choice: key }),
      })
    );
    if (closed) shownClosed = round.no;

    if (round.status === 'arbitration') stage.appendChild(arbitrationPanel(round));
    else if (closed) stage.appendChild(decisionPanel(round));
    else {
      const waiting = Math.max(0, round.headcount - round.votedCount);
      stage.appendChild(
        h('div', { class: 'panel tight' }, [
          h('div', {
            class: 'team-title',
            style: 'font-size:1.05rem',
            text: waiting ? t('play.waitingOthers', { n: waiting }) : t('play.allVoted'),
          }),
          h('p', { class: 'small muted', style: 'margin:4px 0 0', text: t('play.voteHint') }),
        ])
      );
    }
  }

  /* --------------------------------------------------------------- barre de vote */

  /* Le DG tranche depuis la barre : sur téléphone, le panneau d'arbitrage se
     trouve sous la carte et sortait du champ de vision pendant le décompte. */
  function renderDockActions(round) {
    const host = clear($('#dock-actions'));
    const arbitrating = round.status === 'arbitration' && state.isDg;
    dock.classList.toggle('has-actions', arbitrating);
    if (!arbitrating) return;
    const event = round.event;
    (round.tied || []).forEach((key) => {
      const option = event ? event.options.find((o) => o.key === key) : null;
      const label = option ? `${key} — ${L(option.label)}` : key;
      host.appendChild(
        h('button', {
          class: 'btn btn-sm btn-primary',
          type: 'button',
          text: key,
          title: label,
          'aria-label': label,
          onClick: () => socket.callSafe('player:arbitrate', { choice: key }),
        })
      );
    });
  }

  /* Les réponses dans la barre : sur téléphone, la carte est plus haute que
     l'écran et voter obligeait à quitter des yeux l'énoncé et le chrono. La
     feuille de style les affiche sur téléphone seulement, et masque alors les
     mêmes boutons dans la carte pour ne pas les proposer deux fois. */
  function renderDockChoices(round) {
    const host = clear($('#dock-choices'));
    const options = (round.event && round.event.options) || [];
    const open = voteOpen(round);
    document.body.classList.toggle('dock-vote', open && options.length > 0);
    if (!open) return;
    options.forEach((option) => {
      const chosen = round.myVote === option.key;
      host.appendChild(
        h(
          'button',
          {
            class: `dock-choice${chosen ? ' selected' : ''}`,
            type: 'button',
            'aria-pressed': String(chosen),
            onClick: () => socket.callSafe('player:vote', { choice: option.key }),
          },
          [
            h('span', { class: 'choice-key', text: option.key }),
            h('span', { class: 'dock-choice-label', text: L(option.label) }),
            chosen ? h('span', { class: 'choice-check', text: '✓' }) : null,
          ].filter(Boolean)
        )
      );
    });
  }

  /* La page réserve la hauteur de la barre : elle change selon qu'elle porte
     les réponses, une seule ligne d'état ou les boutons de départage. */
  function syncDockPad() {
    const height = dock.classList.contains('hidden') ? 0 : dock.offsetHeight;
    document.documentElement.style.setProperty('--dock-pad', `${Math.round(height) + 28}px`);
  }

  function renderDock() {
    const round = state.round;
    dock.classList.toggle('hidden', !round);
    if (!round) {
      timer.update(null);
      document.body.classList.remove('dock-vote');
      clear($('#dock-choices'));
      syncDockPad();
      return;
    }
    const badge = $('#dock-badge');
    const hint = $('#dock-hint');
    $('#dock-question').textContent = L(round.event && round.event.title);
    renderDockActions(round);
    renderDockChoices(round);

    if (round.status === 'arbitration') {
      /* Sur téléphone la barre est étroite : un titre court et une consigne
         courte, le détail reste dans le panneau d'arbitrage de la page. */
      $('#dock-question').textContent = t('play.tie');
      badge.textContent = '';
      badge.className = 'badge hidden';
      hint.textContent = state.isDg ? t('play.tieDockDg') : t('play.tieDockWait');
    } else if (round.status === 'closed') {
      badge.textContent = t('play.closed');
      badge.className = 'badge';
      hint.textContent = round.decision
        ? `${round.decision} · ${C.decidedByText(round.decidedBy)}`
        : t('play.noDecision');
    } else if (round.myVote) {
      badge.textContent = `${t('play.sent')} · ${round.myVote}`;
      badge.className = 'badge green';
      hint.textContent = t('play.voted');
    } else {
      badge.textContent = t('play.yourCall');
      badge.className = 'badge accent';
      hint.textContent = t('play.chooseNow');
    }
    timer.update(round);
    syncDockPad();
  }

  /* -------------------------------------------------------------- application */

  function render() {
    if (!state || !state.team) return;
    renderHeader();
    renderNarrative();
    renderRole();
    renderStage();
    renderDock();
    renderRoster();
  }

  function applyState(next) {
    state = next;
    render();
  }

  startTicker(() => {
    if (!state || !state.round) return;
    timer.update(state.round);
  });

  /* Rotation de l'écran ou clavier refermé : la barre change de hauteur. */
  window.addEventListener('resize', syncDockPad);

  $('#btn-leave').addEventListener('click', () => {
    if (!window.confirm(t('play.leaveConfirm'))) return;
    if (creds) playerStore.remove(creds.playerId);
    window.location.href = '/';
  });

  window.I18N.onChange(() => render());

  /* --------------------------------------------------------------- démarrage */

  (function boot() {
    const code = (qs('code') || '').toUpperCase();
    /* Compatibilité avec les anciens liens /play.html?code=… : leur intention
       d'inscription prime sur le dernier joueur mémorisé dans ce navigateur. */
    if (code) {
      const table = qs('t');
      const query = `?code=${encodeURIComponent(code)}${
        table ? `&t=${encodeURIComponent(table)}` : ''
      }`;
      window.location.replace(`/${query}`);
      return;
    }
    creds = resolveCreds();
    if (!creds) {
      window.location.replace('/');
      return;
    }
    narrativeDone = seenList().includes(seenKey());

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

    /* La direction a supprimé la session : la partie n'existe plus. */
    socket.on('session:deleted', () => {
      toast(t('err.session_deleted'), 'error');
      playerStore.remove(creds.playerId);
      setTimeout(() => {
        window.location.href = '/';
      }, 1800);
    });

    socket.on('connect', async () => {
      try {
        const res = await socket.call('player:join', {
          sessionId: creds.sessionId,
          playerId: creds.playerId,
          playerToken: creds.playerToken,
        });
        applyState(res.state);
      } catch (err) {
        /* Une session effacée n'est pas un code mal tapé : le joueur mérite de
           savoir que la partie n'existe plus. */
        const gone = err.code === 'session_not_found';
        toast(gone ? t('err.session_deleted') : err.message, 'error');
        if (gone || err.code === 'player_not_found') {
          playerStore.remove(creds.playerId);
          setTimeout(() => {
            window.location.href = '/';
          }, 1800);
        }
      }
    });
  })();
})();
