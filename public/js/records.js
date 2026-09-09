/* Historique des parties archivées : liste, détail, exports. */
(function () {
  'use strict';

  const { $, h, clear, api, download, toast, t, L, fmtSigned, signClass, fmtDateTime, fmtDuration } = window.SG;
  const C = window.CARDS;

  window.SG.initChrome();

  let records = [];
  let openId = null;

  async function load() {
    try {
      const res = await api('/api/records');
      records = res.records || [];
      renderList();
      if (openId) openDetail(openId);
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  function renderList() {
    const host = clear($('#list-host'));
    $('#rec-count').textContent = records.length;

    if (!records.length) {
      host.appendChild(h('p', { class: 'muted small', text: t('rec.empty') }));
      return;
    }

    host.appendChild(
      h('table', { class: 'table' }, [
        h('thead', {}, [
          h('tr', {}, [
            h('th', { text: t('rec.date') }),
            h('th', { text: t('rec.session') }),
            h('th', { class: 'num', text: t('rec.teamsCol') }),
            h('th', { class: 'num', text: t('rec.eventsCol') }),
            h('th', { text: t('rec.winnerCol') }),
            h('th', {}),
          ]),
        ]),
        h(
          'tbody',
          {},
          records.map((record) =>
            h('tr', { class: record.id === openId ? 'is-winner' : '' }, [
              h('td', { class: 'small', text: fmtDateTime(record.endedAt) }),
              h('td', {}, [
                h('div', { text: record.name }),
                h('div', {
                  class: 'small muted',
                  text: `${record.code}${record.facilitator ? ` · ${record.facilitator}` : ''}`,
                }),
              ]),
              h('td', { class: 'num', text: record.teamCount }),
              h('td', { class: 'num', text: record.eventCount }),
              h('td', {}, [
                record.winner
                  ? h('span', { class: 'badge gold', text: `${record.winner.name} · ${fmtSigned(record.winner.total)}` })
                  : h('span', { class: 'muted small', text: '—' }),
              ]),
              h('td', {}, [
                h('div', { class: 'row tight' }, [
                  h('button', {
                    class: 'btn btn-xs',
                    text: t('rec.open'),
                    onClick: () => openDetail(record.id),
                  }),
                  h('a', {
                    class: 'btn btn-xs btn-ghost',
                    href: `/api/records/${encodeURIComponent(record.id)}/csv`,
                    text: 'CSV',
                    onClick: (ev) => {
                      ev.preventDefault();
                      exportCsv(record);
                    },
                  }),
                  h('button', {
                    class: 'btn btn-xs btn-danger',
                    text: '×',
                    title: t('rec.delete'),
                    onClick: () => remove(record.id),
                  }),
                ]),
              ]),
            ])
          )
        ),
      ])
    );
  }

  function slugOf(record) {
    const slug = String(record.name || 'session')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40);
    return `${slug || 'session'}-${record.code}`;
  }

  /* Téléchargements via fetch : la phrase d'accès voyage en en-tête, pas dans l'URL. */
  async function exportCsv(record) {
    try {
      await download(`/api/records/${encodeURIComponent(record.id)}/csv`, `${slugOf(record)}.csv`);
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function exportJson(record) {
    try {
      await download(`/api/records/${encodeURIComponent(record.id)}`, `${slugOf(record)}.json`);
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function remove(id) {
    if (!window.confirm(t('rec.deleteConfirm'))) return;
    try {
      await api(`/api/records/${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (openId === id) {
        openId = null;
        clear($('#detail-host'));
      }
      await load();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function openDetail(id) {
    openId = id;
    let record;
    try {
      const res = await api(`/api/records/${encodeURIComponent(id)}`);
      record = res.record;
    } catch (err) {
      toast(err.message, 'error');
      return;
    }

    renderList();
    const host = clear($('#detail-host'));

    host.appendChild(
      h('section', { class: 'panel gold' }, [
        h('div', { class: 'panel-head' }, [
          h('div', {}, [
            h('div', { class: 'eyebrow', text: record.code }),
            h('h2', { text: record.name }),
            h('div', { class: 'small muted', text: fmtDateTime(record.endedAt) }),
          ]),
          h('div', { class: 'spacer' }),
          h('a', {
            class: 'btn btn-sm',
            href: `/api/records/${encodeURIComponent(record.id)}/csv`,
            text: t('rec.csv'),
            onClick: (ev) => {
              ev.preventDefault();
              exportCsv(record);
            },
          }),
          h('a', {
            class: 'btn btn-sm btn-ghost',
            href: `/api/records/${encodeURIComponent(record.id)}`,
            text: t('rec.json'),
            onClick: (ev) => {
              ev.preventDefault();
              exportJson(record);
            },
          }),
        ]),
        h('div', { class: 'grid cols-4' }, [
          metric(t('rec.teamsCol'), record.teamCount),
          metric(t('rec.eventsCol'), record.eventCount),
          metric(t('rec.duration'), fmtDuration(record.endedAt - (record.startedAt || record.createdAt))),
          metric(t('rec.winnerCol'), record.winner ? record.winner.name : '—'),
        ]),
      ])
    );

    host.appendChild(
      h('section', { class: 'panel' }, [
        h('div', { class: 'panel-head' }, [h('h3', { text: t('rec.standings') })]),
        h('div', { class: 'table-wrap' }, [C.leaderboardTable(record.leaderboard, {})]),
      ])
    );

    const eventsPanel = h('section', { class: 'panel' }, [
      h('div', { class: 'panel-head' }, [h('h3', { text: t('rec.events') })]),
    ]);
    if (!record.events.length) {
      eventsPanel.appendChild(h('p', { class: 'muted small', text: t('admin.noHistory') }));
    }
    for (const event of record.events) {
      eventsPanel.appendChild(
        h('details', { class: 'list-item', style: 'display:block' }, [
          h('summary', { style: 'cursor:pointer' }, [
            h('span', { class: 'title', text: `#${event.no} ${L(event.title)}` }),
            h('span', {
              class: 'muted small',
              text: ` — ${t('admin.winnerOf')} : ${event.winners.join(' · ') || '—'}`,
            }),
          ]),
          h('div', { class: 'table-wrap', style: 'margin-top:10px' }, [
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
                event.results.map((row) =>
                  h('tr', { class: event.winners.includes(row.team) ? 'is-winner' : '' }, [
                    h('td', { text: row.team }),
                    h('td', { text: row.choice || t('score.noAnswer') }),
                    h('td', { class: `num ${signClass(row.total)}`, text: fmtSigned(row.total) }),
                    h('td', { class: 'num muted', text: row.seconds == null ? '—' : row.seconds }),
                  ])
                )
              ),
            ]),
          ]),
        ])
      );
    }
    host.appendChild(eventsPanel);

    if (record.adjustments && record.adjustments.length) {
      host.appendChild(
        h('section', { class: 'panel' }, [
          h('div', { class: 'panel-head' }, [h('h3', { text: t('rec.adjustments') })]),
          h('div', { class: 'table-wrap' }, [
            h('table', { class: 'table' }, [
              h('thead', {}, [
                h('tr', {}, [
                  h('th', { text: t('score.team') }),
                  h('th', { class: 'num', text: t('score.points') }),
                  h('th', { text: t('admin.reason') }),
                  h('th', { text: t('rec.date') }),
                ]),
              ]),
              h(
                'tbody',
                {},
                record.adjustments.map((adj) =>
                  h('tr', {}, [
                    h('td', { text: adj.team }),
                    h('td', { class: `num ${signClass(adj.delta)}`, text: fmtSigned(adj.delta) }),
                    h('td', { class: 'small muted', text: adj.reason || '—' }),
                    h('td', { class: 'small muted', text: fmtDateTime(adj.ts) }),
                  ])
                )
              ),
            ]),
          ]),
        ])
      );
    }

    host.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function metric(k, v) {
    return h('div', { class: 'metric' }, [
      h('div', { class: 'k', text: k }),
      h('div', { class: 'v small', text: v }),
    ]);
  }

  $('#btn-refresh').addEventListener('click', load);
  window.I18N.onChange(() => {
    renderList();
    if (openId) openDetail(openId);
  });

  load();
})();
