/* Rendu partagé : cartes d'événement, chrono, rôles, votes, classements. */
(function () {
  'use strict';

  const { h, svg, L, t, fmtSigned, signClass, fmtClock, now } = window.SG;

  /* ------------------------------------------------------------- iconographie */

  const ICONS = {
    /* Directeur fiscal — la balance */
    scale: ['M12 4v16', 'M8 20h8', 'M5 7h14', 'M5 7 2 13a3.2 3.2 0 0 0 6 0z', 'M19 7l-3 6a3.2 3.2 0 0 0 6 0z'],
    /* DAF / trésorerie — le billet */
    cash: ['M2 6h20v12H2z', 'M12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z', 'M5.5 12h.01', 'M18.5 12h.01'],
    /* DSI — le processeur */
    chip: [
      'M4 4h16v16H4z',
      'M9 9h6v6H9z',
      'M9 2v2',
      'M15 2v2',
      'M9 20v2',
      'M15 20v2',
      'M2 9h2',
      'M2 15h2',
      'M20 9h2',
      'M20 15h2',
    ],
    /* Juridique — le marteau */
    gavel: ['M13.5 2.5l8 8-3 3-8-8z', 'M10.5 8.5 2 17l3 3 8.5-8.5', 'M2 22h20'],
    /* Relation clients — deux interlocuteurs */
    handshake: [
      'M16 20v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2',
      'M9 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
      'M22 20v-2a4 4 0 0 0-3-3.87',
      'M16 3.13a4 4 0 0 1 0 7.75',
    ],
    /* Direction générale — la couronne */
    crown: ['M3 7l3.6 4L12 4l5.4 7L21 7l-2 11H5L3 7z', 'M5 21h14'],
    lock: ['M5 11h14v10H5z', 'M8 11V7a4 4 0 0 1 8 0v4'],
    check: ['M4 12.5 9 17.5 20 6.5'],
    users: [
      'M16 20v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2',
      'M9 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
      'M22 20v-2a4 4 0 0 0-3-3.87',
    ],
  };

  function icon(name, size) {
    const paths = ICONS[name] || ICONS.users;
    return svg(
      'svg',
      {
        viewBox: '0 0 24 24',
        width: size || 20,
        height: size || 20,
        fill: 'none',
        stroke: 'currentColor',
        'stroke-width': '1.7',
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
        'aria-hidden': 'true',
      },
      paths.map((d) => svg('path', { d }))
    );
  }

  /** Médaillon du rôle. size : 'sm' | '' | 'lg'. */
  function roleMedal(role, size) {
    const classes = ['role-medal'];
    if (size) classes.push(size);
    if (role && role.dg) classes.push('is-dg');
    return h('span', { class: classes.join(' ') }, [icon(role ? role.icon : 'users')]);
  }

  function dgBadge() {
    return h('span', { class: 'dg-badge' }, [icon('crown', 12), h('span', { text: 'DG' })]);
  }

  /* ------------------------------------------------------- récit d'ouverture */

  function narrativeBlock(narrative, opts) {
    const o = opts || {};
    if (!narrative) return null;
    return h('div', { class: 'narrative' }, [
      h('div', { class: 'eyebrow', text: L(narrative.eyebrow) }),
      h('h2', { text: L(narrative.title) }),
      ...(narrative.lines || []).map((line) => h('p', { text: L(line) })),
      h('p', { class: 'punch', text: L(narrative.punch) }),
      h('p', { class: 'small muted', text: L(narrative.instruction) }),
      o.onReady
        ? h('div', {}, [
            h('button', {
              class: 'btn btn-primary',
              type: 'button',
              text: t('play.narrativeSkip'),
              onClick: o.onReady,
            }),
          ])
        : null,
    ]);
  }

  /* -------------------------------------------------------- briefing du rôle */

  /** Carte d'identité du joueur : son rôle et ce qu'il doit défendre. */
  function roleHero(role, opts) {
    const o = opts || {};
    if (!role) {
      return h('div', { class: 'role-hero' }, [
        h('div', { class: 'role-head' }, [
          roleMedal(null, 'lg'),
          h('div', {}, [
            h('div', { class: 'eyebrow', text: t('play.waitingRole') }),
            h('div', { class: 'role-name', text: '…' }),
          ]),
        ]),
        h('p', { class: 'muted', text: t('play.waitingRoleHint') }),
      ]);
    }

    const openingBlocks = [
      role.mission ? ['play.mission', L(role.mission)] : null,
      role.focus ? ['play.focus', L(role.focus)] : null,
    ].filter(Boolean);
    const closingBlocks = [
      role.stance ? ['play.stance', L(role.stance)] : null,
      role.power ? ['play.dgPower', L(role.power)] : null,
    ].filter(Boolean);

    const briefingBlock = ([key, text]) =>
      h('div', { class: 'brief-block' }, [
        h('div', { class: 'k', text: t(key) }),
        h('p', { text }),
      ]);

    const head = h('div', { class: 'role-head' }, [
      roleMedal(role, 'lg'),
      h('div', { style: 'min-width:0' }, [
        h('div', { class: 'eyebrow', text: o.eyebrow || t('play.myRole') }),
        h('div', { class: 'role-name', text: L(role.name) }),
      ]),
      role.dg ? dgBadge() : null,
    ]);
    const brief = [
      h('div', { class: 'role-brief' }, openingBlocks.map(briefingBlock)),
      role.quote ? h('div', { class: 'brief-quote', text: L(role.quote) }) : null,
      h('div', { class: 'role-brief' }, closingBlocks.map(briefingBlock)),
      h('p', { class: 'small muted role-instruction', text: t('play.collectiveInstruction') }),
    ];

    /* Pendant une manche le briefing se replie : sur téléphone il occupait tout
       l'écran et repoussait la carte et le vote hors du champ. */
    if (o.folded) {
      return h('div', { class: 'role-hero' }, [
        h('details', { class: 'role-fold' }, [
          h('summary', {}, [head, h('span', { class: 'fold-hint', text: t('play.readBrief') })]),
          h('div', { class: 'fold-body' }, brief),
        ]),
      ]);
    }

    return h('div', { class: 'role-hero' }, [head, ...brief.filter(Boolean)]);
  }

  /** Grille des rôles de la table (vue animateur). */
  function rolesGrid(roles) {
    return h(
      'div',
      { class: 'grid roles-grid' },
      (roles || []).map((role) =>
        h('div', { class: 'role-card' }, [
          h('div', { class: 'row', style: 'gap:10px;align-items:center' }, [
            roleMedal(role, 'sm'),
            h('h4', { style: 'margin:0', text: L(role.name) }),
            role.dg ? dgBadge() : null,
          ]),
          h('div', { class: 'small', text: L(role.mission) }),
          h('div', { class: 'q', text: L(role.quote) }),
        ])
      )
    );
  }

  /* ------------------------------------------------------ composition d'équipe */

  /**
   * Liste des joueurs d'une table.
   * opts : { round, showVotes, showPresence, onRemove, onMove }
   */
  function rosterList(players, opts) {
    const o = opts || {};
    const list = players || [];
    if (!list.length) return h('p', { class: 'muted small', text: t('admin.waitingPlayers') });

    const votedIds = new Set(
      o.round && o.showVotes ? (o.round.voted || []).filter((v) => v.voted).map((v) => v.id) : []
    );

    return h(
      'div',
      { class: `roster${o.single ? ' is-single' : ''}` },
      list.map((player) => {
        const classes = ['roster-item'];
        if (player.self) classes.push('is-me');
        return h('div', { class: classes.join(' ') }, [
          roleMedal(player.role, 'sm'),
          h('div', { class: 'roster-main' }, [
            h('div', { class: 'roster-name' }, [
              h('span', { text: player.name }),
              player.role && player.role.dg ? dgBadge() : null,
            ]),
            h('div', {
              class: 'roster-role',
              text: player.role ? L(player.role.name) : t('admin.rolesPending'),
            }),
          ]),
          h(
            'div',
            { class: 'roster-flags' },
            [
              o.showVotes
                ? h(
                    'span',
                    {
                      class: `vote-mark${votedIds.has(player.id) ? ' done' : ''}`,
                      title: t('play.sent'),
                    },
                    /* Anneau vide = pas encore voté : aucun glyphe, sinon on
                       croit lire une pastille de contenu. */
                    votedIds.has(player.id) ? [icon('check', 12)] : []
                  )
                : null,
              o.showPresence === false
                ? null
                : h('span', {
                    class: `live-dot${player.online ? ' on' : ''}`,
                    title: t(player.online ? 'conn.online' : 'conn.offline'),
                  }),
              o.onMove
                ? h('button', {
                    class: 'btn btn-ghost btn-xs',
                    type: 'button',
                    text: '⇄',
                    title: t('admin.movePlayer'),
                    onClick: () => o.onMove(player),
                  })
                : null,
              o.onRemove
                ? h('button', {
                    class: 'btn btn-ghost btn-xs',
                    type: 'button',
                    text: '×',
                    title: t('admin.removePlayer'),
                    onClick: () => o.onRemove(player),
                  })
                : null,
            ].filter(Boolean)
          ),
        ]);
      })
    );
  }

  /* ---------------------------------------------------------- décompte des voix */

  /** Barres de répartition des voix. Jamais nominatif. */
  function tallyBars(tally, opts) {
    const o = opts || {};
    if (!tally) return null;
    const keys = ['A', 'B', 'C'];
    const max = Math.max(1, ...keys.map((k) => tally[k] || 0));
    const winners = o.winners || (o.decision ? [o.decision] : []);
    return h(
      'div',
      { class: 'tally' },
      keys.map((key) => {
        const n = tally[key] || 0;
        const isWin = winners.includes(key);
        return h('div', { class: `tally-row${isWin ? ' is-win' : ''}` }, [
          h('span', { class: 'tally-key', text: key }),
          h('span', { class: 'tally-track' }, [
            h('i', { class: 'tally-fill', style: `width:${Math.round((n / max) * 100)}%` }),
          ]),
          h('span', { class: 'tally-n', text: String(n) }),
        ]);
      })
    );
  }

  /** « à la majorité », « par le Directeur Général »… */
  function decidedByText(kind) {
    const key = `play.decidedBy.${kind || 'none'}`;
    const label = t(key);
    return label === key ? '' : label;
  }

  /* --------------------------------------------------------- cartes d'événement */

  /** Libellé de barème d'une option, identique aux deux actes : « 0 », « +2 », « +4 ». */
  function pointsLabel(option) {
    return fmtSigned(option.points).replace('-', '−');
  }

  /** Dos de carte : sceau de l'acte, on ne voit rien du contenu. */
  function cardBack(event) {
    return h('div', { class: 'card-back' }, [
      h('div', { class: 'card-back-mark' }, [
        h('div', { class: 'seal', text: event.act === 2 ? 'II' : 'I' }),
        h('div', { class: 'act', text: t(event.act === 2 ? 'score.act2' : 'score.act1') }),
        h('div', { class: 'ref', text: L(event.ref) }),
      ]),
    ]);
  }

  /**
   * Carte d'événement, posée dans une scène 3D qui se retourne.
   * opts : { interactive, selected, disabled, onChoose, showPoints, revealed,
   *          winningKeys, flipIn, animateReveal, promptKey }
   */
  function renderCard(event, opts) {
    const o = opts || {};
    if (!event) return h('p', { class: 'muted', text: t('play.waiting') });

    const head = h('div', { class: `gcard-head ${event.color || 'red'}` }, [
      h('div', { class: 'kicker' }, [
        h('span', { text: L(event.tag) }),
        h('span', { text: L(event.ref) }),
      ]),
      h('h2', { text: L(event.title) }),
    ]);

    const left = h('div', { class: 'stack gcard-context' }, [
      h('div', {}, [
        h('div', { class: 'meta-label', text: t('card.situation') }),
        h('div', { class: 'situation', text: L(event.situation) }),
      ]),
      event.motif && event.motif.length
        ? h('div', { class: 'gcard-revelations' }, [
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
    const flipTargets = [];

    const choiceNodes = event.options.map((option) => {
      const isSelected = o.selected === option.key;
      const classes = ['choice'];
      if (isSelected) classes.push('selected');
      if (o.revealed && winning.includes(option.key)) classes.push('win');
      /* Déjà retournée si la révélation n'est plus une nouveauté : pas d'animation. */
      if (o.revealed && !o.animateReveal) classes.push('is-flipped');

      const front = h('span', { class: 'choice-front' }, [
        h('span', { class: 'choice-key', text: option.key }),
        h('span', { class: 'choice-label', text: L(option.label) }),
        o.showPoints && !o.revealed
          ? h('span', { class: 'choice-points', text: pointsLabel(option) })
          : null,
        isSelected ? h('span', { class: 'choice-check', text: '✓' }) : null,
      ]);

      /* Le verso garde le libellé : sans lui, la révélation n'affiche que des
         chiffres et on ne sait plus quelle décision ils récompensent. */
      const back = h('span', { class: 'choice-back' }, [
        h('span', { class: 'choice-key', text: option.key }),
        h('span', { class: 'choice-body' }, [
          h('span', { class: 'choice-label', text: L(option.label) }),
          option.reveal ? h('span', { class: 'choice-reveal', text: L(option.reveal) }) : null,
        ]),
        o.showPoints ? h('span', { class: 'choice-points', text: pointsLabel(option) }) : null,
        winning.includes(option.key) ? h('span', { class: 'choice-check', text: '★' }) : null,
      ]);

      const node = h(
        'button',
        {
          class: classes.join(' '),
          type: 'button',
          disabled: !o.interactive || o.disabled,
          onClick: o.onChoose ? () => o.onChoose(option.key) : null,
        },
        [h('span', { class: 'choice-inner' }, [front, back])]
      );
      if (o.revealed && o.animateReveal) flipTargets.push(node);
      return node;
    });

    /* Les options basculent l'une après l'autre au moment de la révélation. */
    if (flipTargets.length) {
      flipTargets.forEach((node, i) => {
        setTimeout(() => node.classList.add('is-flipped'), 260 + i * 140);
      });
    }

    const choices = h(
      'div',
      { class: 'choice-box' },
      [
        h('div', { class: 'meta-label', text: t(o.promptKey || 'play.chooseNow') }),
        ...choiceNodes,
        o.showPoints
          ? h('div', { class: 'matrix-hint', text: `${t('score.matrix')} — ${t('score.scale')}` })
          : null,
      ].filter(Boolean)
    );

    const showRevelations = event.act === 2 || o.revealed;
    const revealBlock =
      showRevelations && event.options.some((op) => op.reveal)
        ? h('div', {}, [
            h('div', {
              class: 'meta-label',
              text: t(event.act === 2 ? 'card.revelations' : 'play.reveal'),
            }),
            h(
              'div',
              { class: 'reveal-list' },
              event.options
                .filter((op) => op.reveal)
                .map((op) => h('div', {}, [h('b', { text: `${op.key} → ` }), L(op.reveal)]))
            ),
          ])
        : null;

    const front = h('div', { class: 'gcard card-front' }, [
      head,
      h('div', { class: 'gcard-body two-col' }, [left, choices, revealBlock].filter(Boolean)),
    ]);

    const scene = h('div', { class: `card3d${o.flipIn ? '' : ' is-open'}` }, [
      h('div', { class: 'card3d-inner' }, [front, cardBack(event)]),
    ]);

    /* Face cachée à l'arrivée, puis retournement une fois posée dans le DOM. */
    if (o.flipIn) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => scene.classList.add('is-open'));
      });
    }

    return scene;
  }

  /* ------------------------------------------------------------------- chrono */

  /** Chrono : anneau de progression + chiffres + barre. */
  function createTimer() {
    const digits = h('div', { class: 'timer', text: '--:--' });
    const ring = h('div', { class: 'timer-ring' }, [digits]);
    const fill = h('i', { style: 'width:0%' });
    const bar = h('div', { class: 'timer-bar' }, [fill]);
    const label = h('div', { class: 'small muted' });
    const node = h('div', { class: 'timer-wrap' }, [
      ring,
      h('div', { class: 'stack', style: 'gap:6px;flex:1 1 140px;min-width:120px' }, [label, bar]),
    ]);

    function update(round) {
      digits.classList.remove('warn', 'danger', 'done');
      bar.classList.remove('warn', 'danger');
      ring.classList.remove('warn', 'danger', 'done');

      if (!round) {
        digits.textContent = '--:--';
        digits.classList.add('done');
        ring.classList.add('done');
        ring.style.setProperty('--pct', 0);
        fill.style.width = '0%';
        label.textContent = '';
        return 0;
      }

      /* En arbitrage, le chrono bascule sur la fenêtre laissée au DG. */
      const arbitrating = round.status === 'arbitration' && round.arbitrationEndsAt;
      const totalMs = arbitrating
        ? Math.max(1, round.arbitrationEndsAt - (round.closedAt || round.arbitrationEndsAt))
        : Math.max(1, (round.durationSec || 1) * 1000);

      let remaining;
      if (round.status === 'closed') remaining = 0;
      else if (arbitrating) remaining = round.arbitrationEndsAt - now();
      else if (round.pausedAt) remaining = round.endsAt - round.pausedAt;
      else remaining = round.endsAt - now();
      remaining = Math.max(0, remaining);

      digits.textContent = fmtClock(remaining);
      const pct = Math.max(0, Math.min(100, (remaining / totalMs) * 100));
      fill.style.width = `${pct}%`;
      ring.style.setProperty('--pct', Math.round(pct));

      if (round.status === 'closed') {
        digits.classList.add('done');
        ring.classList.add('done');
        label.textContent = t('play.closed');
      } else if (arbitrating) {
        digits.classList.add('danger');
        bar.classList.add('danger');
        ring.classList.add('danger');
        label.textContent = t('play.tie');
      } else if (round.pausedAt) {
        digits.classList.add('warn');
        ring.classList.add('warn');
        label.textContent = t('play.paused');
      } else if (remaining <= 0) {
        digits.classList.add('done');
        ring.classList.add('done');
        label.textContent = t('play.timeUp');
      } else if (pct <= 20) {
        digits.classList.add('danger');
        bar.classList.add('danger');
        ring.classList.add('danger');
        label.textContent = t('play.timeLeft');
      } else if (pct <= 50) {
        digits.classList.add('warn');
        bar.classList.add('warn');
        ring.classList.add('warn');
        label.textContent = t('play.timeLeft');
      } else {
        label.textContent = t('play.timeLeft');
      }
      return remaining;
    }

    return { node, digits, update };
  }

  /** Gros chiffre « points gagnés » (uniquement après dévoilement). */
  function deltaChip(value, labelKey) {
    return h('div', { class: `delta-chip ${signClass(value)}` }, [
      h('small', { text: t(labelKey) }),
      h('span', { text: fmtSigned(value) }),
    ]);
  }

  /* -------------------------------------------------------------- classements */

  /* Les archives d'avant le classement par événement n'ont pas de rang : mieux
     vaut un tiret qu'un « undefined » dans la médaille. */
  function rankMedal(rank) {
    const n = Number(rank);
    const cls = n === 1 ? 'g1' : n === 2 ? 'g2' : n === 3 ? 'g3' : '';
    return h('span', {
      class: `rank-medal ${cls}`.trim(),
      text: Number.isFinite(n) ? String(n) : '—',
    });
  }

  /** Classement d'un événement : une ligne par table qui l'a joué. */
  function eventRankTable(entry, opts) {
    const o = opts || {};
    const rows = (entry && entry.rows) || [];
    if (!rows.length) return h('p', { class: 'muted small', text: '—' });

    return h('div', { class: 'table-wrap results-table' }, [
      h('table', { class: 'table' }, [
        h('thead', {}, [
          h('tr', {}, [
            h('th', { text: t('score.rank') }),
            h('th', { text: t('score.team') }),
            h('th', { text: t('score.choice') }),
            h('th', { class: 'num', text: t('score.votes') }),
            h('th', { class: 'num', text: t('score.points') }),
            h('th', { class: 'num', text: t('score.seconds') }),
          ]),
        ]),
        h(
          'tbody',
          {},
          rows.map((row) => {
            const classes = [];
            if (row.rank === 1) classes.push('is-winner');
            if (o.teamId && row.teamId === o.teamId) classes.push('is-me');
            const tally = row.tally || {};
            return h('tr', { class: classes.join(' ') }, [
              h('td', { class: 'rank' }, [rankMedal(row.rank)]),
              h('td', {}, [
                h('span', { text: row.teamName }),
              ]),
              h('td', {}, [
                h('span', { text: row.decision || t('score.noAnswer') }),
                h('div', { class: 'small muted', text: decidedByText(row.decidedBy) }),
              ]),
              h('td', {
                class: 'num muted',
                text: row.tally ? `${tally.A || 0}/${tally.B || 0}/${tally.C || 0}` : '—',
              }),
              h('td', { class: `num ${signClass(row.total)}`, text: fmtSigned(row.total) }),
              h('td', { class: 'num muted', text: row.seconds == null ? '—' : String(row.seconds) }),
            ]);
          })
        ),
      ]),
    ]);
  }

  /**
   * Classement général.
   * compact : 4 colonnes (colonne latérale ou téléphone) ; sinon acte par acte.
   */
  function leaderboardTable(rows, opts) {
    const o = opts || {};
    if (!rows || !rows.length) return h('p', { class: 'muted small', text: t('admin.noTables') });

    const head = o.compact
      ? [
          h('th', { text: t('score.rank') }),
          h('th', { text: t('score.team') }),
          h('th', { class: 'num', text: t('score.total') }),
        ]
      : [
          h('th', { text: t('score.rank') }),
          h('th', { text: t('score.team') }),
          h('th', { class: 'num', text: t('score.act1') }),
          h('th', { class: 'num', text: t('score.act2') }),
          o.noAdjust ? null : h('th', { class: 'num', text: t('score.adjust') }),
          h('th', { class: 'num', text: t('score.total') }),
        ];

    return h('div', { class: 'table-wrap' }, [
      h('table', { class: 'table' }, [
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
                  h('td', { class: 'rank' }, [rankMedal(row.rank)]),
                  h('td', {}, [
                    h('div', { class: 'p-name', text: row.name }),
                    row.act1Profile
                      ? h('div', {
                          class: 'small muted',
                          text: `${L(row.act1Profile.label)} · ${L(row.act2Profile.label)}`,
                        })
                      : null,
                  ]),
                  h('td', { class: `num ${signClass(row.total)}`, text: fmtSigned(row.total) }),
                ]
              : [
                  h('td', { class: 'rank' }, [rankMedal(row.rank)]),
                  h('td', {}, [
                    h('div', { text: row.name }),
                    row.act1Profile
                      ? h('div', {
                          class: 'small muted',
                          text: `${L(row.act1Profile.label)} · ${L(row.act2Profile.label)}`,
                        })
                      : null,
                  ]),
                  h('td', { class: `num ${signClass(row.act1)}`, text: fmtSigned(row.act1) }),
                  h('td', { class: `num ${signClass(row.act2)}`, text: fmtSigned(row.act2) }),
                  o.noAdjust
                    ? null
                    : h('td', { class: `num ${signClass(row.adjust)}`, text: fmtSigned(row.adjust) }),
                  h('td', {
                    class: `num ${signClass(row.total)}`,
                    style: 'font-weight:700',
                    text: fmtSigned(row.total),
                  }),
                ];
            return h('tr', { class: classes.join(' ') }, cells);
          })
        ),
      ]),
    ]);
  }

  /** Classement intermédiaire d'un acte : rang, table, points de l'acte. */
  function actBoardTable(rows, opts) {
    const o = opts || {};
    if (!rows || !rows.length) return h('p', { class: 'muted small', text: t('admin.noTables') });
    return h('div', { class: 'table-wrap' }, [
      h('table', { class: 'table' }, [
        h('thead', {}, [
          h('tr', {}, [
            h('th', { text: t('score.rank') }),
            h('th', { text: t('score.team') }),
            h('th', { class: 'num', text: t('score.act1') }),
          ]),
        ]),
        h(
          'tbody',
          {},
          rows.map((row) => {
            const classes = [];
            if (row.rank === 1) classes.push('is-winner');
            if (o.teamId && row.teamId === o.teamId) classes.push('is-me');
            return h('tr', { class: classes.join(' ') }, [
              h('td', { class: 'rank' }, [rankMedal(row.rank)]),
              h('td', {}, [
                h('div', { text: row.name }),
                row.act1Profile
                  ? h('div', { class: 'small muted', text: L(row.act1Profile.label) })
                  : null,
              ]),
              h('td', { class: `num ${signClass(row.act1)}`, text: fmtSigned(row.act1) }),
            ]);
          })
        ),
      ]),
    ]);
  }

  /** Historique d'une table : décisions prises, points seulement si dévoilés. */
  function historyTable(history, opts) {
    const o = opts || {};
    const rows = history || [];
    if (!rows.length) return h('p', { class: 'muted small', text: t('team.noHistory') });

    const head = [
      h('th', { text: t('score.event') }),
      h('th', { text: t('score.choice') }),
      h('th', { class: 'num', text: t('score.votes') }),
    ];
    if (o.showScores) head.push(h('th', { class: 'num', text: t('score.points') }));

    return h('div', { class: 'table-wrap' }, [
      h('table', { class: 'table' }, [
        h('thead', {}, [h('tr', {}, head)]),
        h(
          'tbody',
          {},
          rows.map((row) => {
            const tally = row.tally || {};
            const cells = [
              h('td', {}, [
                h('span', { text: L(row.title) }),
                h('div', { class: 'small muted', text: L(row.ref) }),
              ]),
              h('td', {}, [
                h('span', { text: row.decision || t('score.noAnswer') }),
                h('div', { class: 'small muted', text: decidedByText(row.decidedBy) }),
              ]),
              h('td', {
                class: 'num muted',
                text: row.tally ? `${tally.A || 0}/${tally.B || 0}/${tally.C || 0}` : '—',
              }),
            ];
            if (o.showScores) {
              cells.push(
                h('td', { class: `num ${signClass(row.total)}`, text: fmtSigned(row.total) })
              );
            }
            return h('tr', {}, cells);
          })
        ),
      ]),
    ]);
  }

  /* ---------------------------------------------------------- bilan d'acte */

  /** Vue d'ensemble d'une table, affichée uniquement lorsque les deux actes sont terminés. */
  function gameCompletedOverview(results) {
    const act1 = (results || []).find((result) => Number(result.act) === 1);
    const act2 = (results || []).find((result) => Number(result.act) === 2);
    if (!act1 || !act2) return null;
    const metric = (label, value) =>
      h('div', { class: 'metric' }, [
        h('div', { class: 'k', text: label }),
        h('div', { class: 'v small', text: fmtSigned(value || 0) }),
      ]);

    return h('section', { class: 'panel game-completed-overview' }, [
      h('div', { class: 'panel-head' }, [h('h2', { text: t('play.finalTitle') })]),
      h('div', { class: 'score-strip' }, [
        metric(t('score.total'), Number(act1.score || 0) + Number(act2.score || 0)),
        metric(t('score.act1'), act1.score),
        metric(t('score.act2'), act2.score),
      ]),
      h('div', { class: 'grid cols-2 game-completed-profiles' }, [
        profileCard('score.profile1', act1.profile),
        profileCard('score.profile2', act2.profile, 'blue'),
      ]),
    ]);
  }

  /** Résultat d'une table dès que la dernière carte de l'acte est rangée. */
  function actResultCard(result) {
    if (!result) return h('div', {});
    const act = result.act || 1;
    return h('section', { class: 'act-result' }, [
      h('div', { class: 'act-result-head' }, [
        h('span', { text: t('actResult.eyebrow', { act }) }),
        h('span', { text: t('actResult.title', { act }) }),
      ]),
      h('div', { class: 'act-result-body' }, [
        h('div', { class: 'act-result-summary' }, [
          h('div', {}, [
            h('span', { class: 'meta-label', text: t('actResult.score') }),
            h('strong', { class: 'act-result-total', text: fmtSigned(result.score || 0) }),
          ]),
          h('div', { class: 'act-result-profile' }, [
            h('span', { class: 'meta-label', text: t('actResult.profile') }),
            h('strong', { text: result.profile ? L(result.profile.label) : '—' }),
            result.profile
              ? h('span', { class: 'small muted', text: L(result.profile.desc) })
              : null,
          ]),
        ]),
        result.levels && result.levels.length
          ? h('div', { class: 'act-profile-scale' }, [
              h('div', { class: 'meta-label', text: t('actResult.scaleTitle') }),
              h(
                'div',
                { class: 'act-profile-levels' },
                result.levels.map((level, index) => {
                  const selected = result.profile && level.id === result.profile.id;
                  return h(
                    'div',
                    {
                      class: [
                        'act-profile-level',
                        `level-${index + 1}`,
                        selected ? 'is-current' : '',
                      ].filter(Boolean).join(' '),
                    },
                    [
                      h('span', { class: 'level-dot', 'aria-hidden': 'true' }),
                      h('strong', { class: 'level-range', text: level.range }),
                      h('div', { class: 'level-copy' }, [
                        h('strong', { text: L(level.label) }),
                        h('span', { class: 'small muted', text: L(level.desc) }),
                      ]),
                      selected
                        ? h('span', { class: 'badge orange', text: t('actResult.current') })
                        : null,
                    ]
                  );
                })
              ),
            ])
          : null,
        h('h3', { class: 'meta-label act-result-section-title', text: t('actResult.decisionsTitle') }),
        h(
          'div',
          { class: 'act-result-rounds' },
          (result.rounds || []).map((round, index) =>
            h('div', { class: 'act-result-row' }, [
              h('div', { class: 'act-result-event' }, [
                h('span', {
                  class: 'act-result-round',
                  text: t('actResult.round', { n: round.round || index + 1 }),
                }),
                h('strong', { text: L(round.title) }),
              ]),
              h('div', { class: 'act-result-choice' }, [
                h('span', { class: 'meta-label', text: t('actResult.decision') }),
                h('strong', { text: round.decision || t('score.noAnswer') }),
              ]),
              h('div', { class: 'act-result-points' }, [
                h('span', { class: 'meta-label', text: t('score.points') }),
                h('strong', { text: fmtSigned(round.points || 0) }),
              ]),
            ])
          )
        ),
      ]),
    ]);
  }

  /* ------------------------------------------------------ twists et débrief */

  /** Carte de twist projetée à tous les écrans (superposition). */
  function twistCard(payload, opts) {
    const o = opts || {};
    if (!payload) return h('div', {});
    return h('div', { class: 'narrative' }, [
      h('div', { class: 'eyebrow', text: t('twist.flash') }),
      h('h2', { text: L(payload.title) }),
      h('p', { text: L(payload.desc) }),
      payload.when ? h('p', { class: 'small muted', text: L(payload.when) }) : null,
      o.onClose
        ? h('div', {}, [
            h('button', {
              class: 'btn btn-primary',
              type: 'button',
              text: t('btn.close'),
              onClick: o.onClose,
            }),
          ])
        : null,
    ]);
  }

  /** Bloc de débrief : messages clés, questions, phrase de clôture. */
  function debriefPanel(debrief) {
    if (!debrief) return h('div', {});
    return h('div', { class: 'stack' }, [
      debrief.lessons && debrief.lessons.length
        ? h('div', {}, [
            h('div', { class: 'meta-label', text: t('debrief.lessons') }),
            h(
              'div',
              { class: 'list' },
              debrief.lessons.map((lesson, index) =>
                h('div', { class: 'list-item' }, [
                  h('div', { class: 'grow' }, [
                    h('div', { class: 'title', text: `${index + 1}. ${L(lesson.title)}` }),
                    h('div', { class: 'small muted', text: L(lesson.text) }),
                  ]),
                ])
              )
            ),
          ])
        : null,
      debrief.questions && debrief.questions.length
        ? h('div', {}, [
            h('div', { class: 'meta-label', text: t('debrief.questions') }),
            h(
              'ul',
              { class: 'bullets' },
              debrief.questions.map((q) => h('li', { text: L(q) }))
            ),
          ])
        : null,
      debrief.punch ? h('p', { class: 'punch', text: L(debrief.punch) }) : null,
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

  /**
   * Encadre un champ numérique de deux boutons − / +.
   * Le pas et les bornes viennent du champ lui-même, pas d'un réglage à part.
   */
  function stepper(input) {
    const step = Number(input.step) || 1;
    const min = input.min === '' ? -Infinity : Number(input.min);
    const max = input.max === '' ? Infinity : Number(input.max);
    const nudge = (delta) => {
      const current = Number(input.value);
      const base = Number.isFinite(current) ? current : min;
      const next = Math.min(max, Math.max(min, base + delta * step));
      /* Un pas fractionnaire (0,5 min) traîne des flottants : on arrondit. */
      input.value = String(Math.round(next * 100) / 100);
      input.dispatchEvent(new Event('change', { bubbles: true }));
    };
    const arrow = (label, delta, titleKey) =>
      h('button', {
        class: 'btn btn-ghost',
        type: 'button',
        text: label,
        title: t(titleKey),
        'aria-label': t(titleKey),
        onClick: () => nudge(delta),
      });
    return h('div', { class: 'stepper' }, [
      arrow('−', -1, 'btn.less'),
      input,
      arrow('+', 1, 'btn.more'),
    ]);
  }

  window.CARDS = {
    icon,
    roleMedal,
    dgBadge,
    narrativeBlock,
    roleHero,
    rolesGrid,
    rosterList,
    tallyBars,
    decidedByText,
    renderCard,
    createTimer,
    deltaChip,
    rankMedal,
    eventRankTable,
    leaderboardTable,
    actBoardTable,
    historyTable,
    gameCompletedOverview,
    actResultCard,
    profileCard,
    twistCard,
    debriefPanel,
    pointsLabel,
    stepper,
  };
})();
