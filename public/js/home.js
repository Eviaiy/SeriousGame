/* Page d'accueil : création de session (animateur) et inscription d'équipe. */
(function () {
  'use strict';

  const { $, h, clear, api, toast, adminStore, teamStore, t, fmtDateTime, qs } = window.SG;

  window.SG.initChrome();

  const codeInput = $('#join-code');
  const prefill = (qs('code') || '').toUpperCase();
  if (prefill) codeInput.value = prefill.slice(0, 6);

  codeInput.addEventListener('input', () => {
    codeInput.value = codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  });

  /* ------------------------------------------------------- listes mémorisées */

  function renderAdminList() {
    const list = adminStore.all();
    const box = $('#admin-resume');
    const host = clear($('#admin-list'));
    if (!list.length) {
      box.classList.add('hidden');
      return;
    }
    box.classList.remove('hidden');
    for (const entry of list) {
      host.appendChild(
        h('div', { class: 'list-item' }, [
          h('div', { class: 'grow' }, [
            h('div', { class: 'title', text: entry.name || t('app.title') }),
            h('div', { class: 'small muted', text: `${entry.code} · ${fmtDateTime(entry.ts)}` }),
          ]),
          h('a', {
            class: 'btn btn-sm btn-primary',
            href: `/admin.html?s=${encodeURIComponent(entry.sessionId)}`,
            text: t('nav.admin'),
          }),
          h('button', {
            class: 'btn btn-sm btn-ghost btn-danger',
            text: '×',
            title: t('btn.delete'),
            onClick: () => {
              adminStore.remove(entry.sessionId);
              renderAdminList();
            },
          }),
        ])
      );
    }
  }

  function renderTeamList() {
    const list = teamStore.all();
    const box = $('#team-resume');
    const host = clear($('#team-list'));
    if (!list.length) {
      box.classList.add('hidden');
      return;
    }
    box.classList.remove('hidden');
    for (const entry of list) {
      host.appendChild(
        h('div', { class: 'list-item' }, [
          h('div', { class: 'grow' }, [
            h('div', { class: 'title', text: entry.teamName }),
            h('div', { class: 'small muted', text: `${entry.code} · ${fmtDateTime(entry.ts)}` }),
          ]),
          h('a', {
            class: 'btn btn-sm btn-primary',
            href: `/play.html?s=${encodeURIComponent(entry.sessionId)}`,
            text: t('home.resumeTeam'),
          }),
          h('button', {
            class: 'btn btn-sm btn-ghost btn-danger',
            text: '×',
            title: t('btn.delete'),
            onClick: () => {
              teamStore.remove(entry.sessionId);
              renderTeamList();
            },
          }),
        ])
      );
    }
  }

  renderAdminList();
  renderTeamList();
  window.I18N.onChange(() => {
    renderAdminList();
    renderTeamList();
  });

  /* -------------------------------------------------------------- animateur */

  $('#create-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = event.target.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      const res = await api('/api/sessions', {
        method: 'POST',
        body: {
          name: $('#session-name').value.trim(),
          facilitator: $('#facilitator').value.trim(),
          lang: window.I18N.getLang(),
        },
      });
      adminStore.save({
        sessionId: res.sessionId,
        code: res.code,
        adminKey: res.adminKey,
        name: res.name,
      });
      window.location.href = `/admin.html?s=${encodeURIComponent(res.sessionId)}`;
    } catch (err) {
      toast(err.message, 'error');
      button.disabled = false;
    }
  });

  /* ----------------------------------------------------------------- équipe */

  $('#join-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const code = codeInput.value.trim().toUpperCase();
    const name = $('#team-name').value.trim();
    if (code.length !== 6) return toast(t('err.session_not_found'), 'error');
    if (name.length < 2) return toast(t('err.bad_name'), 'error');

    const button = event.target.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      const res = await api(`/api/sessions/${encodeURIComponent(code)}/teams`, {
        method: 'POST',
        body: { name },
      });
      teamStore.save({
        sessionId: res.sessionId,
        code: res.code,
        teamId: res.teamId,
        teamToken: res.teamToken,
        teamName: res.teamName,
      });
      window.location.href = `/play.html?s=${encodeURIComponent(res.sessionId)}`;
    } catch (err) {
      toast(err.message, 'error');
      button.disabled = false;
    }
    return undefined;
  });
})();
