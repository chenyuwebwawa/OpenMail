// 管理后台：仪表盘 / 用户 / 域名(DKIM+DNS) / 别名 / 黑名单 / 审计 / 系统设置 / 队列（i18n 已接入）
import { API, icon, toast, esc, modal, fmtFull, fmtBytes, avatarHtml } from '../api.js';
import { t } from '../i18n.js';

let section = 'dashboard';

export async function render(main) {
  section = 'dashboard';
  main.innerHTML = `
    <div class="page">
      <div class="page-head">
        <div><h2>${t('admin.title')}</h2><div class="sub">${t('admin.sub')}</div></div>
        <button class="btn" id="adm-refresh">${icon('refresh')} ${t('admin.refresh')}</button>
      </div>
      <div class="settings-grid">
        <div class="settings-nav" style="width:170px">
          <button data-s="dashboard">${t('admin.dash')}</button>
          <button data-s="users">${t('admin.users')}</button>
          <button data-s="domains">${t('admin.domains')}</button>
          <button data-s="aliases">${t('admin.aliases')}</button>
          <button data-s="queue">${t('admin.queue')}</button>
          <button data-s="blacklist">${t('admin.blacklist')}</button>
          <button data-s="audit">${t('admin.audit')}</button>
          <button data-s="sys">${t('admin.sys')}</button>
        </div>
        <div id="adm-body" style="flex:1;min-width:0"></div>
      </div>
    </div>`;
  main.querySelectorAll('[data-s]').forEach(b => b.addEventListener('click', () => {
    section = b.dataset.s;
    main.querySelectorAll('[data-s]').forEach(x => x.classList.toggle('active', x.dataset.s === section));
    renderSection();
  }));
  main.querySelector('#adm-refresh').addEventListener('click', renderSection);
  renderSection();
}

function renderSection() {
  const el = document.getElementById('adm-body');
  el.innerHTML = '<div class="spinner"></div>';
  ({ dashboard: dashView, users: usersView, domains: domainsView, aliases: aliasesView,
     queue: queueView, blacklist: blView, audit: auditView, sys: sysView }[section])(el);
}

// ---------- 仪表盘 ----------
async function dashView(el) {
  const s = await API.get('/admin/stats');
  const maxVal = Math.max(...s.chart.map(c => Math.max(c.sent, c.received)), 1);
  const W = 660, H = 160, pad = 8;
  const bw = (W - pad * 2) / s.chart.length;
  const bars = s.chart.map((c, i) => {
    const hs = (c.sent / maxVal) * (H - 30);
    const hr = (c.received / maxVal) * (H - 30);
    const x = pad + i * bw;
    return `
      <g>
        <title>${c.date} · ${t('dash.sent')} ${c.sent} / ${t('dash.received')} ${c.received}</title>
        <rect x="${x + bw * 0.14}" y="${H - 18 - hs}" width="${bw * 0.3}" height="${Math.max(hs, 1)}" rx="2.5" fill="#4f6ef7"></rect>
        <rect x="${x + bw * 0.5}" y="${H - 18 - hr}" width="${bw * 0.3}" height="${Math.max(hr, 1)}" rx="2.5" fill="#2fb487"></rect>
        ${i % 2 === 0 ? `<text x="${x + bw / 2}" y="${H - 4}" font-size="8.5" fill="#8d95a8" text-anchor="middle">${c.date.slice(5)}</text>` : ''}
      </g>`;
  }).join('');

  el.innerHTML = `
    <div class="stat-grid">
      <div class="stat-card"><div class="label">${icon('users')} ${t('dash.users')}</div><div class="value">${s.users}</div><div class="hint">${t('dash.users_hint')}</div></div>
      <div class="stat-card"><div class="label">${icon('globe')} ${t('dash.domains')}</div><div class="value">${s.domains}</div><div class="hint">${t('dash.domains_hint')}</div></div>
      <div class="stat-card"><div class="label">${icon('mail')} ${t('dash.messages')}</div><div class="value">${s.messages}</div><div class="hint">${t('dash.messages_hint')}</div></div>
      <div class="stat-card"><div class="label">${icon('archive')} ${t('dash.storage')}</div><div class="value">${fmtBytes(s.storage)}</div><div class="hint">${t('dash.storage_hint')}</div></div>
      <div class="stat-card"><div class="label">${icon('send')} ${t('dash.sent_today')}</div><div class="value">${s.sentToday}</div><div class="hint">${t('dash.queue_stat', { q: s.queue, f: s.failed })}</div></div>
      <div class="stat-card"><div class="label">${icon('inbox')} ${t('dash.recv_today')}</div><div class="value">${s.receivedToday}</div><div class="hint">${t('dash.spam_total', { n: s.spam })}</div></div>
    </div>
    <div class="card">
      <div class="card-head"><h3>${t('dash.chart')}</h3><span style="font-size:11.5px;color:var(--text-3)">${t('dash.uptime', { h: Math.floor(s.uptimeSec / 3600), v: esc(s.nodeVersion), m: s.memMB })}</span></div>
      <div class="legend"><span><i style="background:#4f6ef7"></i>${t('dash.sent')}</span><span><i style="background:#2fb487"></i>${t('dash.received')}</span></div>
      <div class="chart-box"><svg viewBox="0 0 ${W} ${H}" style="width:100%;display:block">${bars}</svg></div>
    </div>`;
}

// ---------- 用户管理 ----------
async function usersView(el) {
  const r = await API.get('/admin/users');
  el.innerHTML = `
    <div class="card"><div class="card-head">
      <h3>${t('users.count', { n: r.users.length })}</h3>
      <button class="btn btn-primary btn-sm" id="u-new">${icon('plus')} ${t('users.new')}</button>
    </div>
    <div class="table-wrap"><table class="table">
      <thead><tr><th>${t('users.usercol')}</th><th>${t('users.role')}</th><th>${t('users.status')}</th><th>${t('users.mailcol')}</th><th>${t('users.storagecol')}</th><th>2FA</th><th>${t('users.lastlogin')}</th><th></th></tr></thead>
      <tbody>${r.users.map(u => {
        const pct = Math.min(100, (u.used_bytes / Math.max(u.quota_bytes, 1)) * 100);
        return `<tr>
          <td><div style="display:flex;gap:9px;align-items:center">${avatarHtml(u.display_name || u.address, 'avatar-sm')}
            <div><div style="font-weight:600">${esc(u.display_name || u.address.split('@')[0])}</div>
            <div style="font-size:11.5px;color:var(--text-3)">${esc(u.address)}</div></div></div></td>
          <td><span class="badge ${u.role === 'admin' ? 'badge-blue' : u.role === 'temp' ? 'badge-amber' : ''}">${u.role}</span></td>
          <td><span class="badge ${u.status === 'active' ? 'badge-green' : 'badge-red'}">${u.status === 'active' ? t('users.active') : t('users.banned')}</span></td>
          <td>${u.message_count}</td>
          <td><div style="min-width:110px">${fmtBytes(u.used_bytes)} / ${fmtBytes(u.quota_bytes)}
            <div style="height:4px;background:var(--border);border-radius:3px;margin-top:4px"><div style="width:${pct}%;height:100%;border-radius:3px;background:${pct > 85 ? 'var(--danger)' : 'var(--primary)'}"></div></div></div></td>
          <td>${u.totp_enabled ? '<span class="badge badge-green">ON</span>' : '<span class="badge">OFF</span>'}</td>
          <td style="font-size:12px">${u.last_login_at ? fmtFull(u.last_login_at) : '-'}</td>
          <td style="white-space:nowrap">
            <button class="btn btn-sm" data-edit='${JSON.stringify({ id: u.id, display_name: u.display_name, role: u.role, quota: Math.round(u.quota_bytes / 1048576) })}'>${t('users.edit')}</button>
            ${u.status === 'active'
              ? `<button class="btn btn-sm" data-ban="${u.id}">${t('users.ban')}</button>`
              : `<button class="btn btn-sm" data-unban="${u.id}">${t('users.unban')}</button>`}
            <button class="btn btn-sm btn-ghost" data-del="${u.id}">${icon('trash')}</button>
          </td>
        </tr>`;
      }).join('')}</tbody>
    </table></div></div>`;

  el.querySelector('#u-new').addEventListener('click', () => {
    const m = modal({
      title: t('users.new_title'),
      body: `
        <div class="field"><label>${t('users.addr')}</label><input class="input" id="nu-addr" placeholder="user@localhost"></div>
        <div class="field"><label>${t('users.display')}</label><input class="input" id="nu-name"></div>
        <div class="form-row">
          <div class="field"><label>${t('users.role')}</label><select class="input" id="nu-role">
            <option value="user">${t('users.role_user')}</option><option value="admin">${t('users.role_admin')}</option><option value="temp">${t('users.role_temp')}</option>
          </select></div>
          <div class="field"><label>${t('users.quota')}</label><input class="input" id="nu-quota" type="number" value="1024"></div>
        </div>
        <div class="field"><label>${t('users.init_pwd')}</label><input class="input" id="nu-pass"></div>`,
      footer: `<button class="btn" data-close>${t('contacts.cancel')}</button><button class="btn btn-primary" id="nu-ok">${t('users.create')}</button>`,
    });
    m.el.querySelector('#nu-ok').addEventListener('click', async () => {
      try {
        const r = await API.post('/admin/users', {
          address: m.el.querySelector('#nu-addr').value.trim(),
          displayName: m.el.querySelector('#nu-name').value.trim(),
          role: m.el.querySelector('#nu-role').value,
          quotaMB: parseInt(m.el.querySelector('#nu-quota').value) || 1024,
          password: m.el.querySelector('#nu-pass').value || undefined,
        });
        m.close();
        if (r.initialPassword) {
          modal({ title: t('users.created'), body: `<p>${t('users.initial_pw')}:</p><div class="otp-secret">${esc(r.initialPassword)}</div><p style="font-size:12px;color:var(--text-3);margin-top:10px">${t('users.initial_pw_hint')}</p>` });
        } else toast(t('users.created'), 'ok');
        renderSection();
      } catch (e) { toast(e.message, 'err'); }
    });
  });

  el.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => {
    const u = JSON.parse(b.dataset.edit);
    const m = modal({
      title: t('users.edit_title'),
      body: `
        <div class="field"><label>${t('users.display')}</label><input class="input" id="eu-name" value="${esc(u.display_name)}"></div>
        <div class="form-row">
          <div class="field"><label>${t('users.role')}</label><select class="input" id="eu-role">
            <option value="user" ${u.role === 'user' ? 'selected' : ''}>${t('users.role_user')}</option>
            <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>${t('users.role_admin')}</option>
            <option value="temp" ${u.role === 'temp' ? 'selected' : ''}>${t('users.role_temp')}</option>
          </select></div>
          <div class="field"><label>${t('users.quota')}</label><input class="input" id="eu-quota" type="number" value="${u.quota}"></div>
        </div>
        <div class="field"><label>${t('users.reset_pwd')}</label><input class="input" id="eu-pass"></div>`,
      footer: `<button class="btn" data-close>${t('contacts.cancel')}</button><button class="btn btn-primary" id="eu-ok">${t('contacts.save')}</button>`,
    });
    m.el.querySelector('#eu-ok').addEventListener('click', async () => {
      try {
        const body = {
          displayName: m.el.querySelector('#eu-name').value,
          role: m.el.querySelector('#eu-role').value,
          quotaMB: parseInt(m.el.querySelector('#eu-quota').value),
        };
        const pw = m.el.querySelector('#eu-pass').value;
        if (pw) body.password = pw;
        await API.patch('/admin/users/' + u.id, body);
        m.close();
        toast(t('users.saved'), 'ok');
        renderSection();
      } catch (e) { toast(e.message, 'err'); }
    });
  }));
  el.querySelectorAll('[data-ban]').forEach(b => b.addEventListener('click', async () => {
    if (!confirm(t('users.ban_confirm'))) return;
    await API.patch('/admin/users/' + b.dataset.ban, { status: 'banned' });
    toast(t('users.banned_ok'), 'ok');
    renderSection();
  }));
  el.querySelectorAll('[data-unban]').forEach(b => b.addEventListener('click', async () => {
    await API.patch('/admin/users/' + b.dataset.unban, { status: 'active' });
    toast(t('users.unbanned_ok'), 'ok');
    renderSection();
  }));
  el.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => {
    if (!confirm(t('users.del_confirm'))) return;
    await API.del('/admin/users/' + b.dataset.del);
    toast(t('users.deleted_ok'), 'ok');
    renderSection();
  }));
}

// ---------- 域名管理 ----------
async function domainsView(el) {
  const r = await API.get('/admin/domains');
  el.innerHTML = `
    <div class="card"><div class="card-head">
      <h3>${t('dom.count', { n: r.domains.length })}</h3>
      <button class="btn btn-primary btn-sm" id="d-new">${icon('plus')} ${t('dom.add')}</button>
    </div>
    <div class="table-wrap"><table class="table">
      <thead><tr><th>${t('dom.name')}</th><th>${t('dom.dkim_sel')}</th><th>${t('dom.catchall')}</th><th>${t('dom.created_at')}</th><th></th></tr></thead>
      <tbody>${r.domains.map(d => `
        <tr>
          <td><b>${esc(d.name)}</b>${d.is_primary ? ` <span class="badge badge-blue">${t('dom.primary')}</span>` : ''}</td>
          <td><code>${esc(d.dkim_selector)}._domainkey</code></td>
          <td>${d.catch_all_mailbox ? `<span class="badge badge-amber">${esc(d.catch_all_mailbox)}</span>` : `<span class="badge">${t('dom.unset')}</span>`}</td>
          <td style="font-size:12px">${fmtFull(d.created_at)}</td>
          <td style="white-space:nowrap">
            <button class="btn btn-sm" data-dns="${d.id}">${t('dom.dns_btn')}</button>
            <button class="btn btn-sm" data-catch="${d.id}" data-cur="${esc(d.catch_all_mailbox || '')}">${t('dom.catchall')}</button>
            <button class="btn btn-sm btn-ghost" data-del="${d.id}">${icon('trash')}</button>
          </td>
        </tr>`).join('')}</tbody>
    </table></div></div>`;

  el.querySelector('#d-new').addEventListener('click', () => {
    const m = modal({
      title: t('dom.add_title'),
      body: `<div class="field"><label>${t('dom.name')}</label><input class="input" id="dn-name" placeholder="example.com"></div>
        <p style="font-size:12.5px;color:var(--text-2)">${t('dom.add_hint')}</p>`,
      footer: `<button class="btn" data-close>${t('contacts.cancel')}</button><button class="btn btn-primary" id="dn-ok">${t('dom.add_btn')}</button>`,
    });
    m.el.querySelector('#dn-ok').addEventListener('click', async () => {
      try {
        await API.post('/admin/domains', { name: m.el.querySelector('#dn-name').value.trim() });
        m.close();
        toast(t('dom.added'), 'ok');
        renderSection();
      } catch (e) { toast(e.message, 'err'); }
    });
  });

  el.querySelectorAll('[data-dns]').forEach(b => b.addEventListener('click', () => {
    const dnsModal = modal({
      title: t('dom.dns_title'),
      wide: true,
      body: `
        <div class="field" style="max-width:320px"><label>${t('dom.dns_ip')}</label>
          <input class="input" id="dns-ip" value="203.0.113.10" placeholder="${t('dom.ip_ph')}"></div>
        <div id="dns-records"><div class="spinner"></div></div>`,
      footer: `<button class="btn" data-close>${t('dom.close')}</button>`,
    });
    const loadDns = async () => {
      const box = dnsModal.el.querySelector('#dns-records');
      box.innerHTML = '<div class="spinner"></div>';
      try {
        const ip = dnsModal.el.querySelector('#dns-ip').value.trim() || '203.0.113.10';
        const r = await API.get(`/admin/domains/${b.dataset.dns}/dns?ip=${encodeURIComponent(ip)}`);
        dnsModal.el.querySelector('.modal-head h3').textContent = `${t('dom.dns_title')} — ${r.domain}`;
        box.innerHTML = `
          <p style="font-size:12.5px;color:var(--text-2);margin-bottom:12px">${t('dom.dns_lead')}</p>
          <div class="table-wrap"><table class="table dns-table">
            <thead><tr><th>${t('dom.type')}</th><th>${t('dom.host')}</th><th>${t('dom.value')}</th><th>${t('dom.note')}</th></tr></thead>
            <tbody>${r.records.map(rec => `
              <tr><td><b>${esc(rec.type)}</b></td>
              <td style="max-width:190px;word-break:break-all">${esc(rec.name)}</td>
              <td style="max-width:330px"><code>${esc(rec.value.slice(0, 120))}${rec.value.length > 120 ? '…' : ''}</code>
                <button class="copy-btn" data-copy="${esc(rec.value)}" title="${t('dom.copy')}">${icon('copy')}</button></td>
              <td style="color:var(--text-2);font-size:12px">${esc(rec.note)}</td></tr>`).join('')}</tbody>
          </table></div>
          <p style="font-size:12px;color:var(--text-3);margin-top:12px">${t('dom.dns_tip')}</p>`;
        box.querySelectorAll('[data-copy]').forEach(c => c.addEventListener('click', () => {
          navigator.clipboard.writeText(c.dataset.copy).then(() => toast(t('dom.copied'), 'ok'));
        }));
      } catch (e) { box.innerHTML = `<div class="empty-state">${icon('alert')}<div>${esc(e.message)}</div></div>`; }
    };
    dnsModal.el.querySelector('#dns-ip').addEventListener('change', loadDns);
    loadDns();
  }));

  el.querySelectorAll('[data-catch]').forEach(b => b.addEventListener('click', () => {
    const m = modal({
      title: t('dom.catchall'),
      body: `
        <p style="font-size:12.5px;color:var(--text-2);margin-bottom:12px">${t('dom.catchall_hint')}</p>
        <div class="field"><label>${t('dom.target')}</label>
          <input class="input" id="ca-target" placeholder="${t('alias.dest_ph')}" value="${esc(b.dataset.cur || '')}"></div>`,
      footer: `<button class="btn" data-close>${t('contacts.cancel')}</button><button class="btn btn-primary" id="ca-ok">${t('contacts.save')}</button>`,
    });
    m.el.querySelector('#ca-ok').addEventListener('click', async () => {
      try {
        await API.patch('/admin/domains/' + b.dataset.catch, { catchAll: m.el.querySelector('#ca-target').value.trim() || false });
        m.close();
        toast(t('users.saved'), 'ok');
        renderSection();
      } catch (e) { toast(e.message, 'err'); }
    });
  }));

  el.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => {
    if (!confirm(t('dom.del_confirm'))) return;
    try {
      await API.del('/admin/domains/' + b.dataset.del);
      toast(t('contacts.deleted'), 'ok');
      renderSection();
    } catch (e) { toast(e.message, 'err'); }
  }));
}

// ---------- 别名 ----------
async function aliasesView(el) {
  const r = await API.get('/admin/aliases');
  el.innerHTML = `
    <div class="card"><div class="card-head">
      <h3>${t('alias.count', { n: r.aliases.length })}</h3>
      <button class="btn btn-primary btn-sm" id="al-new">${icon('plus')} ${t('alias.new')}</button>
    </div>
    <div class="table-wrap"><table class="table">
      <thead><tr><th>${t('alias.src')}</th><th>${t('alias.dest')}</th><th>${t('filters.status')}</th><th></th></tr></thead>
      <tbody>${r.aliases.length ? r.aliases.map(a => `
        <tr>
          <td><b>${esc(a.source)}</b></td>
          <td>${icon('forward')} ${esc(a.destination)}</td>
          <td><span class="badge ${a.enabled ? 'badge-green' : ''}">${a.enabled ? t('filters.on') : t('filters.off')}</span></td>
          <td style="white-space:nowrap">
            <button class="btn btn-sm" data-toggle="${a.id}" data-en="${a.enabled}">${a.enabled ? t('filters.disable') : t('filters.enable')}</button>
            <button class="btn btn-sm btn-ghost" data-del="${a.id}">${icon('trash')}</button>
          </td>
        </tr>`).join('') : `<tr><td colspan="4"><div class="empty-state">${t('alias.none')}</div></td></tr>`}</tbody>
    </table></div>
    <div class="card-body" style="border-top:1px solid var(--border);font-size:12px;color:var(--text-3)">${t('alias.hint')}</div></div>`;

  el.querySelector('#al-new').addEventListener('click', () => {
    const m = modal({
      title: t('alias.new_title'),
      body: `
        <div class="field"><label>${t('alias.src')}</label><input class="input" id="an-src" placeholder="info@example.com"></div>
        <div class="field"><label>${t('alias.dest')}</label><input class="input" id="an-dst" placeholder="${t('alias.dest_ph')}"></div>`,
      footer: `<button class="btn" data-close>${t('contacts.cancel')}</button><button class="btn btn-primary" id="an-ok">${t('alias.create')}</button>`,
    });
    m.el.querySelector('#an-ok').addEventListener('click', async () => {
      try {
        await API.post('/admin/aliases', { source: m.el.querySelector('#an-src').value.trim(), destination: m.el.querySelector('#an-dst').value.trim() });
        m.close();
        toast(t('alias.create') + ' ✓', 'ok');
        renderSection();
      } catch (e) { toast(e.message, 'err'); }
    });
  });
  el.querySelectorAll('[data-toggle]').forEach(b => b.addEventListener('click', async () => {
    await API.patch('/admin/aliases/' + b.dataset.toggle, { enabled: b.dataset.en !== '1' });
    renderSection();
  }));
  el.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => {
    await API.del('/admin/aliases/' + b.dataset.del);
    toast(t('contacts.deleted'), 'ok');
    renderSection();
  }));
}

// ---------- 外发队列 ----------
async function queueView(el) {
  const r = await API.get('/admin/queue');
  el.innerHTML = `
    <div class="card"><div class="card-head"><h3>${t('queue.title')}</h3></div>
    <div class="table-wrap"><table class="table">
      <thead><tr><th>${t('queue.sender')}</th><th>${t('queue.rcpt')}</th><th>${t('queue.status')}</th><th>${t('queue.attempts')}</th><th>${t('queue.error')}</th><th>${t('queue.next')}</th></tr></thead>
      <tbody>${r.queue.length ? r.queue.map(qi => `
        <tr>
          <td>${esc(qi.sender)}</td><td>${esc(qi.recipient)}</td>
          <td><span class="badge ${qi.status === 'sent' ? 'badge-green' : qi.status === 'failed' ? 'badge-red' : 'badge-amber'}">${qi.status}</span></td>
          <td>${qi.attempts}</td>
          <td style="max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;color:var(--text-3)" title="${esc(qi.last_error)}">${esc(qi.last_error || '-')}</td>
          <td style="font-size:12px">${qi.status === 'queued' ? fmtFull(qi.next_attempt_at) : '-'}</td>
        </tr>`).join('') : `<tr><td colspan="6"><div class="empty-state">${t('queue.none')}</div></td></tr>`}</tbody>
    </table></div></div>
    <p style="font-size:12px;color:var(--text-3);margin-top:10px">${t('queue.hint')}</p>`;
}

// ---------- 全局黑名单 ----------
async function blView(el) {
  const r = await API.get('/admin/blacklist');
  el.innerHTML = `
    <div class="card"><div class="card-head"><h3>${t('blacklist.card')}</h3></div><div class="card-body">
      <div style="display:flex;gap:9px;margin-bottom:14px">
        <input class="input" id="gb-input" placeholder="${t('blacklist.ph')}">
        <button class="btn btn-primary" id="gb-add">${t('blacklist.add')}</button>
      </div>
      <div class="table-wrap"><table class="table">
        <thead><tr><th>${t('blacklist.pattern')}</th><th>${t('blacklist.added_at')}</th><th></th></tr></thead>
        <tbody>${r.entries.length ? r.entries.map(e => `
          <tr><td><code>${esc(e.pattern)}</code></td><td style="font-size:12px">${fmtFull(e.created_at)}</td>
          <td><button class="btn btn-sm btn-ghost" data-del="${e.id}">${icon('trash')}</button></td></tr>`).join('')
        : `<tr><td colspan="3" style="color:var(--text-3)">${t('blacklist.empty')}</td></tr>`}</tbody>
      </table></div>
    </div></div>`;
  el.querySelector('#gb-add').addEventListener('click', async () => {
    try {
      await API.post('/admin/blacklist', { pattern: el.querySelector('#gb-input').value.trim() });
      el.querySelector('#gb-input').value = '';
      renderSection();
    } catch (e) { toast(e.message, 'err'); }
  });
  el.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => {
    await API.del('/admin/blacklist/' + b.dataset.del);
    renderSection();
  }));
}

// ---------- 审计日志 ----------
async function auditView(el, page = 1) {
  const r = await API.get(`/admin/audit?page=${page}`);
  const pages = Math.max(1, Math.ceil(r.total / r.pageSize));
  el.innerHTML = `
    <div class="card"><div class="card-head"><h3>${t('audit.count', { n: r.total })}</h3></div>
    <div class="table-wrap"><table class="table">
      <thead><tr><th>${t('audit.time')}</th><th>${t('audit.actor')}</th><th>${t('audit.action')}</th><th>${t('audit.detail')}</th><th>IP</th></tr></thead>
      <tbody>${r.logs.map(l => `
        <tr>
          <td style="font-size:12px;white-space:nowrap">${fmtFull(l.created_at)}</td>
          <td style="font-size:12.5px">${esc(l.actor || '-')}</td>
          <td><span class="badge">${esc(l.action)}</span></td>
          <td style="font-size:12px;color:var(--text-2);max-width:360px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(l.detail)}">${esc(l.detail)}</td>
          <td style="font-size:12px">${esc(l.ip || '')}</td>
        </tr>`).join('')}</tbody>
    </table></div>
    <div class="list-foot"><span>${t('audit.page', { p: r.page, t: pages })}</span><span style="display:flex;gap:6px">
      <button class="btn btn-sm btn-ghost" id="au-prev" ${r.page <= 1 ? 'disabled' : ''}>${t('audit.prev')}</button>
      <button class="btn btn-sm btn-ghost" id="au-next" ${r.page >= pages ? 'disabled' : ''}>${t('audit.next')}</button>
    </span></div></div>`;
  el.querySelector('#au-prev')?.addEventListener('click', () => auditView(el, r.page - 1));
  el.querySelector('#au-next')?.addEventListener('click', () => auditView(el, r.page + 1));
}

// ---------- 系统设置 ----------
async function sysView(el) {
  const r = await API.get('/admin/settings');
  el.innerHTML = `
    <div class="card"><div class="card-head"><h3>${t('sys.general')}</h3></div><div class="card-body">
      <div class="field"><label>${t('sys.site_name')}</label><input class="input" id="ss-name" value="${esc(r.siteName)}"></div>
      <div class="kv-row">
        <div><div class="k">${t('sys.openreg')}</div><div class="d">${t('sys.openreg_d')}</div></div>
        <label class="switch"><input type="checkbox" id="ss-reg" ${r.registration ? 'checked' : ''}><span class="slider"></span></label>
      </div>
      <div class="kv-row">
        <div><div class="k">${t('sys.regcode')}</div><div class="d">${t('sys.regcode_d')}</div></div>
        <input class="input" id="ss-code" style="width:180px" value="${esc(r.adminCode)}">
      </div>
      <div style="margin-top:16px"><button class="btn btn-primary" id="ss-save">${t('sys.save')}</button></div>
    </div></div>

    <div class="card" style="margin-top:16px"><div class="card-head"><h3>${t('sys.services')}</h3></div><div class="card-body">
      <div class="kv-row"><div class="k">SMTP MX</div><span class="badge badge-blue">${t('sys.port_prod', { dev: r.smtp.mxPort, prod: 25 })}</span></div>
      <div class="kv-row"><div class="k">SMTP Submission</div><span class="badge badge-blue">${t('sys.port_prod', { dev: r.smtp.submissionPort, prod: 587 })}</span></div>
      <div class="kv-row"><div class="k">IMAP</div><span class="badge badge-blue">${t('sys.port_prod', { dev: r.smtp.imapPort, prod: 143 })}</span></div>
      <div class="kv-row"><div class="k">POP3</div><span class="badge badge-blue">${t('sys.port_prod', { dev: r.smtp.pop3Port, prod: 110 })}</span></div>
      <div class="kv-row"><div class="k">${t('sys.relay')}</div><span class="badge ${r.relay.configured ? 'badge-green' : 'badge-amber'}">${r.relay.configured ? t('sys.relay_on', { host: esc(r.relay.host), port: r.relay.port }) : t('sys.relay_off')}</span></div>
    </div></div>

    <div class="card" style="margin-top:16px"><div class="card-head"><h3>${t('sys.test')}</h3></div><div class="card-body">
      <div style="display:flex;gap:9px">
        <input class="input" id="ss-test-to" placeholder="${t('sys.test_ph')}">
        <button class="btn btn-primary" id="ss-test">${t('sys.test_btn')}</button>
      </div>
      <div id="ss-test-out" style="font-size:12px;color:var(--text-3);margin-top:10px"></div>
    </div></div>

    <div class="card" style="margin-top:16px"><div class="card-head"><h3>${t('sys.backup')}</h3></div><div class="card-body">
      <div class="kv-row">
        <div><div class="k">${t('sys.backup_btn')}</div><div class="d">${t('sys.backup_d')}</div></div>
        <button class="btn" id="ss-backup">${icon('download')} ${t('sys.backup_btn')}</button>
      </div>
    </div></div>`;

  el.querySelector('#ss-save').addEventListener('click', async () => {
    await API.put('/admin/settings', {
      siteName: el.querySelector('#ss-name').value,
      registration: el.querySelector('#ss-reg').checked,
      adminCode: el.querySelector('#ss-code').value,
    });
    toast(t('sys.saved'), 'ok');
  });
  el.querySelector('#ss-test').addEventListener('click', async () => {
    const out = el.querySelector('#ss-test-out');
    out.textContent = t('sys.test_sending');
    try {
      const r = await API.post('/admin/smtp-test', { to: el.querySelector('#ss-test-to').value.trim() });
      out.textContent = `✓ ${t('compose.sent')} — ${(r.internal || []).join(', ') || '-'}${r.external?.length ? ' → ' + r.external.join(', ') : ''}`;
    } catch (e) { out.textContent = '✗ ' + e.message; }
  });
  el.querySelector('#ss-backup').addEventListener('click', () => {
    window.open('/api/admin/backup');
  });
}
