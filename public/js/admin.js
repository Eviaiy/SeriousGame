/* Direction de jeu : toutes les tables, les codes animateur, le dévoilement. */
(function () {
  'use strict';

  const {
    $,
    h,
    clear,
    toast,
    superStore,
    t,
    L,
    fmtSigned,
    signClass,
    fmtTimeOnly,
    fmtClock,
    qs,
    svg,
    toMinutes,
    toSeconds,
    joinUrl,
    resolveOrigin,
    copyText,
    modal,
    startTicker,
    now,
  } = window.SG;
  const C = window.CARDS;

  window.SG.initChrome();

  /* -------------------------------------------------------- identification */

  const sessionId = qs('s');
  const urlKey = qs('k');
  let entry = sessionId ? superStore.find(sessionId) : null;

  if (sessionId && urlKey) {
    entry = { sessionId, superKey: urlKey, code: (qs('code') || '').toUpperCase(), name: '' };
    superStore.save(entry);
    // On retire la clé de l'URL pour éviter de la laisser visible au vidéoprojecteur.
    window.history.replaceState({}, '', `/admin.html?s=${encodeURIComponent(sessionId)}`);
  }

  if (!sessionId || !entry) {
    toast(t('err.forbidden'), 'error');
    setTimeout(() => {
      window.location.href = '/';
    }, 1200);
    return;
  }

  /* ------------------------------------------------------------------ état */

  let state = null;
  /** Rendus dépendants du temps, réexécutés à chaque tic. */
  const tickers = new Set();

  const socket = window.SG.connect(onState, onFlash);
  socket.on('connect', joinSession);

  /* Session supprimée depuis un autre appareil : il n'y a plus rien à diriger. */
  socket.on('session:deleted', () => {
    toast(t('err.session_deleted'), 'error');
    superStore.remove(sessionId);
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
      if (err.code === 'forbidden' || err.code === 'session_not_found') {
        superStore.remove(sessionId);
        setTimeout(() => {
          window.location.href = '/';
        }, 1600);
      }
    }
  }

  function onState(next) {
    state = next;
    superStore.save({
      sessionId,
      superKey: entry.superKey,
      code: next.session.code,
      name: next.session.name,
    });
    render();
  }

  function onFlash(payload) {
    if (payload && payload.type) toast(t(`flash.${payload.type}`));
  }

  const call = (event, payload) => socket.callSafe(event, payload);

  /* --------------------------------------------------------- accès des joueurs */

  let qrFor = null;

  const playerLink = (code) => joinUrl(code);

  function renderQr(url) {
    if (qrFor === url) return; // le QR ne dépend que du lien : inutile de le refaire à chaque état
    qrFor = url;
    const tile = clear($('#qr-tile'));
    try {
      tile.appendChild(window.QR.element(url, { label: t('admin.qrHint') }));
      tile.classList.remove('hidden');
    } catch (err) {
      tile.classList.add('hidden');
    }
  }

  /** Vue plein écran : le QR est fait pour être projeté ou tendu à la table. */
  function openQrModal() {
    const url = playerLink(state.session.code);
    const body = h('div', { class: 'qr-full' }, [
      h('div', { class: 'row' }, [
        h('div', { class: 'eyebrow', text: t('admin.qrTitle') }),
        h('div', { class: 'spacer' }),
        h('button', { class: 'btn btn-sm btn-ghost', type: 'button', text: '×', onClick: () => dialog.close() }),
      ]),
      h('div', { class: 'code-display', text: state.session.code }),
      h('div', { class: 'qr-canvas' }, [window.QR.element(url, { label: t('admin.qrTitle') })]),
      h('div', { class: 'join-url center', text: url }),
      h('p', { class: 'small muted center', text: t('admin.projectHint') }),
    ]);
    const dialog = modal(body);
  }

  /* --------------------------------------------------------------- entêtes */

  function renderHeader() {
    const s = state.session;
    $('#session-name').textContent = s.name;
    $('#session-code').textContent = s.code;
    renderQr(playerLink(s.code));

    const badge = $('#session-status');
    const key =
      s.status === 'finished'
        ? 'admin.status.finished'
        : s.status === 'running'
          ? 'admin.status.running'
          : 'admin.status.lobby';
    badge.textContent = t(key);
    badge.className = `badge ${s.status === 'finished' ? '' : 'accent'}`.trim();

    $('#m-tables').textContent = state.teams.length;
    $('#m-players').textContent = s.playerCount;
    $('#m-events').textContent = s.eventCount;
    $('#m-live').textContent = state.teams.filter(
      (team) => team.round && team.round.status !== 'closed'
    ).length;

    $('#btn-end-session').classList.toggle('hidden', s.status === 'finished');
    $('#btn-reopen').classList.toggle('hidden', s.status !== 'finished');
  }

  /* --------------------------------------------------------- suivi des tables */

  function teamTile(team) {
    const round = team.round;
    const progress = team.progress;
    const classes = ['team-tile'];
    if (round && round.status !== 'closed') classes.push('is-live');
    else if (progress.done) classes.push('is-done');

    const pct = progress.total ? Math.round((progress.played / progress.total) * 100) : 0;

    const statusBadge = round
      ? h('span', {
          class: `badge ${round.status === 'arbitration' ? 'warn' : 'accent'}`,
          text:
            round.status === 'arbitration'
              ? t('play.tie')
              : round.status === 'closed'
                ? t('play.closed')
                : t('admin.live'),
        })
      : h('span', {
          class: `badge ${progress.done ? 'green' : ''}`.trim(),
          text: progress.done ? t('admin.tableDone') : t('admin.idle'),
        });

    /* Le compte à rebours de chaque table doit suivre l'horloge, pas l'état. */
    const clock = h('span', { class: 'small muted' });
    if (round && round.status === 'open') {
      const paint = () => {
        clock.textContent = round.pausedAt
          ? t('play.paused')
          : fmtClock(Math.max(0, round.endsAt - now()));
      };
      paint();
      tickers.add(paint);
    }

    return h('div', { class: classes.join(' ') }, [
      h('div', { class: 'tile-head' }, [
        h('span', { class: 'team-title', text: team.name }),
        statusBadge,
      ]),
      /* Le décompte n'apparaît que pendant un vote : sinon la ligne resterait vide. */
      round && round.status === 'open'
        ? h('div', { class: 'tile-foot' }, [h('div', { class: 'spacer' }), clock])
        : null,
      h('div', { class: 'progress-track' }, [
        h('i', { class: 'progress-fill', style: `width:${pct}%` }),
      ]),
      h('div', { class: 'tile-foot' }, [
        h('span', {
          text: t('admin.progressOf', { done: progress.played, total: progress.total }),
        }),
        h('div', { class: 'spacer' }),
        h('span', { text: t('team.connected', { n: team.online, total: team.headcount }) }),
        h('i', { class: `live-dot${team.online ? ' on' : ''}` }),
      ]),
      /* Les médaillons donnent la composition d'un coup d'œil, sans les noms. */
      h(
        'div',
        { class: 'row tight', style: 'gap:6px;flex-wrap:wrap' },
        team.players.length
          ? team.players.map((p) => {
              const medal = C.roleMedal(p.role, 'sm');
              medal.setAttribute('title', `${p.name}${p.role ? ` — ${L(p.role.name)}` : ''}`);
              if (!p.online) medal.style.opacity = '0.45';
              return medal;
            })
          : [h('span', { class: 'small muted', text: t('admin.waitingPlayers') })]
      ),
      h('div', { class: 'row tight', style: 'gap:8px' }, [
        h('span', {
          class: `badge ${team.rolesAssigned ? 'green' : 'warn'}`,
          text: team.rolesAssigned ? t('admin.rolesDone') : t('admin.rolesPending'),
        }),
        h('div', { class: 'spacer' }),
        state.scoresVisible
          ? h('span', { class: `num ${signClass(team.total)}`, text: fmtSigned(team.total) })
          : h('span', { class: 'small muted', text: t('score.hidden') }),
        h('button', {
          class: 'btn btn-sm',
          type: 'button',
          text: t('admin.overview'),
          onClick: () => openTeamModal(team.id),
        }),
      ]),
    ]);
  }

  function renderTeams() {
    $('#tables-count').textContent = t('admin.tablesCount', { n: state.teams.length });
    const host = clear($('#teams-host'));
    if (!state.teams.length) {
      host.appendChild(h('p', { class: 'muted small', text: t('admin.noTables') }));
      return;
    }
    state.teams.forEach((team) => host.appendChild(teamTile(team)));
  }

  /* ------------------------------------------------- classement par événement */

  function renderRanks() {
    const host = clear($('#ranks-host'));
    if (!state.rankings.length) {
      host.appendChild(h('p', { class: 'muted small', text: t('admin.noRanks') }));
      return;
    }
    state.rankings.forEach((entryRank, index) => {
      const details = h('details', index === 0 ? { open: true } : {}, [
        h('summary', { class: 'label', style: 'cursor:pointer' }, [
          h('span', { text: `${L(entryRank.ref)} — ${L(entryRank.title)}` }),
        ]),
        h('div', { style: 'margin-top:10px' }, [C.eventRankTable(entryRank)]),
      ]);
      host.appendChild(details);
    });
  }

  /* ------------------------------------------------------------------ déroulé */

  /** Crayon d'édition : une icône, pour que « Lancer » reste la seule action nommée. */
  function pencil() {
    return svg(
      'svg',
      {
        viewBox: '0 0 24 24',
        width: 15,
        height: 15,
        fill: 'none',
        stroke: 'currentColor',
        'stroke-width': 1.7,
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
        'aria-hidden': 'true',
      },
      [
        svg('path', { d: 'M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L5 17v3z' }),
        svg('path', { d: 'M14.5 6.5l3 3' }),
      ]
    );
  }

  function renderDeck() {
    const host = clear($('#deck-host'));
    state.events.forEach((event, index) => {
      const idle = state.teams.filter((team) => !team.round);
      host.appendChild(
        h('div', { class: 'list-item deck-row' }, [
          h('span', { class: `badge ${event.color || 'red'}`, text: L(event.ref) }),
          h('div', { class: 'grow' }, [
            h('div', { class: 'title', text: L(event.title) }),
            h('div', {
              class: 'small muted',
              text: `${L(event.tag)} · ${t('admin.progressOf', {
                done: event.playedBy,
                total: state.teams.length,
              })}`,
            }),
          ]),
          h('div', { class: 'row-actions row-icons' }, [
            h('button', {
              class: 'btn btn-sm btn-ghost',
              type: 'button',
              title: t('admin.edit'),
              'aria-label': t('admin.edit'),
              onClick: () => openEventModal(event),
            }, [pencil()]),
            h('button', {
              class: 'btn btn-sm btn-ghost',
              type: 'button',
              text: '↑',
              title: t('admin.moveUp'),
              disabled: index === 0,
              onClick: () => call('super:moveEvent', { eventId: event.id, direction: -1 }),
            }),
            h('button', {
              class: 'btn btn-sm btn-ghost',
              type: 'button',
              text: '↓',
              title: t('admin.moveDown'),
              disabled: index === state.events.length - 1,
              onClick: () => call('super:moveEvent', { eventId: event.id, direction: 1 }),
            }),
            h('button', {
              class: 'btn btn-sm btn-ghost btn-danger',
              type: 'button',
              text: '×',
              title: t('admin.deleteEvent'),
              onClick: () => {
                if (window.confirm(t('admin.deleteEventConfirm'))) {
                  call('super:removeEvent', { eventId: event.id });
                }
              },
            }),
          ]),
          h('div', { class: 'row-actions row-main' }, [
            h('button', {
              class: 'btn btn-sm btn-primary',
              type: 'button',
              text: t('admin.launch'),
              disabled: !idle.length || state.session.status === 'finished',
              onClick: () => openLaunchModal(event),
            }),
          ]),
        ])
      );
    });
  }

  /** Lancer un événement sur une ou plusieurs tables au repos. */
  function openLaunchModal(event) {
    const body = h('div', { class: 'stack' });
    const dialog = modal(body);
    const idle = state.teams.filter((team) => !team.round);
    const boxes = idle.map((team) => {
      const input = h('input', { type: 'checkbox', checked: true });
      return { team, input };
    });
    const duration = h('input', {
      type: 'number',
      min: '1',
      max: '60',
      step: '1',
      value: String(toMinutes(state.session.settings.defaultDuration)),
    });

    body.appendChild(
      h('div', { class: 'panel-head' }, [
        h('h2', { text: `${t('admin.launch')} — ${L(event.title)}` }),
        h('div', { class: 'spacer' }),
        h('button', { class: 'btn btn-sm btn-ghost', text: '×', onClick: dialog.close }),
      ])
    );
    body.appendChild(
      h('label', { class: 'field' }, [
        h('span', { text: `${t('team.duration')} (min)` }),
        C.stepper(duration),
      ])
    );
    boxes.forEach(({ team, input }) => {
      body.appendChild(h('label', { class: 'checkline' }, [input, h('span', { text: team.name })]));
    });
    body.appendChild(
      h('div', { class: 'row', style: 'margin-top:8px' }, [
        h('button', {
          class: 'btn btn-primary',
          text: t('admin.launch'),
          onClick: async () => {
            const seconds = toSeconds(duration.value) || state.session.settings.defaultDuration;
            for (const { team, input } of boxes) {
              if (input.checked) {
                await call('round:start', {
                  teamId: team.id,
                  eventId: event.id,
                  durationSec: seconds,
                });
              }
            }
            dialog.close();
          },
        }),
        h('div', { class: 'spacer' }),
        h('button', { class: 'btn', text: t('btn.cancel'), onClick: dialog.close }),
      ])
    );
  }

  /* --------------------------------------------------------------- dévoilement */

  function renderReveal() {
    const host = clear($('#reveal-host'));
    const s = state.session;
    const pending = state.teams.filter((team) => !team.progress.done).length;

    if (s.revealed) {
      host.appendChild(
        h('div', { class: 'row', style: 'gap:10px;align-items:center' }, [
          h('span', { class: 'badge gold', text: t('admin.revealDone') }),
          h('span', { class: 'small muted', text: fmtTimeOnly(s.revealedAt) }),
        ])
      );
      return;
    }

    host.appendChild(C.sealedNotice('admin.revealHint'));
    host.appendChild(
      h('div', { class: 'row', style: 'margin-top:12px;gap:10px;align-items:center' }, [
        h('button', {
          class: 'btn btn-primary',
          type: 'button',
          text: t('admin.reveal'),
          onClick: () => {
            if (window.confirm(t('admin.revealConfirm'))) call('super:reveal');
          },
        }),
        pending
          ? h('span', { class: 'small warn', text: t('admin.revealNotReady', { n: pending }) })
          : h('span', { class: 'small muted', text: t('admin.tableDone') }),
      ])
    );
  }

  function renderBoard() {
    const host = clear($('#board-host'));
    /* Le classement vit dans la colonne latérale : la version détaillée y
       débordait et coupait la colonne « total ». Le détail acte par acte est
       dans le classement par événement et dans l'historique. */
    host.appendChild(C.leaderboardTable(state.leaderboard, { compact: true }));
  }

  /* ------------------------------------------------------------------ réglages */

  function renderSettings() {
    const s = state.session.settings;
    $('#set-duration').value = toMinutes(s.defaultDuration);
    $('#set-arbitration').value = toMinutes(s.arbitrationSeconds);
    $('#set-teamsize').value = s.teamSize;
    $('#set-autoassign').checked = Boolean(s.autoAssignRoles);
    $('#set-autoclose').checked = Boolean(s.autoCloseOnAllVotes);
    $('#set-allowchange').checked = Boolean(s.allowChangeVote);
    $('#set-latejoin').checked = Boolean(s.allowLateJoin);
  }

  function pushSettings() {
    call('super:updateSettings', {
      settings: {
        defaultDuration: toSeconds($('#set-duration').value) || 300,
        arbitrationSeconds: toSeconds($('#set-arbitration').value) || 90,
        teamSize: Number($('#set-teamsize').value) || 6,
        autoAssignRoles: $('#set-autoassign').checked,
        autoCloseOnAllVotes: $('#set-autoclose').checked,
        allowChangeVote: $('#set-allowchange').checked,
        allowLateJoin: $('#set-latejoin').checked,
      },
    });
  }

  function renderRoles() {
    const host = clear($('#roles-host'));
    host.appendChild(C.rolesGrid(state.roles));
  }

  function renderLog() {
    const host = clear($('#log-host'));
    state.log
      .slice()
      .reverse()
      .forEach((line) => {
        host.appendChild(
          h('div', { class: 'log-line' }, [
            h('span', { class: 't', text: fmtTimeOnly(line.ts) }),
            h('span', { text: t(`log.${line.type}`, line.params || {}) }),
          ])
        );
      });
  }

  /* --------------------------------------------------------------- rendu global */

  function render() {
    if (!state) return;
    tickers.clear();
    renderHeader();
    renderReveal();
    renderTeams();
    renderRanks();
    renderDeck();
    renderBoard();
    renderSettings();
    renderRoles();
    renderLog();
  }

  startTicker(() => {
    tickers.forEach((fn) => fn());
  });

  /* Les liens et les QR doivent porter une adresse joignable par les téléphones. */
  resolveOrigin(() => {
    qrFor = null;
    if (state) renderHeader();
  });

  /* ------------------------------------------------------- fiche d'une table */

  function openTeamModal(teamId) {
    const body = h('div', { class: 'stack' });
    /* La fiche suit l'état en direct : on la repeint à chaque diffusion, et on
       se désabonne quelle que soit la façon dont la modale se ferme. */
    const onPaint = () => paint();
    const dialog = modal(body, { onClose: () => socket.off('state', onPaint) });
    socket.on('state', onPaint);

    function paint() {
      const team = state.teams.find((x) => x.id === teamId);
      if (!team) return dialog.close();
      clear(body);

      body.appendChild(
        h('div', { class: 'panel-head' }, [
          h('h2', { text: team.name }),
          h('div', { class: 'spacer' }),
          h('button', { class: 'btn btn-sm btn-ghost', text: '×', onClick: () => dialog.close() }),
        ])
      );

      /* ------------------------------------------------------------ effectif */
      body.appendChild(h('div', { class: 'label', text: t('team.roster') }));
      body.appendChild(
        C.rosterList(team.players, {
          round: team.round,
          showVotes: Boolean(team.round && team.round.status === 'open'),
          /* Dans la fiche, chaque ligne porte deux commandes : en colonne
             unique le nom et le rôle tiennent sur une ligne. */
          single: true,
          onRemove: (player) => {
            if (window.confirm(t('admin.removePlayerConfirm', { name: player.name }))) {
              call('super:removePlayer', { playerId: player.id });
            }
          },
          onMove: (player) => openMoveModal(player, teamId),
        })
      );

      /* ------------------------------------------------- manche et arbitrage */
      if (team.round) {
        const round = team.round;
        const controls = [
          h('button', {
            class: 'btn btn-sm',
            text: t('team.addTime'),
            onClick: () => call('round:addTime', { teamId, seconds: 60 }),
          }),
          round.status === 'open'
            ? h('button', {
                class: 'btn btn-sm',
                text: round.pausedAt ? t('team.resume') : t('team.pause'),
                onClick: () => call(round.pausedAt ? 'round:resume' : 'round:pause', { teamId }),
              })
            : null,
          round.status === 'open'
            ? h('button', {
                class: 'btn btn-sm btn-primary',
                text: t('team.closeVote'),
                onClick: () => call('round:close', { teamId }),
              })
            : null,
          round.status === 'closed'
            ? h('button', {
                class: 'btn btn-sm btn-primary',
                text: t('team.finish'),
                onClick: () => call('round:finish', { teamId }),
              })
            : null,
          h('button', {
            class: 'btn btn-sm btn-ghost btn-danger',
            text: t('team.cancel'),
            onClick: () => {
              if (window.confirm(t('team.cancelConfirm'))) call('round:cancel', { teamId });
            },
          }),
        ].filter(Boolean);

        body.appendChild(
          h('div', { class: 'panel tight' }, [
            h('div', { class: 'row' }, [
              h('div', { class: 'grow' }, [
                h('div', { class: 'label', text: t('admin.live') }),
                h('div', {
                  class: 'team-title',
                  style: 'font-size:1rem',
                  text: L(round.event && round.event.title),
                }),
                h('div', {
                  class: 'small muted',
                  text: t('team.voted', { n: round.votedCount, total: round.headcount }),
                }),
              ]),
            ]),
            round.tally ? C.tallyBars(round.tally, { decision: round.decision, winners: round.tied }) : null,
            round.status === 'arbitration'
              ? h(
                  'div',
                  { class: 'arb-choices', style: 'margin-top:10px' },
                  (round.tied || []).map((key) =>
                    h('button', {
                      class: 'btn btn-sm',
                      text: `${t('team.arbitrateFor')} — ${key}`,
                      onClick: () => call('round:arbitrate', { teamId, choice: key }),
                    })
                  )
                )
              : null,
            h('div', { class: 'row tight', style: 'margin-top:10px;gap:8px;flex-wrap:wrap' }, controls),
          ])
        );
      }

      /* ---------------------------------------------------------- ajustements */
      const deltaInput = h('input', { type: 'number', value: '0', step: '1' });
      const reasonInput = h('input', { type: 'text', maxlength: '80' });
      body.appendChild(
        h('div', { class: 'panel tight' }, [
          h('div', { class: 'label', text: t('admin.adjust') }),
          h('div', { class: 'row', style: 'gap:8px;align-items:flex-end;flex-wrap:wrap' }, [
            h('label', { class: 'field', style: 'margin:0;width:110px' }, [
              h('span', { text: t('admin.adjustHint') }),
              deltaInput,
            ]),
            h('label', { class: 'field', style: 'margin:0;flex:1 1 160px' }, [
              h('span', { text: t('admin.reason') }),
              reasonInput,
            ]),
            h('button', {
              class: 'btn btn-sm',
              text: t('btn.add'),
              onClick: () => {
                const delta = Number(deltaInput.value);
                if (!delta) return;
                call('super:adjustScore', { teamId, delta, reason: reasonInput.value.trim() });
                deltaInput.value = '0';
                reasonInput.value = '';
              },
            }),
          ]),
          team.adjustments.length
            ? h(
                'div',
                { class: 'list', style: 'margin-top:10px' },
                team.adjustments.map((adj) =>
                  h('div', { class: 'list-item' }, [
                    h('span', { class: `num ${signClass(adj.delta)}`, text: fmtSigned(adj.delta) }),
                    h('div', { class: 'grow small', text: adj.reason || '—' }),
                    h('button', {
                      class: 'btn btn-xs btn-ghost btn-danger',
                      text: '×',
                      onClick: () =>
                        call('super:removeAdjustment', { teamId, adjustmentId: adj.id }),
                    }),
                  ])
                )
              )
            : null,
        ])
      );

      /* ------------------------------------------------ décisions et correction */
      body.appendChild(h('div', { class: 'label', text: t('team.history') }));
      body.appendChild(
        h(
          'div',
          { class: 'list' },
          team.history.length
            ? team.history.map((entryRow) => {
                const select = h(
                  'select',
                  {},
                  ['A', 'B', 'C'].map((key) =>
                    h('option', { value: key, text: key, selected: entryRow.decision === key })
                  )
                );
                return h('div', { class: 'list-item' }, [
                  h('div', { class: 'grow' }, [
                    h('div', { class: 'title', text: L(entryRow.eventTitle) }),
                    h('div', {
                      class: 'small muted',
                      text: `${entryRow.decision || t('score.noAnswer')} · ${C.decidedByText(
                        entryRow.decidedBy
                      )} · ${entryRow.tally.A}/${entryRow.tally.B}/${entryRow.tally.C}`,
                    }),
                  ]),
                  h('span', {
                    class: `num ${signClass(entryRow.total)}`,
                    text: fmtSigned(entryRow.total),
                  }),
                  select,
                  h('button', {
                    class: 'btn btn-xs',
                    text: t('admin.override'),
                    onClick: () =>
                      call('super:setDecision', {
                        teamId,
                        eventId: entryRow.eventId,
                        choice: select.value,
                      }),
                  }),
                ]);
              })
            : [h('p', { class: 'muted small', text: t('team.noHistory') })]
        )
      );

      return undefined;
    }

    paint();
  }

  function openMoveModal(player, fromTeamId) {
    const body = h('div', { class: 'stack' });
    const dialog = modal(body);
    body.appendChild(
      h('div', { class: 'panel-head' }, [
        h('h2', { text: `${t('admin.movePlayer')} — ${player.name}` }),
        h('div', { class: 'spacer' }),
        h('button', { class: 'btn btn-sm btn-ghost', text: '×', onClick: dialog.close }),
      ])
    );
    state.teams
      .filter((team) => team.id !== fromTeamId)
      .forEach((team) => {
        body.appendChild(
          h('button', {
            class: 'btn btn-block',
            type: 'button',
            text: `${team.name} — ${t('admin.playersCount', { n: team.headcount })}`,
            onClick: async () => {
              await call('super:movePlayer', { playerId: player.id, teamId: team.id });
              dialog.close();
            },
          })
        );
      });
    return dialog;
  }

  /* ------------------------------------------------------- éditeur d'événement */

  function openEventModal(event) {
    const isNew = !event;
    const body = h('div', { class: 'stack' });
    const dialog = modal(body);

    const src = event || {
      act: 1,
      round: 1,
      color: 'red',
      ref: { fr: '', en: '' },
      tag: { fr: '', en: '' },
      title: { fr: '', en: '' },
      situation: { fr: '', en: '' },
      motif: [],
      impact: [],
      tension: null,
      options: [
        { key: 'A', label: { fr: '', en: '' }, points: 0, reveal: null },
        { key: 'B', label: { fr: '', en: '' }, points: 2, reveal: null },
        { key: 'C', label: { fr: '', en: '' }, points: 4, reveal: null },
      ],
    };

    const f = {};

    function pair(labelKey, key, opts) {
      const tag = opts && opts.textarea ? 'textarea' : 'input';
      f[`${key}_fr`] = h(tag, { type: 'text', value: (src[key] && src[key].fr) || '' });
      f[`${key}_en`] = h(tag, { type: 'text', value: (src[key] && src[key].en) || '' });
      return h('div', {}, [
        h('div', { class: 'label', text: t(labelKey) }),
        h('div', { class: 'grid cols-2', style: 'gap:8px' }, [
          h('label', { class: 'field', style: 'margin:0' }, [
            h('span', { text: t('admin.frLabel') }),
            f[`${key}_fr`],
          ]),
          h('label', { class: 'field', style: 'margin:0' }, [
            h('span', { text: t('admin.enLabel') }),
            f[`${key}_en`],
          ]),
        ]),
      ]);
    }

    function listPair(labelKey, key) {
      const lines = (src[key] || []).map((item) => item.fr).join('\n');
      const linesEn = (src[key] || []).map((item) => item.en).join('\n');
      f[`${key}_fr`] = h('textarea', { text: lines });
      f[`${key}_en`] = h('textarea', { text: linesEn });
      return h('div', {}, [
        h('div', { class: 'label', text: t(labelKey) }),
        h('div', { class: 'grid cols-2', style: 'gap:8px' }, [
          h('label', { class: 'field', style: 'margin:0' }, [
            h('span', { text: t('admin.frLabel') }),
            f[`${key}_fr`],
          ]),
          h('label', { class: 'field', style: 'margin:0' }, [
            h('span', { text: t('admin.enLabel') }),
            f[`${key}_en`],
          ]),
        ]),
      ]);
    }

    const actSelect = h('select', {}, [
      h('option', { value: '1', text: t('admin.eventAct1'), selected: src.act === 1 }),
      h('option', { value: '2', text: t('admin.eventAct2'), selected: src.act === 2 }),
    ]);
    const roundInput = h('input', { type: 'number', min: '1', max: '9', value: src.round || 1 });
    const colorSelect = h(
      'select',
      {},
      ['red', 'orange', 'blue', 'gold'].map((color) =>
        h('option', { value: color, text: color, selected: src.color === color })
      )
    );

    const optionRows = ['A', 'B', 'C'].map((key) => {
      const option = (src.options || []).find((o) => o.key === key) || { key };
      f[`opt_${key}_label_fr`] = h('input', {
        type: 'text',
        value: (option.label && option.label.fr) || '',
      });
      f[`opt_${key}_label_en`] = h('input', {
        type: 'text',
        value: (option.label && option.label.en) || '',
      });
      f[`opt_${key}_points`] = h('input', {
        type: 'number',
        value: option.points != null ? option.points : 0,
      });
      f[`opt_${key}_reveal_fr`] = h('input', {
        type: 'text',
        value: (option.reveal && option.reveal.fr) || '',
      });
      f[`opt_${key}_reveal_en`] = h('input', {
        type: 'text',
        value: (option.reveal && option.reveal.en) || '',
      });

      return h('div', { class: 'panel tight' }, [
        h('div', { class: 'row' }, [h('span', { class: 'choice-key', text: key })]),
        h('div', { class: 'grid cols-2', style: 'gap:8px;margin-top:8px' }, [
          h('label', { class: 'field', style: 'margin:0' }, [
            h('span', { text: `${t('admin.optLabel')} · FR` }),
            f[`opt_${key}_label_fr`],
          ]),
          h('label', { class: 'field', style: 'margin:0' }, [
            h('span', { text: `${t('admin.optLabel')} · EN` }),
            f[`opt_${key}_label_en`],
          ]),
        ]),
        h('label', { class: 'field' }, [
          h('span', { text: t('admin.optPoints') }),
          f[`opt_${key}_points`],
        ]),
        h('div', { class: 'grid cols-2', style: 'gap:8px' }, [
          h('label', { class: 'field', style: 'margin:0' }, [
            h('span', { text: `${t('admin.optReveal')} · FR` }),
            f[`opt_${key}_reveal_fr`],
          ]),
          h('label', { class: 'field', style: 'margin:0' }, [
            h('span', { text: `${t('admin.optReveal')} · EN` }),
            f[`opt_${key}_reveal_en`],
          ]),
        ]),
      ]);
    });

    body.appendChild(
      h('div', { class: 'panel-head' }, [
        h('h2', { text: isNew ? t('admin.newEvent') : t('admin.editEvent') }),
        h('div', { class: 'spacer' }),
        h('button', { class: 'btn btn-sm btn-ghost', text: '×', onClick: dialog.close }),
      ])
    );
    body.appendChild(
      h('div', { class: 'grid cols-3', style: 'gap:8px' }, [
        h('label', { class: 'field', style: 'margin:0' }, [
          h('span', { text: t('admin.eventAct') }),
          actSelect,
        ]),
        h('label', { class: 'field', style: 'margin:0' }, [
          h('span', { text: t('admin.eventRound') }),
          roundInput,
        ]),
        h('label', { class: 'field', style: 'margin:0' }, [
          h('span', { text: t('admin.eventColor') }),
          colorSelect,
        ]),
      ])
    );
    body.appendChild(pair('admin.eventRef', 'ref'));
    body.appendChild(pair('admin.eventTag', 'tag'));
    body.appendChild(pair('admin.eventTitle', 'title'));
    body.appendChild(pair('admin.eventSituation', 'situation', { textarea: true }));
    body.appendChild(listPair('admin.eventMotif', 'motif'));
    body.appendChild(listPair('admin.eventImpact', 'impact'));
    body.appendChild(pair('admin.eventTension', 'tension'));
    body.appendChild(h('div', { class: 'label', text: t('admin.eventOptions') }));
    optionRows.forEach((row) => body.appendChild(row));

    body.appendChild(
      h('div', { class: 'row', style: 'margin-top:6px' }, [
        h('button', {
          class: 'btn btn-primary',
          text: t('btn.save'),
          onClick: async () => {
            const payload = buildPayload();
            const res = isNew
              ? await call('super:addEvent', { event: payload })
              : await call('super:updateEvent', { eventId: event.id, event: payload });
            if (res) dialog.close();
          },
        }),
        h('div', { class: 'spacer' }),
        h('button', { class: 'btn', text: t('btn.cancel'), onClick: dialog.close }),
      ])
    );

    function textPair(key) {
      const fr = f[`${key}_fr`].value.trim();
      const en = f[`${key}_en`].value.trim();
      if (!fr && !en) return null;
      return { fr: fr || en, en: en || fr };
    }

    function listOf(key) {
      const fr = f[`${key}_fr`].value.split('\n').map((s) => s.trim());
      const en = f[`${key}_en`].value.split('\n').map((s) => s.trim());
      const size = Math.max(fr.length, en.length);
      const out = [];
      for (let i = 0; i < size; i += 1) {
        const a = fr[i] || '';
        const b = en[i] || '';
        if (a || b) out.push({ fr: a || b, en: b || a });
      }
      return out;
    }

    function buildPayload() {
      const act = Number(actSelect.value) === 2 ? 2 : 1;
      return {
        act,
        round: Number(roundInput.value) || 1,
        color: colorSelect.value,
        ref:
          textPair('ref') || { fr: act === 1 ? 'Carte' : 'Étape', en: act === 1 ? 'Card' : 'Step' },
        tag: textPair('tag') || { fr: 'Événement', en: 'Event' },
        title: textPair('title') || { fr: 'Événement', en: 'Event' },
        situation: textPair('situation') || { fr: '', en: '' },
        motif: listOf('motif'),
        impact: listOf('impact'),
        tension: textPair('tension'),
        options: ['A', 'B', 'C'].map((key) => ({
          key,
          label: (function () {
            const fr = f[`opt_${key}_label_fr`].value.trim();
            const en = f[`opt_${key}_label_en`].value.trim();
            return { fr: fr || en || key, en: en || fr || key };
          })(),
          points: Number(f[`opt_${key}_points`].value) || 0,
          reveal: (function () {
            const fr = f[`opt_${key}_reveal_fr`].value.trim();
            const en = f[`opt_${key}_reveal_en`].value.trim();
            if (!fr && !en) return null;
            return { fr: fr || en, en: en || fr };
          })(),
        })),
      };
    }
  }

  /* --------------------------------------------------------- branchements UI */

  $('#copy-code').addEventListener('click', (e) => copyText(state.session.code, e.target));
  $('#copy-link').addEventListener('click', (e) => copyText(playerLink(state.session.code), e.target));
  $('#qr-tile').addEventListener('click', () => {
    if (state) openQrModal();
  });
  $('#btn-new-event').addEventListener('click', () => openEventModal(null));
  $('#btn-add-team').addEventListener('click', () => call('super:addTeam', {}));

  /* Les deux durées reçoivent les mêmes boutons ± que l'écran de lancement. */
  ['#set-duration', '#set-arbitration'].forEach((sel) => {
    const input = $(sel);
    input.parentNode.appendChild(C.stepper(input));
  });
  ['#set-duration', '#set-arbitration', '#set-teamsize'].forEach((sel) => {
    $(sel).addEventListener('change', pushSettings);
  });
  ['#set-autoassign', '#set-autoclose', '#set-allowchange', '#set-latejoin'].forEach((sel) => {
    $(sel).addEventListener('change', pushSettings);
  });

  $('#btn-end-session').addEventListener('click', async () => {
    if (!window.confirm(t('admin.endConfirm'))) return;
    const res = await call('super:endSession');
    if (res && res.recordId) {
      toast(t('flash.session_ended'));
    }
  });

  $('#btn-reopen').addEventListener('click', () => call('super:reopenSession'));

  window.I18N.onChange(() => render());
})();
