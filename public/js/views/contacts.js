// 通讯录：联系人 CRUD、分组、搜索、导入导出、快速写信（i18n 已接入）
import { API, icon, toast, esc, modal, avatarHtml } from '../api.js';
import { t } from '../i18n.js';
import { openCompose } from './compose.js';

let state = { contacts: [], groups: [], groupFilter: null, search: '' };

export async function render(main) {
  main.innerHTML = `
    <div class="page">
      <div class="page-head">
        <div><h2>${t('contacts.title')}</h2><div class="sub">${t('contacts.sub')}</div></div>
        <div style="display:flex;gap:9px">
          <button class="btn" id="imp">${icon('download')} ${t('contacts.import')}</button>
          <button class="btn" id="exp">${t('contacts.export')}</button>
          <button class="btn btn-primary" id="new">${icon('plus')} ${t('contacts.new')}</button>
        </div>
      </div>
      <div style="display:flex;gap:18px;align-items:flex-start">
        <div class="card" style="width:210px;flex-shrink:0;padding:9px">
          <div id="group-list"></div>
        </div>
        <div class="card" style="flex:1;min-width:0">
          <div style="padding:12px 16px;border-bottom:1px solid var(--border)">
            <div class="search-box">${icon('search')}<input class="input" id="csearch" placeholder="${t('contacts.search')}"></div>
          </div>
          <div id="contact-list"></div>
        </div>
      </div>
    </div>`;

  main.querySelector('#new').addEventListener('click', () => editContact(null));
  main.querySelector('#imp').addEventListener('click', () => importDialog());
  main.querySelector('#exp').addEventListener('click', () => {
    const fmt = confirm(t('contacts.export_hint')) ? 'csv' : 'vcard';
    window.open(`/api/contacts/export?format=${fmt}`);
  });
  let deb;
  main.querySelector('#csearch').addEventListener('input', (e) => {
    clearTimeout(deb);
    deb = setTimeout(() => { state.search = e.target.value.trim(); loadContacts(); }, 250);
  });

  await Promise.all([loadGroups(), loadContacts()]);
}

async function loadGroups() {
  const r = await API.get('/contact-groups');
  state.groups = r.groups;
  const el = document.getElementById('group-list');
  el.innerHTML = `
    <div class="folder-item ${state.groupFilter === null ? 'active' : ''}" data-g="all">${icon('users')}<span class="fname">${t('contacts.all')}</span><span class="badge">${state.contacts.length || ''}</span></div>
    ${state.groups.map(g => `
      <div class="folder-item ${state.groupFilter === g.id ? 'active' : ''}" data-g="${g.id}">
        ${icon('folder')}<span class="fname">${esc(g.name)}</span><span class="badge">${g.count}</span>
        <span class="factions"><button data-delg="${g.id}" title="${t('mail.delete')}">${icon('trash')}</button></span>
      </div>`).join('')}`;
  el.querySelectorAll('[data-g]').forEach(item => item.addEventListener('click', (e) => {
    if (e.target.closest('[data-delg]')) return;
    state.groupFilter = item.dataset.g === 'all' ? null : parseInt(item.dataset.g);
    loadGroups(); loadContacts();
  }));
  el.querySelectorAll('[data-delg]').forEach(btn => btn.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!confirm(t('contacts.delgroup_confirm'))) return;
    await API.del('/contact-groups/' + btn.dataset.delg);
    if (state.groupFilter === parseInt(btn.dataset.delg)) state.groupFilter = null;
    toast(t('contacts.group_deleted'), 'ok');
    loadGroups();
  }));
}

async function loadContacts() {
  const r = await API.get('/contacts' + (state.groupFilter ? `?groupId=${state.groupFilter}` : '') + (state.search ? `&q=${encodeURIComponent(state.search)}` : ''));
  state.contacts = r.contacts;
  const el = document.getElementById('contact-list');
  if (!state.contacts.length) {
    el.innerHTML = `<div class="empty-state">${icon('users')}<div>${t('contacts.none')}</div></div>`;
    return;
  }
  el.innerHTML = state.contacts.map(c => `
    <div class="contact-item" data-cid="${c.id}">
      ${avatarHtml(c.name)}
      <div class="cmeta">
        <div class="n">${esc(c.name)} ${c.group_id ? `<span class="badge badge-blue">${esc(state.groups.find(g => g.id === c.group_id)?.name || '')}</span>` : ''}</div>
        <div class="e">${esc(c.email)}</div>
        ${c.organization ? `<div class="o">${icon('globe')} ${esc(c.organization)}${c.phone ? ' · ' + esc(c.phone) : ''}</div>` : ''}
      </div>
      <button class="btn btn-sm" data-mail="${esc(c.email)}">${icon('mail')} ${t('contacts.write')}</button>
      <button class="btn btn-sm btn-ghost" data-edit="${c.id}">${t('contacts.edit')}</button>
      <button class="btn btn-sm btn-ghost" data-del="${c.id}">${icon('trash')}</button>
    </div>`).join('');

  el.querySelectorAll('[data-mail]').forEach(b => b.addEventListener('click', (e) => {
    e.stopPropagation();
    openCompose({ mode: 'to', address: b.dataset.mail });
  }));
  el.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', (e) => {
    e.stopPropagation();
    editContact(state.contacts.find(c => c.id === parseInt(b.dataset.edit)));
  }));
  el.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!confirm(t('contacts.del_confirm'))) return;
    await API.del('/contacts/' + b.dataset.del);
    toast(t('contacts.deleted'), 'ok');
    loadContacts(); loadGroups();
  }));
}

function editContact(contact) {
  const m = modal({
    title: contact ? t('contacts.edit') : t('contacts.new'),
    body: `
      <div class="field"><label>${t('contacts.name')}</label><input class="input" id="e-name" value="${esc(contact?.name || '')}" placeholder="${t('contacts.name_ph')}"></div>
      <div class="field"><label>${t('contacts.email')}</label><input class="input" id="e-email" value="${esc(contact?.email || '')}" placeholder="${t('contacts.email_ph')}"></div>
      <div class="form-row">
        <div class="field"><label>${t('contacts.org')}</label><input class="input" id="e-org" value="${esc(contact?.organization || '')}"></div>
        <div class="field"><label>${t('contacts.phone')}</label><input class="input" id="e-phone" value="${esc(contact?.phone || '')}"></div>
      </div>
      <div class="field"><label>${t('contacts.group')}</label><select class="input" id="e-group">
        <option value="">${t('contacts.ungrouped')}</option>
        ${state.groups.map(g => `<option value="${g.id}" ${contact?.group_id === g.id ? 'selected' : ''}>${esc(g.name)}</option>`).join('')}
      </select></div>
      <div class="field"><label>${t('contacts.note')}</label><textarea class="input" id="e-note">${esc(contact?.note || '')}</textarea></div>`,
    footer: `<button class="btn" data-close>${t('contacts.cancel')}</button><button class="btn btn-primary" id="e-save">${t('contacts.save')}</button>`,
  });
  m.el.querySelector('#e-save').addEventListener('click', async () => {
    const body = {
      name: m.el.querySelector('#e-name').value.trim(),
      email: m.el.querySelector('#e-email').value.trim(),
      organization: m.el.querySelector('#e-org').value.trim(),
      phone: m.el.querySelector('#e-phone').value.trim(),
      note: m.el.querySelector('#e-note').value.trim(),
      groupId: m.el.querySelector('#e-group').value ? parseInt(m.el.querySelector('#e-group').value) : null,
    };
    if (!body.email.includes('@')) return toast(t('register.title'), 'err');
    try {
      if (contact) await API.put('/contacts/' + contact.id, body);
      else await API.post('/contacts', body);
      m.close();
      toast(t('contacts.saved'), 'ok');
      loadContacts(); loadGroups();
    } catch (e) { toast(e.message, 'err'); }
  });
  const sel = m.el.querySelector('#e-group');
  const quick = document.createElement('button');
  quick.className = 'btn btn-sm btn-ghost';
  quick.textContent = t('contacts.new_group');
  quick.addEventListener('click', async () => {
    const name = prompt(t('contacts.group_name'));
    if (!name) return;
    try {
      const r = await API.post('/contact-groups', { name });
      sel.insertAdjacentHTML('beforeend', `<option value="${r.id}" selected>${esc(name)}</option>`);
      state.groups = (await API.get('/contact-groups')).groups;
    } catch (e) { toast(e.message, 'err'); }
  });
  sel.parentElement.appendChild(quick);
}

function importDialog() {
  const m = modal({
    title: t('contacts.import_title'),
    body: `
      <div class="field"><label>${t('contacts.format')}</label><select class="input" id="i-fmt">
        <option value="vcard">vCard (.vcf)</option>
        <option value="csv">CSV (Name, Email)</option>
      </select></div>
      <div class="field"><label>${t('contacts.paste')}</label><textarea class="input" id="i-data" style="min-height:150px" placeholder="BEGIN:VCARD&#10;VERSION:3.0&#10;FN:John&#10;EMAIL:john@example.com&#10;END:VCARD"></textarea></div>
      <div style="font-size:12px;color:var(--text-3)">${t('contacts.csv_example')} <code>Name,Email,Organization,Phone</code></div>`,
    footer: `<button class="btn" data-close>${t('contacts.cancel')}</button><button class="btn btn-primary" id="i-go">${t('contacts.import_go')}</button>`,
  });
  m.el.querySelector('#i-go').addEventListener('click', async () => {
    try {
      const r = await API.post('/contacts/import', {
        format: m.el.querySelector('#i-fmt').value,
        data: m.el.querySelector('#i-data').value,
      });
      m.close();
      toast(t('contacts.imported', { n: r.imported }), 'ok');
      loadContacts(); loadGroups();
    } catch (e) { toast(e.message, 'err'); }
  });
}
