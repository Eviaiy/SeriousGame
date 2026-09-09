/* Console animateur : pilotage des événements, chrono, scores, archivage. */
(function () {
  'use strict';

  const {
    $,
    h,
    clear,
    api,
    toast,
    adminStore,
    t,
    L,
    fmtSigned,
    signClass,
    fmtClock,
    fmtTimeOnly,
    qs,
    joinUrl,
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
  let entry = sessionId ? adminStore.find(sessionId) : null;

  if (sessionId && urlKey) {
    entry = { sessionId, adminKey: urlKey, code: (qs('code') || '').toUpperCase(), name: '' };
    adminStore.save(entry);
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
  let pendingDuration = null;
  const timer = C.createTimer();

  const socket = window.SG.connect(onState, onFlash);
  socket.on('connect', joinSession);

  async function joinSession() {
    try {
      const res = await socket.call('admin:join', {
        sessionId,
        adminKey: entry.adminKey,
      });
      onState(res.state);
    } catch (err) {
      toast(err.message, 'error');
      if (err.code === 'forbidden' || err.code === 'session_not_found') {
        adminStore.remove(sessionId);
        setTimeout(() => {
          window.location.href = '/';
        }, 1600);
      }
    }
  }

  function onState(next) {
    state = next;
    adminStore.save({
      sessionId,
      adminKey: entry.adminKey,
      code: next.session.code,
      name: next.session.name,
    });
    render();
  }

  function onFlash(payload) {
    if (payload && payload.type) toast(t(`flash.${payload.type}`));
  }

  const call = (event, payload) => socket.callSafe(event, payload);

  /* --------------------------------------------------------------- entêtes */

  function renderHeader() {
    const s = state.session;
    $('#session-name').textContent = s.name;
    $('#session-code').textContent = s.code;
    $('#join-link').textContent = joinUrl(s.code);

    const badge = $('#session-status');
    badge.textContent = t(`admin.status.${s.status}`);
    badge.className = `badge ${s.status === 'running' ? 'green' : s.status === 'finished' ? 'red' : 'gold'}`;

    $('#m-teams').textContent = state.teams.length;
    $('#m-events').textContent = `${state.history.length}/${state.events.length}`;

    const round = state.round;
    $('#m-answers').textContent = round
      ? `${round.answeredCount}/${round.teamCount}`
      : '—';

    $('#btn-end-session').classList.toggle('hidden', s.status === 'finished');
    $('#btn-reopen').classList.toggle('hidden', s.status !== 'finished');

    const roundBadge = $('#round-badge');
    if (!round) {
      roundBadge.textContent = '';
      roundBadge.className = 'badge hidden';
    } else {
      roundBadge.className = `badge ${round.status === 'open' ? 'green' : 'gold'}`;
      roundBadge.textContent = `#${round.no} · ${
        round.status === 'open' ? t('play.timeLeft') : round.revealed ? t('flash.round_revealed') : t('play.locked')
      }`;
    }
  }

  /* ------------------------------------------------------- événement en cours */

  function renderCurrent() {
    const host = clear($('#current-host'));
    const round = state.round;

    if (!round) {
      host.appendChild(h('p', { class: 'muted', text: t('admin.noCurrent') }));
      return;
    }

    const winningKeys = (round.results || [])
      .filter((r) => (round.winners || []).includes(r.teamId))
      .map((r) => r.choice)
      .filter(Boolean);

    host.appendChild(
      C.renderCard(round.event, {
        interactive: false,
        showPoints: true,
        revealed: round.revealed,
        winningKeys,
      })
    );

    /* --- chrono + commandes --- */
    const controls = h('div', { class: 'row', style: 'margin-top:6px' });
    if (round.status === 'open') {
      controls.appendChild(
        h('button', {
          class: 'btn btn-sm',
          text: round.pausedAt ? t('admin.resume') : t('admin.pause'),
          onClick: () => call(round.pausedAt ? 'admin:resumeRound' : 'admin:pauseRound'),
        })
      );
      controls.appendChild(
        h('button', {
          class: 'btn btn-sm',
          text: t('admin.lessTime'),
          onClick: () => call('admin:addTime', { seconds: -30 }),
        })
      );
      controls.appendChild(
        h('button', {
          class: 'btn btn-sm',
          text: t('admin.addTime'),
          onClick: () => call('admin:addTime', { seconds: 30 }),
        })
      );
      controls.appendChild(
        h('button', {
          class: 'btn btn-sm btn-primary',
          text: t('admin.close'),
          onClick: () => call('admin:closeRound'),
        })
      );
    } else {
      if (!round.revealed) {
        controls.appendChild(
          h('button', {
            class: 'btn btn-sm btn-primary',
            text: t('admin.reveal'),
            onClick: () => call('admin:reveal'),
          })
        );
      } else {
        controls.appendChild(
          h('button', {
            class: 'btn btn-sm btn-primary',
            text: t('admin.next'),
            onClick: () => call('admin:finishRound'),
          })
        );
      }
      controls.appendChild(
        h('button', {
          class: 'btn btn-sm btn-danger',
          text: t('admin.cancelRound'),
          onClick: () => {
            if (window.confirm(t('admin.cancelRound') + ' ?')) call('admin:cancelRound');
          },
        })
      );
    }

    host.appendChild(
      h('div', { class: 'panel tight', style: 'margin-top:14px' }, [
        h('div', { class: 'timer-wrap' }, [
          h('div', { style: 'min-width:160px;flex:1 1 200px' }, [timer.node]),
          h('div', { class: 'stack', style: 'flex:2 1 320px;gap:8px' }, [
            h('div', { class: 'label', text: t('play.answers') }),
            C.answerChips(round, { showSeconds: true }),
          ]),
        ]),
        controls,
      ])
    );
    timer.update(round);

    /* --- résultats --- */
    if (round.status === 'closed') {
      const banner = C.winnerBanner(round);
      const block = h('div', { class: 'stack', style: 'margin-top:14px' }, [
        banner,
        h('div', { class: 'label', text: t('play.results') }),
        C.resultsTable(round),
      ]);
      host.appendChild(block);
    }
  }

  /* ---------------------------------------------------------------- déroulé */

  function renderDeck() {
    const host = clear($('#deck-host'));
    const running = Boolean(state.round && state.round.status === 'open');

    for (const event of state.events) {
      const classes = ['list-item'];
      if (event.current) classes.push('current');
      else if (event.played) classes.push('played');

      const badges = h('div', { class: 'row tight' }, [
        h('span', {
          class: `badge ${event.act === 2 ? 'blue' : event.color === 'orange' ? 'orange' : 'red'}`,
          text: `${t('admin.eventAct')} ${event.act}`,
        }),
        event.played ? h('span', { class: 'badge green', text: '✓' }) : null,
        event.current ? h('span', { class: 'badge gold', text: t('admin.current') }) : null,
      ]);

      const actions = h('div', { class: 'row tight' }, [
        h('button', {
          class: 'btn btn-xs btn-ghost',
          text: '↑',
          onClick: () => call('admin:moveEvent', { eventId: event.id, direction: -1 }),
        }),
        h('button', {
          class: 'btn btn-xs btn-ghost',
          text: '↓',
          onClick: () => call('admin:moveEvent', { eventId: event.id, direction: 1 }),
        }),
        h('button', {
          class: 'btn btn-xs',
          text: t('admin.edit'),
          onClick: () => openEventModal(event),
        }),
        h('button', {
          class: 'btn btn-xs btn-danger',
          text: '×',
          title: t('admin.deleteEvent'),
          onClick: () => {
            if (window.confirm(t('admin.deleteEventConfirm'))) {
              call('admin:removeEvent', { eventId: event.id });
            }
          },
        }),
        h('button', {
          class: `btn btn-xs ${event.played ? '' : 'btn-primary'}`,
          text: event.played ? t('admin.relaunch') : t('admin.launch'),
          disabled: running || state.session.status === 'finished',
          onClick: () => launch(event),
        }),
      ]);

      host.appendChild(
        h('div', { class: classes.join(' ') }, [
          h('div', { class: 'grow' }, [
            h('div', { class: 'title', text: L(event.title) }),
            h('div', { class: 'small muted', text: `${L(event.ref)} · ${L(event.tag)}` }),
          ]),
          badges,
          actions,
        ])
      );
    }
  }

  function launch(event) {
    const duration = Number($('#launch-duration').value) || state.session.settings.defaultDuration;
    if (event.played) {
      if (!window.confirm(t('admin.replayConfirm'))) return;
      call('admin:replayEvent', { eventId: event.id, durationSec: duration });
    } else {
      call('admin:startRound', { eventId: event.id, durationSec: duration });
    }
  }

  /* ------------------------------------------------------------- historique */

  function renderHistory() {
    const host = clear($('#history-host'));
    if (!state.history.length) {
      host.appendChild(h('p', { class: 'muted small', text: t('admin.noHistory') }));
      return;
    }

    for (const item of state.history.slice().reverse()) {
      const details = h('details', { class: 'list-item', style: 'display:block' });
      const winners = item.winnerNames.length ? item.winnerNames.join(' · ') : t('play.noWinner');
      details.appendChild(
        h('summary', { style: 'cursor:pointer' }, [
          h('span', { class: 'title', text: `#${item.no} ${L(item.title)}` }),
          h('span', { class: 'muted small', text: ` — ${t('admin.winnerOf')} : ${winners}` }),
        ])
      );
      details.appendChild(
        h('div', { style: 'margin-top:10px' }, [
          C.resultsTable({ results: item.results, winners: item.winners, revealed: true }),
        ])
      );
      host.appendChild(details);
    }
  }

  /* -------------------------------------------------------------- classement */

  function renderBoard() {
    const host = clear($('#board-host'));
    host.appendChild(C.leaderboardTable(state.leaderboard, {}));
  }

  /* ------------------------------------------------------------------ équipes */

  function renderTeams() {
    const host = clear($('#teams-host'));
    $('#teams-count').textContent = t('admin.teamsCount', { n: state.teams.length });

    if (!state.teams.length) {
      host.appendChild(h('p', { class: 'muted small', text: t('admin.noTeams') }));
      return;
    }

    for (const team of state.teams) {
      const round = state.round;
      const choice = round ? (round.answers.find((a) => a.teamId === team.id) || {}).choice : null;

      host.appendChild(
        h('div', { class: 'list-item' }, [
          h('i', { class: `dot ${team.online ? 'on' : ''}` }),
          h('div', { class: 'grow' }, [
            h('div', { class: 'title', text: team.name }),
            h('div', { class: 'small muted' }, [
              `${t('score.total')} `,
              h('b', { class: signClass(team.total), text: fmtSigned(team.total) }),
              ` · ${t('score.act1')} ${fmtSigned(team.act1)} · ${t('score.act2')} ${fmtSigned(
                team.act2
              )} · ★ ${team.wins}`,
            ]),
          ]),
          round && round.status === 'open'
            ? h('span', {
                class: `badge ${choice ? 'green' : ''}`,
                text: choice || '…',
              })
            : null,
          h('button', {
            class: 'btn btn-xs',
            text: t('admin.adjust'),
            onClick: () => openTeamModal(team.id),
          }),
        ])
      );
    }
  }

  /* ------------------------------------------------------------------ réglages */

  function renderSettings() {
    const s = state.session.settings;
    const set = (id, value, prop) => {
      const node = $(id);
      if (!node || node === document.activeElement) return;
      node[prop || 'value'] = value;
    };
    set('#set-duration', s.defaultDuration);
    set('#set-autoreveal', s.autoReveal, 'checked');
    set('#set-autoclose', s.autoCloseOnAllAnswers, 'checked');
    set('#set-allowchange', s.allowChangeBeforeDeadline, 'checked');
    set('#set-latejoin', s.allowLateJoin, 'checked');
    set('#set-showboard', s.showLeaderboardToTeams, 'checked');
    set('#set-penalty', s.noAnswerPenalty);

    if (pendingDuration === null) {
      const launchInput = $('#launch-duration');
      if (launchInput !== document.activeElement) launchInput.value = s.defaultDuration;
    }
  }

  function pushSettings() {
    call('admin:updateSettings', {
      settings: {
        defaultDuration: Number($('#set-duration').value),
        autoReveal: $('#set-autoreveal').checked,
        autoCloseOnAllAnswers: $('#set-autoclose').checked,
        allowChangeBeforeDeadline: $('#set-allowchange').checked,
        allowLateJoin: $('#set-latejoin').checked,
        showLeaderboardToTeams: $('#set-showboard').checked,
        noAnswerPenalty: Number($('#set-penalty').value),
      },
    });
  }

  /* --------------------------------------------------------------- journal */

  function renderLog() {
    const host = clear($('#log-host'));
    for (const line of state.log.slice().reverse()) {
      host.appendChild(
        h('div', { class: 'log-line' }, [
          h('time', { text: fmtTimeOnly(line.ts) }),
          h('span', { text: t(`log.${line.type}`, line.params || {}) }),
        ])
      );
    }
  }

  function renderRoles() {
    const host = clear($('#roles-host'));
    host.appendChild(C.rolesGrid(state.roles));
  }

  /* ---------------------------------------------------------------- render */

  /** Modales ouvertes qui doivent se redessiner à chaque nouvel état. */
  const subscribers = new Set();

  function render() {
    if (!state) return;
    renderHeader();
    renderCurrent();
    renderDeck();
    renderHistory();
    renderBoard();
    renderTeams();
    renderSettings();
    renderLog();
    renderRoles();
    subscribers.forEach((fn) => {
      try {
        fn();
      } catch (err) {
        console.error(err);
      }
    });
  }

  startTicker(() => {
    if (!state) return;
    const remaining = timer.update(state.round);
    $('#m-timer').textContent = state.round ? fmtClock(remaining) : '—';
  });

  window.I18N.onChange(() => {
    window.I18N.applyStatic();
    render();
  });

  /* ---------------------------------------------------- fiche équipe (modale) */

  function openTeamModal(teamId) {
    const team = state.teams.find((x) => x.id === teamId);
    if (!team) return;

    const body = h('div', { class: 'stack' });
    let stopI18n = null;
    const dialog = modal(body, {
      onClose: () => {
        subscribers.delete(refresh);
        if (stopI18n) stopI18n();
      },
    });

    function refresh() {
      const live = state.teams.find((x) => x.id === teamId);
      if (!live) return dialog.close();
      clear(body);

      body.appendChild(
        h('div', { class: 'panel-head' }, [
          h('h2', { text: live.name }),
          h('div', { class: 'spacer' }),
          h('button', { class: 'btn btn-sm btn-ghost', text: '×', onClick: dialog.close }),
        ])
      );

      body.appendChild(
        h('div', { class: 'grid cols-4' }, [
          metric(t('score.act1'), fmtSigned(live.act1)),
          metric(t('score.act2'), fmtSigned(live.act2)),
          metric(t('score.adjust'), fmtSigned(live.adjust)),
          metric(t('score.total'), fmtSigned(live.total)),
        ])
      );

      body.appendChild(
        h('div', { class: 'grid cols-2' }, [
          C.profileCard('score.profile1', live.act1Profile, 'orange'),
          C.profileCard('score.profile2', live.act2Profile, 'blue'),
        ])
      );

      /* --- renommer --- */
      const nameInput = h('input', { type: 'text', value: live.name, maxlength: '40' });
      body.appendChild(
        h('div', {}, [
          h('div', { class: 'label', text: t('play.rename') }),
          h('div', { class: 'inline-form' }, [
            nameInput,
            h('button', {
              class: 'btn btn-sm',
              text: t('btn.save'),
              onClick: async () => {
                await call('admin:renameTeam', { teamId, name: nameInput.value });
                refresh();
              },
            }),
          ]),
        ])
      );

      /* --- ajustement de points --- */
      const deltaInput = h('input', { type: 'number', value: '1', style: 'max-width:90px' });
      const reasonInput = h('input', {
        type: 'text',
        placeholder: t('admin.reason'),
        maxlength: '120',
      });

      const quick = h(
        'div',
        { class: 'row tight' },
        [-5, -2, -1, 1, 2, 5].map((value) =>
          h('button', {
            class: 'btn btn-xs',
            text: fmtSigned(value),
            onClick: async () => {
              await call('admin:adjustScore', {
                teamId,
                delta: value,
                reason: reasonInput.value,
              });
              refresh();
            },
          })
        )
      );

      body.appendChild(
        h('div', {}, [
          h('div', { class: 'label', text: t('admin.adjust') }),
          quick,
          h('div', { class: 'inline-form', style: 'margin-top:8px' }, [
            deltaInput,
            reasonInput,
            h('button', {
              class: 'btn btn-sm btn-primary',
              text: t('admin.adjust'),
              onClick: async () => {
                await call('admin:adjustScore', {
                  teamId,
                  delta: Number(deltaInput.value),
                  reason: reasonInput.value,
                });
                refresh();
              },
            }),
          ]),
        ])
      );

      if (live.adjustments && live.adjustments.length) {
        body.appendChild(
          h('div', {}, [
            h('div', { class: 'label', text: t('admin.adjustments') }),
            h(
              'div',
              { class: 'list' },
              live.adjustments
                .slice()
                .reverse()
                .map((adj) =>
                  h('div', { class: 'list-item' }, [
                    h('b', { class: signClass(adj.delta), text: fmtSigned(adj.delta) }),
                    h('span', { class: 'grow small muted', text: adj.reason || '—' }),
                    h('span', { class: 'small muted', text: fmtTimeOnly(adj.ts) }),
                    h('button', {
                      class: 'btn btn-xs btn-danger',
                      text: '×',
                      onClick: async () => {
                        await call('admin:removeAdjustment', { teamId, adjustmentId: adj.id });
                        refresh();
                      },
                    }),
                  ])
                )
            ),
          ])
        );
      }

      /* --- correction des réponses --- */
      const answers = live.answers || {};
      const rows = state.events.map((event) => {
        const answer = answers[event.id];
        const select = h(
          'select',
          {
            style: 'max-width:120px',
            onChange: () =>
              call('admin:setAnswer', {
                teamId,
                eventId: event.id,
                choice: select.value || null,
              }),
          },
          [
            h('option', { value: '', text: '—' }),
            ...event.options.map((option) =>
              h('option', {
                value: option.key,
                text: option.key,
                selected: answer && answer.choice === option.key,
              })
            ),
          ]
        );
        return h('div', { class: 'list-item' }, [
          h('div', { class: 'grow' }, [
            h('div', { class: 'small', text: L(event.title) }),
            h('div', { class: 'small muted', text: L(event.ref) }),
          ]),
          h('b', {
            class: signClass(answer ? answer.total : 0),
            text: answer ? fmtSigned(answer.total) : '—',
          }),
          select,
        ]);
      });

      body.appendChild(
        h('div', {}, [
          h('div', { class: 'label', text: t('admin.override') }),
          h('div', { class: 'list' }, rows),
        ])
      );

      /* --- suppression --- */
      body.appendChild(
        h('div', { class: 'row', style: 'margin-top:6px' }, [
          h('button', {
            class: 'btn btn-sm btn-danger',
            text: t('btn.delete'),
            onClick: async () => {
              if (!window.confirm(t('admin.removeTeamConfirm'))) return;
              await call('admin:removeTeam', { teamId });
              dialog.close();
            },
          }),
          h('div', { class: 'spacer' }),
          h('button', { class: 'btn btn-sm', text: t('btn.close'), onClick: dialog.close }),
        ])
      );
      return undefined;
    }

    function metric(k, v) {
      return h('div', { class: 'metric' }, [
        h('div', { class: 'k', text: k }),
        h('div', { class: `v small ${signClass(v)}`, text: v }),
      ]);
    }

    refresh();
    stopI18n = window.I18N.onChange(refresh);
    subscribers.add(refresh);
  }

  /* ----------------------------------------------- éditeur d'événement (modale) */

  function openEventModal(event) {
    const isNew = !event;
    const body = h('div', { class: 'stack' });
    const dialog = modal(body);

    const src =
      event ||
      {
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
          { key: 'A', label: { fr: '', en: '' }, short: 2, long: -3, points: 0, reveal: null },
          { key: 'B', label: { fr: '', en: '' }, short: 1, long: 1, points: 2, reveal: null },
          { key: 'C', label: { fr: '', en: '' }, short: -2, long: 3, points: 4, reveal: null },
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
      f[`opt_${key}_label_fr`] = h('input', { type: 'text', value: (option.label && option.label.fr) || '' });
      f[`opt_${key}_label_en`] = h('input', { type: 'text', value: (option.label && option.label.en) || '' });
      f[`opt_${key}_short`] = h('input', { type: 'number', value: option.short != null ? option.short : 0 });
      f[`opt_${key}_long`] = h('input', { type: 'number', value: option.long != null ? option.long : 0 });
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
        h('div', { class: 'grid cols-3', style: 'gap:8px' }, [
          h('label', { class: 'field', style: 'margin:0' }, [
            h('span', { text: t('admin.optShort') }),
            f[`opt_${key}_short`],
          ]),
          h('label', { class: 'field', style: 'margin:0' }, [
            h('span', { text: t('admin.optLong') }),
            f[`opt_${key}_long`],
          ]),
          h('label', { class: 'field', style: 'margin:0' }, [
            h('span', { text: t('admin.optPoints') }),
            f[`opt_${key}_points`],
          ]),
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
              ? await call('admin:addEvent', { event: payload })
              : await call('admin:updateEvent', { eventId: event.id, event: payload });
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
        ref: textPair('ref') || { fr: act === 1 ? 'Carte' : 'Étape', en: act === 1 ? 'Card' : 'Step' },
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
          short: Number(f[`opt_${key}_short`].value) || 0,
          long: Number(f[`opt_${key}_long`].value) || 0,
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
  $('#copy-link').addEventListener('click', (e) => copyText(joinUrl(state.session.code), e.target));
  $('#btn-new-event').addEventListener('click', () => openEventModal(null));

  $('#add-team-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const input = $('#add-team-name');
    const res = await call('admin:addTeam', { name: input.value.trim() });
    if (res) input.value = '';
  });

  ['#set-autoreveal', '#set-autoclose', '#set-allowchange', '#set-latejoin', '#set-showboard'].forEach(
    (id) => $(id).addEventListener('change', pushSettings)
  );
  ['#set-duration', '#set-penalty'].forEach((id) => $(id).addEventListener('change', pushSettings));

  $('#launch-duration').addEventListener('input', () => {
    pendingDuration = $('#launch-duration').value;
  });

  $('#btn-end-session').addEventListener('click', async () => {
    if (!window.confirm(t('admin.endConfirm'))) return;
    const res = await call('admin:endSession');
    if (res && res.recordId) {
      toast(t('flash.session_ended'), 'success');
    }
  });

  $('#btn-reopen').addEventListener('click', () => call('admin:reopenSession'));

  /* Rafraîchissement de secours si la socket se réveille après une veille. */
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && socket.connected) {
      socket.call('state:refresh').then((res) => res && res.state && onState(res.state)).catch(() => {});
    }
  });
})();
