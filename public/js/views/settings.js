// 设置：个人资料 / 安全 / 过滤规则 / 黑名单 / 语言 / AI 助手 / 邮件模板（i18n 已接入）
import { API, icon, toast, esc, modal, fmtFull, fmtBytes } from '../api.js';
import { t, getLocale, setLocale, installedLocales } from '../i18n.js';

let section = 'profile';

export async function render(main) {
  section = 'profile';
  main.innerHTML = `
    <div class="page">
      <div class="page-head"><div><h2>${t('settings.title')}</h2><div class="sub">${t('settings.sub')}</div></div></div>
      <div class="settings-grid">
        <div class="settings-nav">
          <button data-s="profile">${t('settings.profile')}</button>
          <button data-s="security">${t('settings.security')}</button>
          <button data-s="ai">${t('ai.title')}</button>
          <button data-s="templates">${t('tpl.title')}</button>
          <button data-s="filters">${t('settings.filters')}</button>
          <button data-s="blacklist">${t('settings.blacklist')}</button>
          <button data-s="language">${t('settings.language')}</button>
        </div>
        <div id="s-body" style="flex:1;min-width:0"></div>
      </div>
    </div>`;
  main.querySelectorAll('[data-s]').forEach(b => b.addEventListener('click', () => {
    section = b.dataset.s;
    main.querySelectorAll('[data-s]').forEach(x => x.classList.toggle('active', x.dataset.s === section));
    renderSection();
  }));
  renderSection();
}

async function renderSection() {
  const el = document.getElementById('s-body');
  const views = {
    profile: profileView, security: securityView, ai: aiView, templates: templatesView,
    filters: filtersView, blacklist: blacklistView, language: languageView,
  };
  el.innerHTML = '<div class="spinner"></div>';
  await views[section](el);
}

// ---------- AI 助手 ----------
async function aiView(el) {
  const r = await API.get('/ai/config');
  const c = r.config;
  el.innerHTML = `
    <div class="card"><div class="card-head"><h3>${icon('key')} ${t('ai.title')}</h3>
      <span class="badge ${c.hasKey && c.enabled ? 'badge-green' : ''}">${c.hasKey && c.enabled ? t('ai.configured') : t('ai.not_configured')}</span>
    </div><div class="card-body">
      <p style="font-size:12.5px;color:var(--text-2);margin-bottom:16px">${t('ai.sub')}</p>
      <div class="field"><label>${t('ai.baseUrl')}</label><input class="input" id="ai-url" placeholder="${t('ai.baseUrlPh')}" value="${esc(c.baseUrl || '')}"></div>
      <div class="form-row">
        <div class="field"><label>${t('ai.model')}</label><input class="input" id="ai-model" placeholder="${t('ai.modelPh')}" value="${esc(c.model || '')}"></div>
        <div class="field"><label>${t('ai.apiKey')}（${c.hasKey ? esc(c.apiKeyMasked) : t('ai.apiKeyKeep')}）</label><input class="input" id="ai-key" type="password" placeholder="${c.hasKey ? t('ai.apiKeyKeep') : 'sk-...'}"></div>
      </div>
      <div class="kv-row">
        <div><div class="k">${t('ai.enabled')}</div><div class="d">${t('ai.sub')}</div></div>
        <label class="switch"><input type="checkbox" id="ai-enabled" ${c.enabled ? 'checked' : ''}><span class="slider"></span></label>
      </div>
      <div style="display:flex;gap:10px;margin-top:16px">
        <button class="btn btn-primary" id="ai-save">${t('ai.save')}</button>
        <button class="btn" id="ai-test">${t('ai.test')}</button>
        <span id="ai-test-out" style="font-size:12.5px;color:var(--text-3);align-self:center"></span>
      </div>
      <div style="margin-top:18px;padding:14px 16px;background:var(--bg-hover);border-radius:9px;font-size:12px;color:var(--text-2);line-height:1.9">
        <b>${t('ai.title')} · ${t('ai.write')}</b> · ${t('ai.translate')} · ${t('ai.analyze')} · ${t('tpl.ai_gen')}<br>
        ${t('ai.baseUrlPh')} · ${t('ai.modelPh')} · OpenAI / DeepSeek / Moonshot / GLM / Ollama（${esc('OpenAI-compatible')}）
      </div>
    </div></div>`;

  const save = async () => {
    try {
      await API.put('/ai/config', {
        baseUrl: el.querySelector('#ai-url').value,
        model: el.querySelector('#ai-model').value,
        apiKey: el.querySelector('#ai-key').value,
        enabled: el.querySelector('#ai-enabled').checked,
      });
      toast(t('ai.saved'), 'ok');
      renderSection();
    } catch (e) { toast(e.message, 'err'); }
  };
  el.querySelector('#ai-save').addEventListener('click', save);
  el.querySelector('#ai-key').addEventListener('keydown', e => { if (e.key === 'Enter') save(); });
  el.querySelector('#ai-test').addEventListener('click', async () => {
    const out = el.querySelector('#ai-test-out');
    out.textContent = t('ai.testing');
    try {
      // 先保存再测试，保证测的是当前填写内容
      await API.put('/ai/config', {
        baseUrl: el.querySelector('#ai-url').value,
        model: el.querySelector('#ai-model').value,
        apiKey: el.querySelector('#ai-key').value,
        enabled: el.querySelector('#ai-enabled').checked,
      });
      const r = await API.post('/ai/test');
      out.textContent = `✓ ${t('ai.test_ok')} (${esc(r.reply)})`;
      out.style.color = 'var(--success)';
    } catch (e) {
      out.textContent = '✗ ' + e.message;
      out.style.color = 'var(--danger)';
    }
  });
}

// ---------- 邮件模板 ----------
async function templatesView(el) {
  const r = await API.get('/templates');
  const srcName = { manual: t('tpl.source_manual'), import: t('tpl.source_import'), ai: t('tpl.source_ai') };
  el.innerHTML = `
    <div class="card"><div class="card-head">
      <h3>${t('tpl.title')}（${r.templates.length}）</h3>
      <div style="display:flex;gap:8px">
        <button class="btn btn-sm" id="t-import">${icon('download')} ${t('tpl.import')}</button>
        <button class="btn btn-sm" id="t-ai">${icon('key')} ${t('tpl.ai_gen')}</button>
        <button class="btn btn-primary btn-sm" id="t-new">${icon('plus')} ${t('tpl.new')}</button>
      </div>
    </div><div class="card-body">
      <p style="font-size:12.5px;color:var(--text-2);margin:-4px 0 14px">${t('tpl.sub')}</p>
      ${r.templates.length ? `<div class="table-wrap"><table class="table">
        <thead><tr><th>${t('tpl.name')}</th><th>${t('compose.subject')}</th><th>${t('tpl.source')}</th><th>${t('tpl.html')}</th><th>${t('dom.created_at')}</th><th></th></tr></thead>
        <tbody>${r.templates.map(x => `
          <tr>
            <td><b>${esc(x.name)}</b></td>
            <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(x.subject || '-')}</td>
            <td><span class="badge ${x.source === 'ai' ? 'badge-blue' : x.source === 'import' ? 'badge-amber' : ''}">${srcName[x.source] || x.source}</span></td>
            <td>${fmtBytes(x.size || 0)}</td>
            <td style="font-size:12px">${fmtFull(x.updated_at)}</td>
            <td style="white-space:nowrap">
              <button class="btn btn-sm" data-tedit="${x.id}">${t('tpl.edit')}</button>
              <button class="btn btn-sm btn-ghost" data-tdel="${x.id}">${icon('trash')}</button>
            </td>
          </tr>`).join('')}</tbody>
      </table></div>` : `<div class="empty-state">${icon('mail')}<div>${t('tpl.none')}</div></div>`}
    </div></div>`;

  el.querySelector('#t-new').addEventListener('click', () => templateEditor(null));
  el.querySelector('#t-import').addEventListener('click', () => templateImport());
  el.querySelector('#t-ai').addEventListener('click', () => templateAI());
  el.querySelectorAll('[data-tedit]').forEach(b => b.addEventListener('click', async () => {
    const x = (await API.get('/templates/' + b.dataset.tedit)).template;
    templateEditor(x);
  }));
  el.querySelectorAll('[data-tdel]').forEach(b => b.addEventListener('click', async () => {
    if (!confirm(t('tpl.del_confirm'))) return;
    await API.del('/templates/' + b.dataset.tdel);
    toast(t('tpl.deleted'), 'ok');
    renderSection();
  }));
}

function templateEditor(tpl) {
  const m = modal({
    title: tpl ? t('tpl.edit') : t('tpl.new'),
    wide: true,
    body: `
      <div class="form-row">
        <div class="field"><label>${t('tpl.name')}</label><input class="input" id="te-name" value="${esc(tpl?.name || '')}" placeholder="${t('tpl.name_ph')}"></div>
        <div class="field"><label>${t('tpl.subject')}</label><input class="input" id="te-subject" value="${esc(tpl?.subject || '')}"></div>
      </div>
      <div class="field"><label>${t('tpl.html')}</label><textarea class="input" id="te-html" style="min-height:260px;font-family:ui-monospace,monospace;font-size:12px">${esc(tpl?.html || '<div style="font-family:sans-serif;max-width:640px;margin:auto">\n  <h2 style="color:#4f6ef7">标题</h2>\n  <p>正文内容…</p>\n</div>')}</textarea></div>`,
    footer: `<button class="btn" data-close>${t('contacts.cancel')}</button><button class="btn btn-primary" id="te-save">${t('contacts.save')}</button>`,
  });
  m.el.querySelector('#te-save').addEventListener('click', async () => {
    const body = {
      name: m.el.querySelector('#te-name').value.trim(),
      subject: m.el.querySelector('#te-subject').value.trim(),
      html: m.el.querySelector('#te-html').value,
    };
    if (!body.name) return toast(t('tpl.name') + ' ✓', 'err');
    try {
      if (tpl) await API.put('/templates/' + tpl.id, body);
      else await API.post('/templates', body);
      m.close();
      toast(t('tpl.saved'), 'ok');
      renderSection();
    } catch (e) { toast(e.message, 'err'); }
  });
}

function templateImport() {
  const m = modal({
    title: t('tpl.import'),
    body: `
      <div class="field"><label>${t('tpl.name')}</label><input class="input" id="ti-name" placeholder="${t('tpl.name_ph')}"></div>
      <div class="field"><label>${t('tpl.import_paste')}</label><textarea class="input" id="ti-html" style="min-height:200px;font-family:ui-monospace,monospace;font-size:12px" placeholder="<!DOCTYPE html>…"></textarea></div>
      <div class="field"><label>${t('tpl.import_file')}</label><input type="file" id="ti-file" accept=".html,.htm" class="input" style="padding:7px"></div>`,
    footer: `<button class="btn" data-close>${t('contacts.cancel')}</button><button class="btn btn-primary" id="ti-go">${t('tpl.import_go')}</button>`,
  });
  m.el.querySelector('#ti-file').addEventListener('change', (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      m.el.querySelector('#ti-html').value = reader.result;
      if (!m.el.querySelector('#ti-name').value) m.el.querySelector('#ti-name').value = f.name.replace(/\.html?$/i, '');
    };
    reader.readAsText(f);
  });
  m.el.querySelector('#ti-go').addEventListener('click', async () => {
    try {
      await API.post('/templates/import', {
        name: m.el.querySelector('#ti-name').value.trim(),
        html: m.el.querySelector('#ti-html').value,
      });
      m.close();
      toast(t('tpl.saved'), 'ok');
      renderSection();
    } catch (e) { toast(e.message, 'err'); }
  });
}

function templateAI() {
  const m = modal({
    title: t('tpl.ai_gen'),
    body: `
      <div class="field"><label>${t('ai.write_ph').split('，')[0]}</label><textarea class="input" id="ta-desc" style="min-height:90px" placeholder="${t('tpl.ai_ph')}"></textarea></div>
      <div id="ta-status" style="font-size:12.5px;color:var(--text-3)"></div>`,
    footer: `<button class="btn" data-close>${t('contacts.cancel')}</button><button class="btn btn-primary" id="ta-go">${t('ai.generate')}</button>`,
  });
  m.el.querySelector('#ta-go').addEventListener('click', async () => {
    const btn = m.el.querySelector('#ta-go');
    const status = m.el.querySelector('#ta-status');
    btn.disabled = true;
    status.innerHTML = `<span class="spinner" style="margin:8px auto;display:block"></span>${t('ai.generating')}`;
    try {
      const r = await API.post('/ai/template', { description: m.el.querySelector('#ta-desc').value });
      await API.post('/templates', { name: r.name || (t('tpl.ai_gen') + ' ' + new Date().toLocaleString()), subject: r.name || '', html: r.html, source: 'ai' });
      m.close();
      toast(t('tpl.saved'), 'ok');
      renderSection();
    } catch (e) {
      status.textContent = '✗ ' + e.message;
      btn.disabled = false;
    }
  });
}

// ---------- 个人资料 ----------
function profileView(el) {
  const u = API.user || {};
  el.innerHTML = `
    <div class="card"><div class="card-head"><h3>${t('profile.card')}</h3></div><div class="card-body">
      <div class="field"><label>${t('profile.address')}</label><input class="input" value="${esc(u.address)}" disabled style="opacity:.6"></div>
      <div class="field"><label>${t('profile.display')}</label><input class="input" id="p-name" value="${esc(u.displayName || '')}"></div>
      <div class="field"><label>${t('profile.signature')}</label><textarea class="input" id="p-sig" style="min-height:90px">${esc(u.signature || '')}</textarea></div>
      <button class="btn btn-primary" id="p-save">${t('profile.save')}</button>
    </div></div>
    <div class="card" style="margin-top:16px"><div class="card-head"><h3>${t('profile.pwd_card')}</h3></div><div class="card-body">
      <div class="form-row">
        <div class="field"><label>${t('profile.cur_pwd')}</label><input class="input" type="password" id="p-cur"></div>
        <div class="field"><label>${t('profile.new_pwd')}</label><input class="input" type="password" id="p-new"></div>
      </div>
      <button class="btn" id="p-chpwd">${t('profile.pwd_btn')}</button>
    </div></div>`;
  el.querySelector('#p-save').addEventListener('click', async () => {
    try {
      await API.put('/profile', {
        displayName: el.querySelector('#p-name').value,
        signature: el.querySelector('#p-sig').value,
      });
      API.user.displayName = el.querySelector('#p-name').value;
      API.user.signature = el.querySelector('#p-sig').value;
      localStorage.setItem('om_user', JSON.stringify(API.user));
      toast(t('profile.saved'), 'ok');
    } catch (e) { toast(e.message, 'err'); }
  });
  el.querySelector('#p-chpwd').addEventListener('click', async () => {
    try {
      await API.post('/auth/password', { current: el.querySelector('#p-cur').value, next: el.querySelector('#p-new').value });
      toast(t('profile.pwd_ok'), 'ok');
      el.querySelector('#p-cur').value = ''; el.querySelector('#p-new').value = '';
    } catch (e) { toast(e.message, 'err'); }
  });
}

// ---------- 安全 ----------
async function securityView(el) {
  const [sess, me] = await Promise.all([API.get('/auth/sessions'), API.get('/auth/me')]);
  const totpEnabled = me.user.totpEnabled;
  el.innerHTML = `
    <div class="card"><div class="card-head"><h3>${icon('shield')} ${t('sec.2fa')}</h3></div><div class="card-body">
      <div class="kv-row">
        <div><div class="k">${totpEnabled ? t('sec.2fa_on') : t('sec.2fa_off')}</div>
        <div class="d">${totpEnabled ? t('sec.2fa_on_d') : t('sec.2fa_off_d')}</div></div>
        <button class="btn ${totpEnabled ? 'btn-danger' : 'btn-primary'}" id="tw">${totpEnabled ? t('sec.disable') : t('sec.enable')}</button>
      </div>
    </div></div>
    <div class="card" style="margin-top:16px"><div class="card-head"><h3>${t('sec.sessions', { n: sess.sessions.length })}</h3><button class="btn btn-sm btn-danger" id="revoke-all">${t('sec.revoke_others')}</button></div>
      <div class="table-wrap"><table class="table">
        <thead><tr><th>${t('common.unknown')}</th><th>IP</th><th>${t('audit.time')}</th><th>${t('filters.status')}</th><th></th></tr></thead>
        <tbody>
          ${sess.sessions.map(s => `
            <tr>
              <td style="max-width:340px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(s.user_agent)}">${esc(deviceName(s.user_agent))}</td>
              <td>${esc(s.ip || '-')}</td>
              <td>${fmtFull(s.last_seen)}</td>
              <td>${s.current ? `<span class="badge badge-green">${t('sec.current')}</span>` : `<span class="badge">${t('sec.active')}</span>`}</td>
              <td>${s.current ? '' : `<button class="btn btn-sm btn-ghost" data-revoke="${s.id}">${icon('x')}</button>`}</td>
            </tr>`).join('')}
        </tbody>
      </table></div>
    </div>`;

  el.querySelector('#tw').addEventListener('click', () => totpEnabled ? disable2fa() : enable2faFlow());
  el.querySelectorAll('[data-revoke]').forEach(b => b.addEventListener('click', async () => {
    await API.del('/auth/sessions/' + b.dataset.revoke);
    toast(t('sec.revoked'), 'ok');
    renderSection();
  }));
  el.querySelector('#revoke-all').addEventListener('click', async () => {
    for (const s of sess.sessions.filter(x => !x.current)) {
      await API.del('/auth/sessions/' + s.id).catch(() => {});
    }
    toast(t('sec.all_revoked'), 'ok');
    renderSection();
  });
}

function deviceName(ua) {
  if (!ua) return t('common.unknown');
  if (/iphone/i.test(ua)) return 'iPhone';
  if (/ipad/i.test(ua)) return 'iPad';
  if (/android/i.test(ua)) return 'Android';
  if (/macintosh/i.test(ua)) return 'Mac';
  if (/windows/i.test(ua)) return 'Windows';
  if (/linux/i.test(ua)) return 'Linux';
  if (/thunderbird/i.test(ua)) return 'Thunderbird';
  return ua.slice(0, 40);
}

async function enable2faFlow() {
  const r = await API.post('/auth/2fa/setup');
  const m = modal({
    title: t('sec.enable'),
    body: `
      <p style="font-size:13px;color:var(--text-2);margin-bottom:14px">${t('sec.scan')}</p>
      <div style="text-align:center;margin-bottom:14px"><div class="qr-box"><img src="/api/auth/2fa/qr.svg?_=${Date.now()}" width="180" height="180" alt="QR"></div></div>
      <div class="otp-secret">${esc(r.secret)}</div>
      <p style="font-size:13px;color:var(--text-2);margin:14px 0">${t('sec.enter_code')}</p>
      <input class="input" id="tw-code" maxlength="6" inputmode="numeric" style="text-align:center;font-size:18px;letter-spacing:6px;font-family:ui-monospace,monospace" placeholder="000000">`,
    footer: `<button class="btn" data-close>${t('contacts.cancel')}</button><button class="btn btn-primary" id="tw-ok">${t('sec.confirm')}</button>`,
  });
  m.el.querySelector('#tw-ok').addEventListener('click', async () => {
    try {
      await API.post('/auth/2fa/enable', { code: m.el.querySelector('#tw-code').value });
      m.close();
      toast(t('sec.enable') + ' ✓', 'ok');
      renderSection();
    } catch (e) { toast(e.message, 'err'); }
  });
}

async function disable2fa() {
  const code = prompt(t('sec.disable_prompt'));
  if (!code) return;
  try {
    await API.post('/auth/2fa/disable', { code });
    toast(t('sec.disable') + ' ✓', 'ok');
    renderSection();
  } catch (e) { toast(e.message, 'err'); }
}

// ---------- 过滤规则 ----------
async function filtersView(el) {
  const [flr, fld] = await Promise.all([API.get('/filters'), API.get('/folders')]);
  const folders = fld.folders;
  const fieldName = { from: t('filters.f_from'), to: t('filters.f_to'), subject: t('filters.f_subject') };
  const actionName = { move_to: t('filters.a_move'), mark_read: t('filters.a_read'), star: t('filters.a_star'), mark_junk: t('filters.a_junk') };
  const opName = { contains: t('filters.contains'), starts_with: t('filters.starts'), equals: t('filters.equals') };
  el.innerHTML = `
    <div class="card"><div class="card-head"><h3>${t('filters.card')}</h3><button class="btn btn-primary btn-sm" id="f-new">${icon('plus')} ${t('filters.new')}</button></div>
      <div class="table-wrap"><table class="table">
        <thead><tr><th>${t('filters.name')}</th><th>${t('filters.cond')}</th><th>${t('filters.action')}</th><th>${t('filters.status')}</th><th></th></tr></thead>
        <tbody>
          ${flr.filters.length ? flr.filters.map(f => `
            <tr>
              <td><b>${esc(f.name)}</b></td>
              <td>${fieldName[f.field]} ${opName[f.operator]}「${esc(f.value)}」</td>
              <td>${actionName[f.action] || f.action}${f.action === 'move_to' && f.folder_id ? ': ' + esc(folders.find(x => x.id === f.folder_id)?.name || '?') : ''}</td>
              <td><span class="badge ${f.enabled ? 'badge-green' : ''}">${f.enabled ? t('filters.on') : t('filters.off')}</span></td>
              <td style="white-space:nowrap">
                <button class="btn btn-sm btn-ghost" data-toggle="${f.id}">${f.enabled ? t('filters.disable') : t('filters.enable')}</button>
                <button class="btn btn-sm btn-ghost" data-del="${f.id}">${icon('trash')}</button>
              </td>
            </tr>`).join('') : `<tr><td colspan="5"><div class="empty-state">${icon('mail')}<div>${t('filters.none')}</div></div></td></tr>`}
        </tbody>
      </table></div>
    </div>`;
  el.querySelector('#f-new').addEventListener('click', () => newFilter(folders));
  el.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => {
    await API.del('/filters/' + b.dataset.del);
    toast(t('contacts.deleted'), 'ok');
    renderSection();
  }));
  el.querySelectorAll('[data-toggle]').forEach(b => b.addEventListener('click', async () => {
    const f = flr.filters.find(x => x.id === parseInt(b.dataset.toggle));
    await API.put('/filters/' + f.id, { enabled: !f.enabled });
    renderSection();
  }));
}

function newFilter(folders) {
  const m = modal({
    title: t('filters.new_title'),
    body: `
      <div class="field"><label>${t('filters.rulename')}</label><input class="input" id="nf-name" placeholder="${t('filters.rulename_ph')}"></div>
      <div class="form-row">
        <div class="field"><label>${t('filters.field')}</label><select class="input" id="nf-field">
          <option value="from">${t('filters.f_from')}</option><option value="to">${t('filters.f_to')}</option><option value="subject">${t('filters.f_subject')}</option>
        </select></div>
        <div class="field"><label>${t('filters.match')}</label><select class="input" id="nf-op">
          <option value="contains">${t('filters.contains')}</option><option value="starts_with">${t('filters.starts')}</option><option value="equals">${t('filters.equals')}</option>
        </select></div>
      </div>
      <div class="field"><label>${t('filters.value')}</label><input class="input" id="nf-value" placeholder="newsletter@example.com"></div>
      <div class="field"><label>${t('filters.act')}</label><select class="input" id="nf-action">
        <option value="move_to">${t('filters.a_move')}</option><option value="mark_read">${t('filters.a_read')}</option>
        <option value="star">${t('filters.a_star')}</option><option value="mark_junk">${t('filters.a_junk')}</option>
      </select></div>
      <div class="field" id="nf-folder-row" style="display:none"><label>${t('filters.target')}</label><select class="input" id="nf-folder">
        ${folders.map(f => `<option value="${f.id}">${esc(f.name)}</option>`).join('')}
      </select></div>`,
    footer: `<button class="btn" data-close>${t('contacts.cancel')}</button><button class="btn btn-primary" id="nf-ok">${t('filters.create')}</button>`,
  });
  const act = m.el.querySelector('#nf-action');
  act.addEventListener('change', () => {
    m.el.querySelector('#nf-folder-row').style.display = act.value === 'move_to' ? 'block' : 'none';
  });
  m.el.querySelector('#nf-ok').addEventListener('click', async () => {
    try {
      await API.post('/filters', {
        name: m.el.querySelector('#nf-name').value || t('filters.unnamed'),
        field: m.el.querySelector('#nf-field').value,
        operator: m.el.querySelector('#nf-op').value,
        value: m.el.querySelector('#nf-value').value,
        action: act.value,
        folderId: act.value === 'move_to' ? parseInt(m.el.querySelector('#nf-folder').value) : null,
      });
      m.close();
      toast(t('filters.create') + ' ✓', 'ok');
      renderSection();
    } catch (e) { toast(e.message, 'err'); }
  });
}

// ---------- 黑名单 ----------
async function blacklistView(el) {
  const r = await API.get('/blacklist');
  el.innerHTML = `
    <div class="card"><div class="card-head"><h3>${t('blacklist.card')}</h3></div><div class="card-body">
      <div style="display:flex;gap:9px;margin-bottom:14px">
        <input class="input" id="bl-input" placeholder="${t('blacklist.ph')}">
        <button class="btn btn-primary" id="bl-add">${t('blacklist.add')}</button>
      </div>
      <div class="table-wrap"><table class="table">
        <thead><tr><th>${t('blacklist.pattern')}</th><th>${t('blacklist.added_at')}</th><th></th></tr></thead>
        <tbody>
          ${r.entries.length ? r.entries.map(e => `
            <tr><td><code>${esc(e.pattern)}</code></td><td>${fmtFull(e.created_at)}</td>
            <td><button class="btn btn-sm btn-ghost" data-del="${e.id}">${icon('trash')}</button></td></tr>`).join('')
          : `<tr><td colspan="3" style="color:var(--text-3)">${t('blacklist.empty')}</td></tr>`}
        </tbody>
      </table></div>
      <p style="font-size:12px;color:var(--text-3);margin-top:12px">${t('blacklist.hint')}</p>
    </div></div>`;
  el.querySelector('#bl-add').addEventListener('click', async () => {
    const v = el.querySelector('#bl-input').value.trim();
    if (!v) return;
    try {
      await API.post('/blacklist', { pattern: v });
      el.querySelector('#bl-input').value = '';
      renderSection();
    } catch (e) { toast(e.message, 'err'); }
  });
  el.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => {
    await API.del('/blacklist/' + b.dataset.del);
    renderSection();
  }));
}

// ---------- 语言 ----------
async function languageView(el) {
  const langs = await installedLocales();
  const installed = langs.filter(l => l.installed);
  const available = langs.filter(l => !l.installed);
  const cur = getLocale();
  el.innerHTML = `
    <div class="card"><div class="card-head"><h3>${t('lang.card')}</h3></div><div class="card-body">
      <p style="font-size:12.5px;color:var(--text-2);margin-bottom:14px">${t('lang.hint')}</p>
      <div class="kv-row" style="font-weight:600">${t('lang.installed')}</div>
      ${installed.map(l => langRow(l, cur)).join('')}
      ${available.length ? `<div class="kv-row" style="font-weight:600">${t('lang.available')}</div>${available.map(l => langRow(l, cur)).join('')}` : ''}
    </div></div>`;

  el.querySelectorAll('[data-setlang]').forEach(b => b.addEventListener('click', async () => {
    const code = b.dataset.setlang;
    const { setLocale: setL } = await import('../i18n.js');
    await setL(code);
    toast(b.dataset.name + ' ✓', 'ok');
    // 整页刷新使框架与当前视图全部应用新语言
    setTimeout(() => location.reload(), 400);
  }));
  el.querySelectorAll('[data-installlang]').forEach(b => b.addEventListener('click', async () => {
    try {
      await API.post('/admin/langs/install', { code: b.dataset.installlang });
      toast(t('lang.installed_ok', { name: b.dataset.name }), 'ok');
      renderSection();
    } catch (e) { toast(e.message, 'err'); }
  }));
}

function langRow(l, cur) {
  const isActive = l.code === cur;
  const actions = !l.installed && API.user?.role === 'admin'
    ? `<button class="btn btn-sm" data-installlang="${l.code}" data-name="${esc(l.name)}">${t('lang.install')}</button>`
    : `<button class="btn btn-sm ${isActive ? 'btn-primary' : ''}" data-setlang="${l.code}" data-name="${esc(l.name)}">${isActive ? '✓' : t('lang.switch')}</button>`;
  return `<div class="kv-row">
    <div><div class="k">${esc(l.name)} <span style="color:var(--text-3);font-weight:400;font-size:11.5px">${l.code}${l.rtl ? ' · RTL' : ''}</span></div></div>
    <div style="display:flex;gap:8px;align-items:center">${actions}</div>
  </div>`;
}
