// 邮箱视图：三栏布局（文件夹 / 列表 / 阅读）+ 批量操作 + 拖拽 + 搜索（i18n 已接入）
import { API, icon, toast, esc, fmtDate, fmtFull, fmtBytes, avatarHtml, displayNameOf } from '../api.js';
import { t } from '../i18n.js';
import { openCompose } from './compose.js';

const FOLDER_ICONS = { inbox: 'inbox', sent: 'send', drafts: 'draft', trash: 'trash', junk: 'junk', archive: 'archive', custom: 'folder' };

const state = {
  folders: [],
  folderId: null,
  messages: [],
  selected: new Set(),
  current: null,
  search: '',
  starredOnly: false,
  unreadOnly: false,
  page: 1,
  total: 0,
  pollTimer: null,
};

// 全局刷新事件（写信用）
if (!window._omRefreshBound) {
  window._omRefreshBound = true;
  document.addEventListener('mail:refresh', () => {
    loadFolders().catch(() => {});
    loadMessages().catch(() => {});
  });
}

function folderName(f) {
  return f.type === 'custom' ? f.name : t('folder.' + f.type);
}

export function render(main, route, params) {
  state.folderId = null;
  state.selected = new Set();
  state.current = null;
  main.innerHTML = `<div class="mail-layout" id="mail-layout">
    <aside class="folder-pane" id="folder-pane"></aside>
    <section class="list-pane" id="list-pane"></section>
    <section class="read-pane" id="read-pane"></section>
  </div>`;

  if (state.pollTimer) clearInterval(state.pollTimer);
  state.pollTimer = setInterval(async () => {
    if (document.hidden) return;
    try { await loadFolders(); } catch {}
  }, 25000);

  return (async () => {
    await loadFolders();
    if (params === 'starred') {
      const starredF = state.folders.find(f => f.type === 'inbox');
      state.folderId = starredF?.id;
      state.starredOnly = true;
    } else {
      const inbox = state.folders.find(f => f.type === 'inbox');
      state.folderId = inbox?.id;
    }
    renderFolders();
    renderRead();
    await loadMessages();
  })();
}

// ---------- 文件夹 ----------
async function loadFolders() {
  const r = await API.get('/folders');
  state.folders = r.folders;
  renderFolders();
}

function renderFolders() {
  const pane = document.getElementById('folder-pane');
  if (!pane) return;
  const sys = state.folders.filter(f => f.type !== 'custom');
  const custom = state.folders.filter(f => f.type === 'custom');
  const item = (f) => `
    <div class="folder-item ${f.id === state.folderId ? 'active' : ''}" data-fid="${f.id}" data-drop="1" title="${esc(folderName(f))}">
      ${icon(FOLDER_ICONS[f.type] || 'folder')}
      <span class="fname">${esc(folderName(f))}</span>
      ${f.type === 'custom' ? `<span class="factions"><button data-del="${f.id}" title="${t('mail.delete')}">${icon('trash')}</button></span>` : ''}
      ${f.unread > 0 && f.type !== 'drafts' && f.type !== 'sent' && f.type !== 'trash' ? `<span class="ucount">${f.unread}</span>` : ''}
      ${f.type === 'drafts' && f.total > 0 ? `<span class="badge">${f.total}</span>` : ''}
    </div>`;
  pane.innerHTML = `
    <div class="folder-head"><span>${t('mail.folders')}</span><span style="display:flex;gap:4px"><button class="btn btn-ghost btn-icon btn-sm" id="new-folder" title="${t('mail.new_folder')}">${icon('plus')}</button><button class="btn btn-ghost btn-icon btn-sm m-back" id="m-close-folders" title="${t('contacts.cancel')}">${icon('x')}</button></span></div>
    <div class="folder-list">
      ${sys.map(item).join('')}
      ${custom.length ? `<div class="folder-sep"></div>${custom.map(item).join('')}` : ''}
    </div>`;

  pane.querySelectorAll('.folder-item').forEach(el => {
    el.addEventListener('click', (e) => {
      if (e.target.closest('[data-del]')) return;
      document.getElementById('mail-layout')?.classList.remove('folder-open');
      switchFolder(parseInt(el.dataset.fid));
    });
    el.addEventListener('dragover', e => { e.preventDefault(); el.classList.add('drop-target'); });
    el.addEventListener('dragleave', () => el.classList.remove('drop-target'));
    el.addEventListener('drop', async (e) => {
      e.preventDefault();
      el.classList.remove('drop-target');
      const ids = [...state.selected];
      if (!ids.length) return;
      await API.post('/messages/batch', { ids, action: 'move', folderId: parseInt(el.dataset.fid) });
      toast(t('toast.moved', { n: ids.length }), 'ok');
      state.selected.clear();
      await Promise.all([loadFolders(), loadMessages()]);
      renderRead();
    });
  });
  pane.querySelectorAll('[data-del]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const fid = parseInt(btn.dataset.del);
      const f = state.folders.find(x => x.id === fid);
      if (!confirm(t('confirm.del_folder', { name: f.name }))) return;
      await API.del('/folders/' + fid);
      toast(t('toast.folder_deleted'), 'ok');
      if (state.folderId === fid) {
        const inbox = state.folders.find(x => x.type === 'inbox');
        await switchFolder(inbox.id);
      }
      loadFolders();
    });
  });
  pane.querySelector('#m-close-folders').addEventListener('click', () => document.getElementById('mail-layout')?.classList.remove('folder-open'));
  pane.querySelector('#new-folder').addEventListener('click', () => {
    const name = prompt(t('prompt.folder_name'));
    if (!name || !name.trim()) return;
    API.post('/folders', { name: name.trim() }).then(() => { toast(t('toast.folder_created'), 'ok'); loadFolders(); }).catch(e => toast(e.message, 'err'));
  });
}

async function switchFolder(fid) {
  state.folderId = fid;
  state.selected.clear();
  state.search = '';
  state.starredOnly = false;
  state.unreadOnly = false;
  state.page = 1;
  state.current = null;
  renderFolders();
  renderList();
  renderRead();
  await loadMessages();
}

// ---------- 列表 ----------
async function loadMessages() {
  try {
    const q = state.search ? `&q=${encodeURIComponent(state.search)}` : '';
    const r = await API.get(`/messages?folderId=${state.folderId || ''}&page=${state.page}&pageSize=50${q}${state.starredOnly ? '&starred=1' : ''}${state.unreadOnly ? '&unread=1' : ''}`);
    if (r.searchAll) {
      state.messages = r.messages;
      state.total = r.messages.length;
    } else {
      state.messages = r.messages;
      state.total = r.total;
      if (r.folder) {
        state.folderId = r.folder.id;
        renderFolders();
      }
    }
  } catch (e) { toast(e.message, 'err'); return; }
  renderList();
}

function renderList() {
  const pane = document.getElementById('list-pane');
  if (!pane) return;
  const folder = state.folders.find(f => f.id === state.folderId);
  const isDrafts = folder?.type === 'drafts';
  const title = state.search ? state.search : (folder ? esc(folderName(folder)) : '');
  const allSel = state.messages.length > 0 && state.messages.every(m => state.selected.has(m.id));

  pane.innerHTML = `
    <div class="list-toolbar">
      <div class="row">
        <button class="btn btn-icon btn-ghost m-folders" id="m-folders" title="${t('mail.folders')}">${icon('folder')}</button>
        <button class="btn btn-primary" id="compose-btn" style="flex-shrink:0" title="${title}">${icon('plus')} ${t('mail.compose')}</button>
        <div class="search-box">${icon('search')}<input class="input" id="search-input" placeholder="${t('mail.search')}" value="${esc(state.search)}"></div>
        <button class="btn btn-icon btn-ghost" id="refresh" title="${t('admin.refresh')}">${icon('refresh')}</button>
      </div>
      <div class="batch-bar">
        <button class="btn btn-sm" id="sel-all">${allSel ? t('mail.select_all') + ' ✓' : t('mail.select_all')}</button>
        <button class="btn btn-sm" id="f-star" title="${t('mail.star_filter')}">${icon('star')}</button>
        <div class="sep"></div>
        ${batchBtns(isDrafts)}
      </div>
    </div>
    <div class="msg-list" id="msg-list">
      ${state.messages.length ? state.messages.map(rowHtml).join('') : emptyHtml()}
    </div>
    <button class="compose-fab" id="compose-fab" title="${t('mail.compose')}">${icon('plus')}</button>
    <div class="list-foot">
      <span>${t('mail.count', { n: state.total })}</span>
      <span style="display:flex;gap:6px">
        <button class="btn btn-sm btn-ghost" id="prev" ${state.page <= 1 ? 'disabled' : ''}>${t('mail.page_prev')}</button>
        <button class="btn btn-sm btn-ghost" id="next" ${state.page * 50 >= state.total ? 'disabled' : ''}>${t('mail.page_next')}</button>
      </span>
    </div>`;

  // 事件
  pane.querySelector('#refresh').addEventListener('click', () => loadMessages());
  pane.querySelector('#compose-btn').addEventListener('click', () => openCompose({ mode: 'new' }));
  pane.querySelector('#compose-fab').addEventListener('click', () => openCompose({ mode: 'new' }));
  pane.querySelector('#m-folders').addEventListener('click', () => document.getElementById('mail-layout')?.classList.toggle('folder-open'));
  const si = pane.querySelector('#search-input');
  let deb;
  si.addEventListener('input', () => {
    clearTimeout(deb);
    deb = setTimeout(() => { state.search = si.value.trim(); state.page = 1; loadMessages(); }, 350);
  });
  si.addEventListener('keydown', e => { if (e.key === 'Enter') { state.search = si.value.trim(); loadMessages(); } });
  pane.querySelector('#sel-all').addEventListener('click', () => {
    if (allSel) state.selected.clear();
    else state.messages.forEach(m => state.selected.add(m.id));
    renderList();
  });
  pane.querySelector('#f-star').addEventListener('click', () => { state.starredOnly = !state.starredOnly; state.page = 1; loadMessages(); });
  bindBatchBtns(pane, isDrafts);
  pane.querySelector('#prev').addEventListener('click', () => { state.page--; loadMessages(); });
  pane.querySelector('#next').addEventListener('click', () => { state.page++; loadMessages(); });

  pane.querySelectorAll('.msg-item').forEach(el => {
    const id = parseInt(el.dataset.id);
    el.addEventListener('click', (e) => {
      if (e.target.closest('[data-star]') || e.target.closest('[data-check]')) return;
      openMessage(id);
    });
    el.addEventListener('dragstart', (e) => {
      if (!state.selected.has(id)) { state.selected.clear(); state.selected.add(id); renderList(); }
      e.dataTransfer.setData('text/plain', String(id));
    });
    el.draggable = true;
  });
  pane.querySelectorAll('[data-check]').forEach(cb => {
    cb.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = parseInt(cb.dataset.check);
      cb.checked ? state.selected.add(id) : state.selected.delete(id);
      cb.closest('.msg-item').classList.toggle('selected', cb.checked);
      const c = pane.querySelector('#sel-count');
      if (c) c.textContent = state.selected.size ? t('mail.selected', { n: state.selected.size }) : '';
    });
  });
  pane.querySelectorAll('[data-star]').forEach(st => {
    st.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = parseInt(st.dataset.star);
      const m = state.messages.find(x => x.id === id);
      await API.post(`/messages/${id}/flags`, { is_starred: !m.is_starred });
      m.is_starred = m.is_starred ? 0 : 1;
      renderList();
      loadFolders();
    });
  });
}

function batchBtns(isDrafts) {
  return `
    <button class="btn btn-sm" data-batch="read">${icon('check')} ${t('mail.read')}</button>
    <button class="btn btn-sm" data-batch="unread">${t('mail.unread')}</button>
    ${isDrafts
      ? `<div class="sep"></div><button class="btn btn-sm" data-batch="delete_forever">${t('mail.delete')}</button>`
      : `<div class="sep"></div>
         <button class="btn btn-sm" data-batch="star">${icon('star')} ${t('mail.star')}</button>
         <button class="btn btn-sm" data-batch="trash">${icon('trash')} ${t('mail.delete')}</button>`}
    <span id="sel-count" style="color:var(--text-3);font-size:12px"></span>`;
}
function bindBatchBtns(pane, isDrafts) {
  const updCount = () => { const c = pane.querySelector('#sel-count'); if (c) c.textContent = state.selected.size ? t('mail.selected', { n: state.selected.size }) : ''; };
  updCount();
  pane.querySelectorAll('[data-batch]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const ids = [...state.selected];
      if (!ids.length) return toast(t('compose.need_rcpt'), 'err');
      const action = btn.dataset.batch;
      if (action === 'delete_forever' && !confirm(t('confirm.delete_drafts', { n: ids.length }))) return;
      if (action === 'trash' && !confirm(t('confirm.move_trash', { n: ids.length }))) return;
      await API.post('/messages/batch', { ids, action });
      state.selected.clear();
      await Promise.all([loadFolders(), loadMessages()]);
      renderRead();
      toast(t('toast.batch_done'), 'ok');
    });
  });
}

function rowHtml(m) {
  const folder = state.folders.find(f => f.id === state.folderId);
  const isDraft = m.is_draft || folder?.type === 'drafts';
  const subject = m.subject || t('mail.no_subject');
  return `
    <div class="msg-item ${m.is_read ? '' : 'unread'} ${state.selected.has(m.id) ? 'selected' : ''}" data-id="${m.id}">
      <input type="checkbox" data-check="${m.id}" ${state.selected.has(m.id) ? 'checked' : ''} style="margin-top:4px;accent-color:var(--primary)">
      <div class="m-flags">
        <button class="star ${m.is_starred ? '' : 'off'}" data-star="${m.id}" title="${t('mail.star')}">${icon('star')}</button>
        ${m.has_attachments ? `<span class="atch" title="${t('compose.attach')}">${icon('paperclip')}</span>` : ''}
        ${m.send_status === 'queued' ? `<span class="atch" title="${t('compose.schedule')}">${icon('clock')}</span>` : ''}
        ${m.send_status === 'failed' ? `<span class="atch" style="color:var(--danger)" title="${t('mail.sched_failed')}">${icon('alert')}</span>` : ''}
      </div>
      ${avatarHtml(isDraft ? t('mail.draft_label').slice(0, 1) : displayNameOf(m), 'avatar-sm')}
      <div class="m-main">
        <div class="m-top">
          <span class="m-from">${isDraft ? esc(t('folder.draft_prefix')) : ''}${esc(isDraft ? subject : displayNameOf(m))}</span>
          <span class="m-date">${fmtDate(m.scheduled_at || m.delivered_at)}</span>
        </div>
        <div class="m-subject">${esc(subject)}</div>
        <div class="m-snip">${esc(m.snippet || '')}</div>
      </div>
    </div>`;
}

function emptyHtml() {
  return `<div class="empty-state">${icon('mail')}<div>${t('mail.nomail')}</div><div style="font-size:12px">${t('mail.nomail_hint')}</div></div>`;
}

// ---------- 阅读 ----------
async function openMessage(id, peek = false) {
  try {
    const r = await API.get(`/messages/${id}${peek ? '?peek=1' : ''}`);
    state.current = r.message;
    if (window.matchMedia('(max-width: 768px)').matches) {
      document.getElementById('mail-layout')?.classList.add('reading');
    }
    if (!state.search) {
      const m = state.messages.find(x => x.id === id);
      if (m && !m.is_read) { m.is_read = 1; renderList(); loadFolders(); }
    }
    renderRead();
  } catch (e) { toast(e.message, 'err'); }
}

function closeMobileRead() {
  document.getElementById('mail-layout')?.classList.remove('reading');
}

function sanitizeHtml(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script,style,iframe,object,embed,link,meta,form').forEach(el => el.remove());
  doc.querySelectorAll('*').forEach(el => {
    for (const attr of [...el.attributes]) {
      if (/^on/i.test(attr.name)) el.removeAttribute(attr.name);
      if (/^href|src$/i.test(attr.name) && /^\s*javascript:/i.test(attr.value)) el.removeAttribute(attr.name);
    }
    if (el.tagName === 'A') { el.setAttribute('target', '_blank'); el.setAttribute('rel', 'noopener noreferrer'); }
    const src = el.getAttribute('src') || '';
    const cidMatch = src.match(/^cid:(.+)/i);
    if (cidMatch) {
      const att = (state.current?.attachments || []).find(a => a.content_id && a.content_id.includes(cidMatch[1]));
      if (att) el.setAttribute('src', `/api/attachments/${att.id}/inline`);
    }
  });
  return doc.body.innerHTML;
}

function renderRead() {
  const pane = document.getElementById('read-pane');
  if (!pane) return;
  const m = state.current;
  if (!m) {
    pane.innerHTML = `<div class="empty-state" style="height:100%">${icon('mail')}<div>${t('mail.pick')}</div></div>`;
    return;
  }
  const folder = state.folders.find(f => f.id === m.folder_id);
  const isDraft = !!m.is_draft;
  const junk = folder?.type === 'junk' || m.spam_score >= 5;
  const scheduled = m.is_draft && m.scheduled_at && m.send_status === '';

  pane.innerHTML = `
    <div class="read-toolbar">
      <button class="btn btn-sm btn-icon m-back" id="a-back" title="${t('mail.pick')}">${icon('arrowleft')}</button>
      ${isDraft ? `
        <button class="btn btn-primary btn-sm" id="a-edit">${icon('draft')} ${t('compose.title_draft')}</button>
        ${scheduled ? `<span class="badge badge-blue">${icon('clock')} ${t('mail.scheduled', { time: fmtFull(m.scheduled_at) })}</span>` : ''}
        ${m.send_status === 'failed' ? `<span class="badge badge-red" title="${esc(m.send_error)}">${t('mail.sched_failed')}</span>` : ''}
      ` : `
        <button class="btn btn-sm" id="a-reply">${icon('reply')} ${t('mail.reply')}</button>
        <button class="btn btn-sm" id="a-replyall">${t('mail.replyall')}</button>
        <button class="btn btn-sm" id="a-forward">${icon('forward')} ${t('mail.forward')}</button>
        <div class="sep" style="width:1px;height:18px;background:var(--border)"></div>
        <button class="btn btn-sm" id="a-ai" style="border-color:var(--primary);color:var(--primary)">${icon('key')} ${t('ai.composer_btn')}</button>
        <button class="btn btn-sm btn-icon" id="a-star" title="${t('mail.star')}"><span class="bl">${t('mail.star')}</span>${icon('star')}</button>
        <button class="btn btn-sm btn-icon" id="a-unread" title="${t('mail.mark_unread')}"><span class="bl">${t('mail.unread')}</span>${icon('check')}</button>
        <button class="btn btn-sm btn-icon" id="a-archive" title="${t('mail.archive')}"><span class="bl">${t('mail.archive')}</span>${icon('archive')}</button>
        <button class="btn btn-sm btn-icon" id="a-trash" title="${t('mail.delete')}"><span class="bl">${t('mail.delete')}</span>${icon('trash')}</button>
      `}
      <span style="flex:1"></span>
      <span style="font-size:11.5px;color:var(--text-3)" title="auth">${esc(m.auth_results || '')}</span>
    </div>
    <div class="read-body">
      ${junk ? `<div class="junk-warn">${icon('alert')} ${t('mail.junk_warn', { score: Number(m.spam_score).toFixed(1) })}</div>` : ''}
      <div class="read-head">
        <h2>${esc(m.subject || t('mail.no_subject'))}</h2>
        <div class="rh-top">
          ${avatarHtml(isDraft ? t('mail.draft_label').slice(0, 1) : displayNameOf(m))}
          <div class="rh-meta">
            <div class="rh-line"><b>${isDraft ? t('mail.draft_label') : esc(displayNameOf(m))}</b> ${isDraft ? '' : `&lt;${esc(m.from_addr)}&gt;`}</div>
            <div class="rh-line">${t('mail.receiver')}: ${esc(m.to_addrs || '-')}${m.cc_addrs ? ' · ' + t('mail.cc') + ': ' + esc(m.cc_addrs) : ''}</div>
            <div class="rh-line">${fmtFull(m.scheduled_at || m.delivered_at)}${m.size ? ' · ' + fmtBytes(m.size) : ''}</div>
          </div>
        </div>
      </div>
      <div class="read-content" id="read-content">${
        m.body_html ? sanitizeHtml(m.body_html) : '<pre style="white-space:pre-wrap;font-family:inherit">' + esc(m.body_text || t('mail.empty_mail')) + '</pre>'
      }</div>
      ${m.attachments?.length ? `<div class="atch-list">${m.attachments.filter(a => !a.is_inline).map(a => `
        <div class="atch-item">${icon('file')}
          <div class="meta"><div class="n">${esc(a.filename)}</div><div class="s">${fmtBytes(a.size)}</div></div>
          <a class="btn btn-icon btn-ghost" href="/api/attachments/${a.id}/download" title="${t('compose.attach')}">${icon('download')}</a>
        </div>`).join('')}</div>` : ''}
    </div>`;

  const star = pane.querySelector('#a-star');
  if (star) {
    star.style.color = m.is_starred ? 'var(--star)' : '';
    star.addEventListener('click', async () => {
      await API.post(`/messages/${m.id}/flags`, { is_starred: !m.is_starred });
      m.is_starred = m.is_starred ? 0 : 1;
      renderRead(); loadFolders();
    });
    pane.querySelector('#a-reply').addEventListener('click', () => openCompose({ mode: 'reply', msg: m }));
    pane.querySelector('#a-replyall').addEventListener('click', () => openCompose({ mode: 'replyall', msg: m }));
    pane.querySelector('#a-forward').addEventListener('click', () => openCompose({ mode: 'forward', msg: m }));
    pane.querySelector('#a-ai').addEventListener('click', () => openAIMailView(m));
    pane.querySelector('#a-unread').addEventListener('click', async () => {
      await API.post(`/messages/${m.id}/read`, { read: false });
      state.current = null;
      renderRead(); loadMessages(); loadFolders();
    });
    pane.querySelector('#a-archive').addEventListener('click', async () => {
      const arc = state.folders.find(f => f.type === 'archive');
      await API.post('/messages/batch', { ids: [m.id], action: 'move', folderId: arc.id });
      state.current = null;
      toast(t('toast.archived'), 'ok');
      renderRead(); loadMessages(); loadFolders();
    });
    pane.querySelector('#a-trash').addEventListener('click', async () => {
      await API.post('/messages/batch', { ids: [m.id], action: 'trash' });
      state.current = null;
      toast(t('toast.trashed'), 'ok');
      renderRead(); loadMessages(); loadFolders();
    });
  }
  const edit = pane.querySelector('#a-edit');
  if (edit) {
    edit.addEventListener('click', () => openCompose({ mode: 'draft', msg: m }));
  }
  pane.querySelector('#a-back').addEventListener('click', () => {
    closeMobileRead();
    state.current = null;
    renderRead();
  });
}

// ---------- 阅读视图 AI（分析 / 翻译） ----------
function openAIMailView(m) {
  const m2 = modal({
    title: t('ai.composer_btn') + ' · ' + t('ai.title'),
    wide: true,
    body: `
      <div style="display:flex;gap:8px;margin-bottom:14px">
        <button class="btn btn-sm btn-primary" data-maitab="analyze">${t('ai.analyze')}</button>
        <button class="btn btn-sm" data-maitab="translate">${t('ai.translate')}</button>
      </div>
      <div id="mai-pane"><div class="spinner"></div></div>`,
    footer: `<button class="btn" data-close>${t('contacts.cancel')}</button>`,
  });
  const pane = m2.el.querySelector('#mai-pane');
  const mailText = () => (m.body_text || String(m.body_html || '').replace(/<[^>]+>/g, ' ')).slice(0, 12000);

  const runAnalyze = async () => {
    pane.innerHTML = `<div style="text-align:center;padding:20px"><span class="spinner"></span><div style="color:var(--text-3);font-size:12.5px">${t('ai.analyzing')}</div></div>`;
    try {
      const r = await API.post('/ai/analyze', { subject: m.subject, text: mailText(), lang: getLocale() });
      const badge = (s) => `<span class="badge ${/urgent/i.test(s) ? 'badge-red' : /positive/i.test(s) ? 'badge-green' : /negative/i.test(s) ? 'badge-red' : 'badge-blue'}">${esc(s)}</span>`;
      const section = (title, items) => items?.length ? `
        <div style="margin-top:12px"><div style="font-weight:700;font-size:12.5px;margin-bottom:6px">${title}</div>
        <ul style="padding-left:20px;line-height:1.9">${items.map(i => `<li>${esc(i)}</li>`).join('')}</ul></div>` : '';
      pane.innerHTML = `
        <div style="border:1px solid var(--border);border-radius:9px;padding:14px">
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><b>${t('ai.summary')}</b>${r.sentiment ? badge(r.sentiment) : ''}</div>
          <p style="margin-top:8px;line-height:1.8">${esc(r.summary || '-')}</p>
          ${section(t('ai.key_points'), r.key_points)}
          ${section(t('ai.action_items'), r.action_items)}
          ${r.suggested_reply_hint ? `<div style="margin-top:12px;padding:10px 13px;background:var(--primary-soft);border-radius:8px;font-size:13px">💡 <b>${t('ai.reply_hint')}:</b> ${esc(r.suggested_reply_hint)}</div>` : ''}
        </div>
        <div style="display:flex;gap:9px;margin-top:14px">
          <button class="btn btn-primary" id="mai-reply">${icon('reply')} ${t('mail.reply')}</button>
        </div>`;
      pane.querySelector('#mai-reply').addEventListener('click', () => { m2.close(); openCompose({ mode: 'reply', msg: m }); });
    } catch (e) {
      pane.innerHTML = `<div class="empty-state">${icon('alert')}<div>${esc(e.message)}</div><div style="font-size:12px">${t('ai.sub')}</div></div>`;
    }
  };

  const runTranslate = () => {
    const LANGS = [['zh', '简体中文'], ['en', 'English'], ['fr', 'Français'], ['es', 'Español'], ['pt', 'Português'], ['ru', 'Русский'], ['ar', 'العربية'], ['hi', 'हिन्दी'], ['bn', 'বাংলা'], ['ur', 'اردو'], ['ja', '日本語'], ['de', 'Deutsch']];
    pane.innerHTML = `
      <div class="form-row" style="align-items:flex-end">
        <div class="field"><label>${t('ai.translate_to')}</label><select class="input" id="mai-lang">
          ${LANGS.map(([c, n]) => `<option value="${c}" ${c === getLocale() ? 'selected' : ''}>${n}</option>`).join('')}
        </select></div>
      </div>
      <div id="mai-out" style="display:none;border:1px solid var(--border);border-radius:9px;padding:14px;max-height:280px;overflow:auto;font-size:13.5px;line-height:1.8;white-space:pre-wrap"></div>
      <div style="display:flex;gap:9px;margin-top:12px;align-items:center">
        <button class="btn btn-primary" id="mai-go">${t('ai.translate')}</button>
        <span id="mai-status" style="font-size:12px;color:var(--text-3)"></span>
      </div>`;
    pane.querySelector('#mai-go').addEventListener('click', async () => {
      const btn = pane.querySelector('#mai-go');
      btn.disabled = true;
      pane.querySelector('#mai-status').textContent = t('ai.generating');
      try {
        const r = await API.post('/ai/translate', { text: mailText(), targetLang: pane.querySelector('#mai-lang').value });
        const out = pane.querySelector('#mai-out');
        out.textContent = r.translated;
        out.style.display = 'block';
        pane.querySelector('#mai-status').textContent = '';
      } catch (e) { pane.querySelector('#mai-status').textContent = '✗ ' + e.message; }
      btn.disabled = false;
    });
  };

  m2.el.querySelectorAll('[data-maitab]').forEach(b => b.addEventListener('click', () => {
    m2.el.querySelectorAll('[data-maitab]').forEach(x => x.classList.toggle('btn-primary', x === b));
    (b.dataset.maitab === 'analyze' ? runAnalyze : runTranslate)();
  }));
  runAnalyze();
}

export function gotoFolder(type) {
  const f = state.folders.find(x => x.type === type);
  if (f) switchFolder(f.id);
}
export function refreshAll() { loadFolders(); loadMessages(); }
