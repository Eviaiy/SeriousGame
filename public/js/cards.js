/* Rendu partagé : cartes d'événement, chrono, classement, rôles. */
(function () {
  'use strict';

  const { h, L, t, fmtSigned, signClass, fmtClock, now } = window.SG;

  /** Libellé de barème d'une option : « +2 / −3 » (acte 1) ou « +4 » (acte 2). */
  function pointsLabel(event, option) {
    if (event.act === 2) return fmtSigned(option.points).replace('-', '−');
    const short = fmtSigned(option.short).replace('-', '−');
    const long = fmtSigned(option.long).replace('-', '−');
    return `${short} / ${long}`;
  }

  function pointsHint(event) {
    return event.act === 2
      ? t('score.points')
      : `${t('score.short')} / ${t('score.long')}`;
  }

  /**
   * Carte d'événement.
   * opts : { interactive, selected, disabled, onChoose, showPoints, revealed, winningKeys }
   */
  function renderCard(event, opts) {
    const o = opts || {};
    if (!event) return h('p', { class: 'muted', text: t('admin.noCurrent') });

    const head = h('div', { class: `gcard-head ${event.color || 'red'}` }, [
      h('div', { class: 'kicker' }, [
        h('span', { text: L(event.tag) }),
        h('span', { text: L(event.ref) }),
      ]),
      h('h2', { text: L(event.title) }),
    ]);

    const left = h('div', { class: 'stack' }, [
      h('div', {}, [
        h('div', { class: 'meta-label', text: t('card.situation') }),
        h('div', { class: 'situation', text: L(event.situation) }),
      ]),
      event.motif && event.motif.length
        ? h('div', {}, [
            h('div', { class: 'meta-label', text: t('card.motif') }),
            h(
              'ul',
              { class: 'bullets' },
              event.motif.map((m) => h('li', { text: L(m) }))
            ),
          ])
        : null,
      event.impact && event.impact.length
        ? h('div', {}, [
            h('div', { class: 'meta-label', text: t('card.impact') }),
            h(
              'ul',
              { class: 'bullets' },
              event.impact.map((m) => h('li', { text: L(m) }))
            ),
          ])
        : null,
      event.tension ? h('div', { class: 'tension', text: L(event.tension) }) : null,
    ]);

    const winning = o.winningKeys || [];
    const choices = h(
      'div',
      { class: 'choice-box' },
      [
        h('div', { class: 'meta-label', text: t('play.chooseNow') }),
        ...event.options.map((option) => {
          const isSelected = o.selected === option.key;
          const classes = ['choice'];
          if (isSelected) classes.push('selected');
          if (o.revealed && winning.includes(option.key)) classes.push('win');
          return h(
            'button',
            {
              class: classes.join(' '),
              type: 'button',
              disabled: !o.interactive || o.disabled,
              onClick: o.onChoose ? () => o.onChoose(option.key) : null,
            },
            [
              h('span', { class: 'choice-key', text: option.key }),
              h('span', { class: 'choice-label', text: L(option.label) }),
              o.showPoints
                ? h('span', { class: 'choice-points', text: pointsLabel(event, option) })
                : null,
            ]
          );
        }),
        o.showPoints
          ? h('div', { class: 'small muted', text: `${t('score.matrix')} — ${pointsHint(event)}` })
          : null,
      ].filter(Boolean)
    );

    const revealBlock =
      o.revealed && event.options.some((op) => op.reveal)
        ? h('div', {}, [
            h('div', { class: 'meta-label', text: t('play.reveal') }),
            h(
              'div',
              { class: 'reveal-list' },
              event.options
                .filter((op) => op.reveal)
                .map((op) =>
                  h('div', {}, [h('b', { text: `${op.key} → ` }), L(op.reveal)])
                )
            ),
          ])
        : null;

    const right = h('div', { class: 'stack' }, [choices, revealBlock].filter(Boolean));

    return h('div', { class: 'gcard' }, [
      head,
      h('div', { class: 'gcard-body two-col' }, [left, right]),
    ]);
  }

  /** Chrono avec chiffres + barre de progression. */
  function createTimer(size) {
    const digits = h('div', { class: 'timer', text: '--:--' });
    if (size === 'small') digits.style.fontSize = '1.6rem';
    const fill = h('i', { style: 'width:0%' });
    const bar = h('div', { class: 'timer-bar' }, [fill]);
    const label = h('div', { class: 'small muted' });
    const node = h('div', { class: 'stack', style: 'gap:6px' }, [digits, bar, label]);

    function update(round) {
      digits.classList.remove('warn', 'danger', 'done');
      bar.classList.remove('warn', 'danger');

      if (!round) {
        digits.textContent = '--:--';
        digits.classList.add('done');
        fill.style.width = '0%';
        label.textContent = '';
        return 0;
      }

      const totalMs = Math.max(1, (round.durationSec || 1) * 1000);
      let remaining;
      if (round.status === 'closed') remaining = 0;
      else if (round.pausedAt) remaining = round.endsAt - round.pausedAt;
      else remaining = round.endsAt - now();
      remaining = Math.max(0, remaining);

      digits.textContent = fmtClock(remaining);
      const pct = Math.max(0, Math.min(100, (remaining / totalMs) * 100));
      fill.style.width = `${pct}%`;

      if (round.status === 'closed') {
        digits.classList.add('done');
        label.textContent = t('play.locked');
      } else if (round.pausedAt) {
        digits.classList.add('warn');
        label.textContent = t('play.paused');
      } else if (remaining <= 0) {
        digits.classList.add('done');
        label.textContent = t('play.timeUp');
      } else if (pct <= 20) {
        digits.classList.add('danger');
        bar.classList.add('danger');
        label.textContent = t('play.timeLeft');
      } else if (pct <= 50) {
        digits.classList.add('warn');
        bar.classList.add('warn');
        label.textContent = t('play.timeLeft');
      } else {
        label.textContent = t('play.timeLeft');
      }
      return remaining;
    }

    return { node, digits, update };
  }

  /** Pastilles « qui a répondu ». */
  function answerChips(round, opts) {
    const o = opts || {};
    if (!round) return h('div');
    return h(
      'div',
      { class: 'answer-chips' },
      (round.answers || []).map((a) => {
        const classes = ['chip'];
        if (a.answered) classes.push('answered');
        if ((round.winners || []).includes(a.teamId)) classes.push('win');
        const parts = [a.name];
        if (a.choice) parts.push(a.choice);
        else if (a.answered) parts.push('✓');
        const node = h('span', { class: classes.join(' ') }, [
          h('span', { text: parts[0] }),
          parts[1] ? h('b', { text: parts[1] }) : null,
          o.showSeconds && a.seconds != null
            ? h('span', { class: 'muted small', text: `${a.seconds}s` })
            : null,
        ]);
        return node;
      })
    );
  }

  /** Bandeau du gagnant de l'événement. */
  function winnerBanner(round, opts) {
    const o = opts || {};
    if (!round || !round.revealed) return null;
    const names = round.winnerNames || [];
    if (!names.length) {
      return h('div', { class: 'winner-banner' }, [
        h('div', { class: 'label', text: t('play.winner') }),
        h('div', { class: 'who', text: t('play.noWinner') }),
      ]);
    }
    const mine = o.teamId && (round.winners || []).includes(o.teamId);
    return h('div', { class: 'winner-banner' }, [
      h('div', {
        class: 'label',
        text: names.length > 1 ? t('play.winners') : t('play.winner'),
      }),
      h('div', { class: 'who', text: names.join(' · ') }),
      mine ? h('div', { class: 'badge gold', text: t('play.youWin') }) : null,
    ]);
  }

  /** Tableau des résultats d'un événement. */
  function resultsTable(round, opts) {
    const o = opts || {};
    const rows = (round && round.results) || [];
    if (!rows.length) return h('p', { class: 'muted small', text: '—' });

    return h('div', { class: 'table-wrap' }, [
      h('table', { class: 'table' }, [
        h('thead', {}, [
          h('tr', {}, [
            h('th', { text: t('score.team') }),
            h('th', { text: t('score.choice') }),
            h('th', { class: 'num', text: t('score.points') }),
            h('th', { class: 'num', text: t('score.seconds') }),
          ]),
        ]),
        h(
          'tbody',
          {},
          rows.map((row) => {
            const isWinner = (round.winners || []).includes(row.teamId);
            const classes = [];
            if (isWinner) classes.push('is-winner');
            if (o.teamId && row.teamId === o.teamId) classes.push('is-me');
            return h('tr', { class: classes.join(' ') }, [
              h('td', {}, [
                h('span', { text: row.teamName }),
                isWinner ? h('span', { class: 'badge gold', text: '★' }) : null,
              ]),
              h('td', { text: row.choice || t('score.noAnswer') }),
              h('td', { class: `num ${signClass(row.total)}`, text: fmtSigned(row.total) }),
              h('td', {
                class: 'num muted',
                text: row.ms == null ? '—' : `${Math.round(row.ms / 100) / 10}`,
              }),
            ]);
          })
        ),
      ]),
    ]);
  }

  /** Classement général. */
  function leaderboardTable(rows, opts) {
    const o = opts || {};
    if (!rows || !rows.length) return h('p', { class: 'muted small', text: t('admin.noTeams') });

    const head = o.compact
      ? [
          h('th', { text: t('score.rank') }),
          h('th', { text: t('score.team') }),
          h('th', { class: 'num', text: t('score.total') }),
          h('th', { class: 'num', text: '★' }),
        ]
      : [
          h('th', { text: t('score.rank') }),
          h('th', { text: t('score.team') }),
          h('th', { class: 'num', text: t('score.short') }),
          h('th', { class: 'num', text: t('score.long') }),
          h('th', { class: 'num', text: t('score.act2') }),
          h('th', { class: 'num', text: t('score.adjust') }),
          h('th', { class: 'num', text: t('score.total') }),
          h('th', { class: 'num', text: '★' }),
        ];

    return h('table', { class: 'table' }, [
      h('thead', {}, [h('tr', {}, head)]),
      h(
        'tbody',
        {},
        rows.map((row) => {
          const classes = [];
          if (row.rank === 1) classes.push('is-winner');
          if (o.teamId && row.teamId === o.teamId) classes.push('is-me');
          const cells = o.compact
            ? [
                h('td', { class: 'rank', text: row.rank }),
                h('td', { text: row.name }),
                h('td', { class: `num ${signClass(row.total)}`, text: fmtSigned(row.total) }),
                h('td', { class: 'num', text: row.wins || 0 }),
              ]
            : [
                h('td', { class: 'rank', text: row.rank }),
                h('td', {}, [
                  h('div', { text: row.name }),
                  h('div', {
                    class: 'small muted',
                    text: `${L(row.act1Profile.label)} · ${L(row.act2Profile.label)}`,
                  }),
                ]),
                h('td', { class: `num ${signClass(row.short)}`, text: fmtSigned(row.short) }),
                h('td', { class: `num ${signClass(row.long)}`, text: fmtSigned(row.long) }),
                h('td', { class: `num ${signClass(row.act2)}`, text: fmtSigned(row.act2) }),
                h('td', { class: `num ${signClass(row.adjust)}`, text: fmtSigned(row.adjust) }),
                h('td', {
                  class: `num ${signClass(row.total)}`,
                  style: 'font-weight:700',
                  text: fmtSigned(row.total),
                }),
                h('td', { class: 'num', text: row.wins || 0 }),
              ];
          return h('tr', { class: classes.join(' ') }, cells);
        })
      ),
    ]);
  }

  function profileCard(labelKey, profile, stripe) {
    return h('div', { class: 'profile-card' }, [
      h('div', { class: `stripe ${stripe || ''}`.trim() }),
      h('div', { class: 'label', text: t(labelKey) }),
      h('div', { class: 'p-name', text: L(profile.label) }),
      h('div', { class: 'small muted', text: L(profile.desc) }),
    ]);
  }

  function rolesGrid(roles) {
    return h(
      'div',
      { class: 'grid cols-3' },
      (roles || []).map((role) =>
        h('div', { class: 'role-card' }, [
          h('h4', { text: L(role.name) }),
          h('div', { class: 'small', text: L(role.mission) }),
          h('div', { class: 'small muted', text: L(role.focus) }),
          h('div', { class: 'q', text: L(role.quote) }),
        ])
      )
    );
  }

  window.CARDS = {
    renderCard,
    createTimer,
    answerChips,
    winnerBanner,
    resultsTable,
    leaderboardTable,
    profileCard,
    rolesGrid,
    pointsLabel,
  };
})();
