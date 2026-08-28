// 写信窗口：富文本、收件人补全、附件、图片粘贴、定时发送、草稿自动保存（i18n 已接入）
import { API, icon, toast, esc, modal, fmtBytes } from '../api.js';
import { t, getLocale } from '../i18n.js';

let draftId = null;
let attachmentDraftId = null;
let saveTimer = null;
let dirty = false;

export function openCompose(opts = {}) {
  const { mode = 'new', msg = null } = opts;
  draftId = null;
  attachmentDraftId = null;
  dirty = false;

  let to = '', cc = '', bcc = '', subject = '', html = '', inReplyTo = '', references = '';
  const myAddr = API.user?.address || '';
  const titleMap = { new: 'compose.title', reply: 'compose.title_reply', replyall: 'compose.title_replyall', forward: 'compose.title_forward', draft: 'compose.title_draft' };

  if (mode === 'reply' && msg) {
    to = msg.from_addr || '';
    subject = /^re:/i.test(msg.subject || '') ? msg.subject : `Re: ${msg.subject || ''}`;
    inReplyTo = msg.message_id || '';
    references = msg.refs || msg.message_id || '';
    html = quoteBlock(msg);
  } else if (mode === 'replyall' && msg) {
    const others = String(msg.to_addrs || '').split(',').map(s => s.trim()).filter(a => a && a !== myAddr);
    to = [msg.from_addr, ...others].filter(Boolean).join(', ');
    cc = msg.cc_addrs || '';
    subject = /^re:/i.test(msg.subject || '') ? msg.subject : `Re: ${msg.subject || ''}`;
    inReplyTo = msg.message_id || '';
    references = msg.refs || msg.message_id || '';
    html = quoteBlock(msg);
  } else if (mode === 'forward' && msg) {
    to = '';
    subject = /^fwd:/i.test(msg.subject || '') ? msg.subject : `Fwd: ${msg.subject || ''}`;
    html = `<p><br></p><p>${t('compose.fwd_header')}</p>
      <p><b>${t('compose.fwd_from')}:</b> ${esc(msg.from_addr)}<br><b>${t('compose.fwd_to')}:</b> ${esc(msg.to_addrs)}<br><b>${t('compose.fwd_subject')}:</b> ${esc(msg.subject)}<br><b>${t('compose.fwd_date')}:</b> ${new Date(msg.delivered_at).toLocaleString()}</p>
      <blockquote>${msg.body_html || `<pre style="white-space:pre-wrap;font-family:inherit">${esc(msg.body_text || '')}</pre>`}</blockquote>`;
  } else if (mode === 'draft' && msg) {
    draftId = msg.id;
    to = msg.to_addrs || ''; cc = msg.cc_addrs || ''; bcc = msg.bcc_addrs || '';
    subject = msg.subject || ''; html = msg.body_html || '';
  } else if (mode === 'to') {
    to = opts.address || '';
  }

  const signature = API.user?.signature || '';
  if (mode === 'new' && signature) html = `<p><br></p><p>${signature.replace(/\n/g, '<br>')}</p>`;

  const { mask, close, el } = modal({
    title: t(titleMap[mode] || 'compose.title'),
    wide: true,
    body: `
      <div class="compose-head">
        <div class="row"><label>${t('compose.to')}</label><div class="chip-wrap" data-field="to"><input class="input" data-input="to" placeholder="${t('compose.to_ph')}" value="${esc(to)}"></div><button class="btn btn-sm btn-ghost" data-toggle="cc" type="button">${t('compose.cc')}</button><button class="btn btn-sm btn-ghost" data-toggle="bcc" type="button">${t('compose.bcc')}</button></div>
        <div class="row" data-row="cc" style="display:${cc ? 'flex' : 'none'}"><label>${t('compose.cc')}</label><div class="chip-wrap" data-field="cc"><input class="input" data-input="cc" value="${esc(cc)}"></div></div>
        <div class="row" data-row="bcc" style="display:${bcc ? 'flex' : 'none'}"><label>${t('compose.bcc')}</label><div class="chip-wrap" data-field="bcc"><input class="input" data-input="bcc" value="${esc(bcc)}"></div></div>
        <div class="row"><label>${t('compose.subject')}</label><input class="input" data-subject placeholder="${t('compose.subject_ph')}" value="${esc(subject)}"></div>
      </div>
      <div class="editor-toolbar" id="ed-toolbar"></div>
      <div class="editor-area" contenteditable="true" id="ed-area" data-placeholder="${t('compose.body_ph')}">${html || '<p><br></p>'}</div>
      <div class="atch-list" id="atch-list" style="padding:0 20px"></div>
      <div class="drop-hint" id="drop-hint">${t('compose.drop')}</div>
      <div class="compose-foot">
        <button class="btn btn-primary" id="c-send" style="min-width:110px">${icon('send')} ${t('compose.send')}</button>
        <button class="btn" id="c-schedule">${icon('clock')} ${t('compose.schedule')}</button>
        <button class="btn" id="c-attach">${icon('paperclip')} ${t('compose.attach')}</button>
        <button class="btn" id="c-tpl">${icon('file')} ${t('tpl.title')}</button>
        <button class="btn" id="c-ai" style="border-color:var(--primary);color:var(--primary)">${icon('key')} ${t('ai.composer_btn')}</button>
        <input type="file" id="c-file" multiple style="display:none">
        <span style="flex:1"></span>
        <span id="c-status" style="font-size:12px;color:var(--text-3)"></span>
        <button class="btn btn-ghost" id="c-discard">${t('compose.discard')}</button>
      </div>`,
    onClose: () => { clearInterval(saveTimer); },
  });

  el.style.display = 'flex';
  el.style.flexDirection = 'column';
  el.style.height = '86vh';
  const area = el.querySelector('#ed-area');
  area.style.display = 'flex';
  area.style.flexDirection = 'column';
  buildToolbar(el, area);

  // ---- 收件人 chips + 自动补全 ----
  const chipFields = ['to', 'cc', 'bcc'];
  for (const f of chipFields) {
    const wrap = el.querySelector(`[data-field="${f}"]`);
    const input = wrap.querySelector('input');
    if (input.value.trim()) { const v = input.value.trim(); input.value = ''; v.split(/[,;]+/).forEach(a => a.trim() && addChip(wrap, a)); }
    bindChipField(wrap, input);
  }
  el.querySelectorAll('[data-toggle]').forEach(btn => {
    btn.addEventListener('click', () => {
      const row = el.querySelector(`[data-row="${btn.dataset.toggle}"]`);
      row.style.display = row.style.display === 'none' ? 'flex' : 'none';
    });
  });

  // ---- 附件 ----
  const fileInput = el.querySelector('#c-file');
  el.querySelector('#c-attach').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => { [...fileInput.files].forEach(uploadAttachment); fileInput.value = ''; });
  el.querySelector('#drop-hint').addEventListener('dragover', e => e.preventDefault());
  el.querySelector('#drop-hint').addEventListener('drop', (e) => {
    e.preventDefault();
    [...e.dataTransfer.files].forEach(uploadAttachment);
  });
  area.addEventListener('paste', (e) => {
    const items = [...(e.clipboardData?.items || [])];
    const img = items.find(i => i.type.startsWith('image/'));
    if (img) {
      e.preventDefault();
      const file = img.getAsFile();
      const reader = new FileReader();
      reader.onload = async () => {
        const att = await uploadAttachment(new File([file], `${t('compose.pasted_img')}-${Date.now()}.png`, { type: file.type }), true);
        if (att) {
          document.execCommand('insertHTML', false, `<img src="/api/attachments/${att.id}/inline" alt="${esc(att.filename)}" style="max-width:100%">`);
        }
      };
      reader.readAsArrayBuffer(file);
    }
  });

  // ---- 自动保存 ----
  const status = el.querySelector('#c-status');
  saveTimer = setInterval(async () => {
    if (!dirty) return;
    dirty = false;
    status.textContent = t('compose.saving');
    try { await saveDraft(); status.textContent = t('compose.saved', { time: new Date().toLocaleTimeString() }); }
    catch (e) { status.textContent = t('compose.save_fail', { msg: e.message }); }
  }, 12000);
  area.addEventListener('input', () => { dirty = true; });
  el.querySelector('[data-subject]').addEventListener('input', () => { dirty = true; });

  // ---- 发送 / 定时 ----
  el.querySelector('#c-send').addEventListener('click', () => doSend());
  el.querySelector('#c-schedule').addEventListener('click', () => {
    const s = prompt(t('compose.sched_prompt'));
    if (!s) return;
    const ts = new Date(s.replace(' ', 'T') + ':00').getTime();
    if (isNaN(ts) || ts < Date.now()) return toast(t('compose.sched_invalid'), 'err');
    doSend(ts);
  });
  el.querySelector('#c-discard').addEventListener('click', async () => {
    if (draftId && confirm(t('compose.discard_confirm'))) { await API.del('/drafts/' + draftId).catch(() => {}); }
    close();
  });

  // ---- 模板 / AI ----
  const subjectInput = el.querySelector('[data-subject]');
  el.querySelector('#c-tpl').addEventListener('click', () => openTemplatePicker(area, subjectInput));
  el.querySelector('#c-ai').addEventListener('click', () => openAIComposer(area, subjectInput));

  if (draftId) loadDraftAttachments();

  function collect() {
    const get = f => [...el.querySelector(`[data-field="${f}"]`).querySelectorAll('.chip')].map(c => c.dataset.addr);
    return {
      to: get('to').join(','),
      cc: get('cc').join(','),
      bcc: get('bcc').join(','),
      subject: el.querySelector('[data-subject]').value.trim(),
      text: area.innerText.trim(),
      html: area.innerHTML,
      inReplyTo, references,
    };
  }

  async function saveDraft() {
    const data = collect();
    if (draftId) {
      await API.put('/drafts/' + draftId, data);
      return draftId;
    }
    const r = await API.post('/drafts', data);
    draftId = r.draftId;
    loadDraftAttachments();
    return draftId;
  }

  async function loadDraftAttachments() {
    try {
      const r = await API.get(`/messages/${draftId}?peek=1`);
      renderAtts(r.message.attachments || []);
      attachmentDraftId = draftId;
    } catch {}
  }

  async function uploadAttachment(file, inline = false) {
    const status = el.querySelector('#c-status');
    status.textContent = t('compose.uploading', { name: file.name });
    const buf = await new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result.split(',')[1]);
      r.onerror = rej;
      r.readAsDataURL(file);
    });
    try {
      if (!draftId && !attachmentDraftId) {
        const r = await API.post('/drafts', { subject: t('compose.attach') });
        attachmentDraftId = r.draftId;
      }
      const r = await API.post('/attachments', {
        draftId: draftId || attachmentDraftId,
        filename: file.name,
        contentType: file.type || 'application/octet-stream',
        data: buf,
      });
      status.textContent = '';
      await refreshAtts();
      return r;
    } catch (e) { toast(e.message, 'err'); status.textContent = ''; }
  }

  async function refreshAtts() {
    const mid = draftId || attachmentDraftId;
    if (!mid) return renderAtts([]);
    try {
      const r = await API.get(`/messages/${mid}?peek=1`);
      renderAtts(r.message.attachments || []);
    } catch {}
  }

  function renderAtts(list) {
    el.querySelector('#atch-list').innerHTML = list.filter(a => !a.is_inline).map(a => `
      <div class="atch-item">${icon('file')}
        <div class="meta"><div class="n">${esc(a.filename)}</div><div class="s">${fmtBytes(a.size)}</div></div>
        <button class="btn btn-icon btn-ghost" data-delatt="${a.id}" title="${t('mail.delete')}">${icon('x')}</button>
      </div>`).join('');
    el.querySelectorAll('[data-delatt]').forEach(b => b.addEventListener('click', async () => {
      await API.del('/attachments/' + b.dataset.delatt);
      refreshAtts();
    }));
  }

  async function doSend(scheduledAt = null) {
    const data = collect();
    if (!data.to && !data.cc && !data.bcc) return toast(t('compose.need_rcpt'), 'err');
    const btn = el.querySelector('#c-send');
    btn.disabled = true;
    try {
      await saveDraft();
      const r = await API.post('/send', {
        ...data,
        draftId,
        scheduledAt: scheduledAt || undefined,
      });
      clearInterval(saveTimer);
      close();
      if (r.scheduled) toast(t('compose.scheduled_ok', { time: new Date(parseInt(data.scheduledAt || scheduledAt)).toLocaleString() }), 'ok');
      else toast(r.external?.length ? t('compose.sent_queued') : t('compose.sent'), 'ok');
      document.dispatchEvent(new CustomEvent('mail:refresh'));
    } catch (e) { toast(e.message, 'err'); btn.disabled = false; }
  }
}

// ---------- 模板选择器 ----------
async function openTemplatePicker(area, subjectInput) {
  let list = [];
  try { list = (await API.get('/templates')).templates; } catch (e) { return toast(e.message, 'err'); }
  const m = modal({
    title: t('tpl.title'),
    wide: true,
    body: list.length ? `
      <div class="table-wrap"><table class="table">
        <thead><tr><th>${t('tpl.name')}</th><th>${t('compose.subject')}</th><th></th></tr></thead>
        <tbody>${list.map(x => `
          <tr>
            <td><b>${esc(x.name)}</b><div style="font-size:11.5px;color:var(--text-3)">${fmtBytes(x.size || 0)}</div></td>
            <td style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(x.subject || '-')}</td>
            <td style="white-space:nowrap"><button class="btn btn-sm btn-primary" data-tins="${x.id}">${t('tpl.insert')}</button></td>
          </tr>`).join('')}</tbody>
      </table></div>
      <p style="font-size:12px;color:var(--text-3);margin-top:10px">${t('tpl.sub')}</p>`
      : `<div class="empty-state">${icon('file')}<div>${t('tpl.none')}</div><div style="font-size:12px">${t('tpl.sub')}</div></div>`,
    footer: `<button class="btn" data-close>${t('contacts.cancel')}</button>`,
  });
  m.el.querySelectorAll('[data-tins]').forEach(b => b.addEventListener('click', async () => {
    try {
      const tpl = (await API.get('/templates/' + b.dataset.tins)).template;
      area.innerHTML = tpl.html || '<p><br></p>';
      if (!subjectInput.value.trim() && tpl.subject) subjectInput.value = tpl.subject;
      dirty = true;
      m.close();
      toast(t('tpl.inserted'), 'ok');
    } catch (e) { toast(e.message, 'err'); }
  }));
}

// ---------- 写信 AI 助手（帮写 / 翻译） ----------
function openAIComposer(area, subjectInput) {
  const m = modal({
    title: t('ai.composer_btn') + ' · ' + t('ai.title'),
    wide: true,
    body: `
      <div style="display:flex;gap:8px;margin-bottom:14px" id="ai-tabs">
        <button class="btn btn-sm btn-primary" data-aitab="write">${t('ai.write')}</button>
        <button class="btn btn-sm" data-aitab="translate">${t('ai.translate')}</button>
      </div>
      <div id="ai-pane"></div>`,
    footer: `<button class="btn" data-close>${t('contacts.cancel')}</button>`,
  });
  const pane = m.el.querySelector('#ai-pane');

  const renderWrite = () => {
    pane.innerHTML = `
      <div class="field"><label>${t('ai.write')}</label><textarea class="input" id="ai-instr" style="min-height:90px" placeholder="${t('ai.write_ph')}"></textarea></div>
      <div class="form-row">
        <div class="field"><label>${t('ai.tone')}</label><select class="input" id="ai-tone">
          <option value="professional">${t('ai.tone_professional')}</option>
          <option value="friendly">${t('ai.tone_friendly')}</option>
          <option value="formal">${t('ai.tone_formal')}</option>
          <option value="concise">${t('ai.tone_concise')}</option>
        </select></div>
      </div>
      <div id="ai-out" style="display:none;border:1px solid var(--border);border-radius:9px;padding:14px;max-height:220px;overflow:auto;font-size:13.5px;line-height:1.7"></div>
      <div style="display:flex;gap:9px;margin-top:12px;align-items:center">
        <button class="btn btn-primary" id="ai-go">${t('ai.generate')}</button>
        <button class="btn" id="ai-ins" style="display:none">${t('ai.insert')}</button>
        <span id="ai-status" style="font-size:12px;color:var(--text-3)"></span>
      </div>`;
    let generated = null;
    pane.querySelector('#ai-go').addEventListener('click', async () => {
      const btn = pane.querySelector('#ai-go');
      const status = pane.querySelector('#ai-status');
      btn.disabled = true;
      status.textContent = t('ai.generating');
      try {
        const r = await API.post('/ai/write', {
          instruction: pane.querySelector('#ai-instr').value,
          tone: pane.querySelector('#ai-tone').value,
          lang: getLocale(),
        });
        generated = r;
        const out = pane.querySelector('#ai-out');
        out.innerHTML = r.body_html;
        out.style.display = 'block';
        pane.querySelector('#ai-ins').style.display = '';
        status.textContent = '';
      } catch (e) { status.textContent = '✗ ' + e.message; }
      btn.disabled = false;
    });
    pane.querySelector('#ai-ins').addEventListener('click', () => {
      if (!generated) return;
      area.innerHTML = generated.body_html;
      if (!subjectInput.value.trim() && generated.subject) subjectInput.value = generated.subject;
      dirty = true;
      m.close();
      toast(t('tpl.inserted'), 'ok');
    });
  };

  const renderTranslate = () => {
    const LANGS = [['zh', '简体中文'], ['en', 'English'], ['fr', 'Français'], ['es', 'Español'], ['pt', 'Português'], ['ru', 'Русский'], ['ar', 'العربية'], ['hi', 'हिन्दी'], ['bn', 'বাংলা'], ['ur', 'اردو'], ['ja', '日本語'], ['de', 'Deutsch']];
    pane.innerHTML = `
      <div class="form-row" style="align-items:flex-end">
        <div class="field"><label>${t('ai.translate_to')}</label><select class="input" id="ai-tlang">
          ${LANGS.map(([c, n]) => `<option value="${c}" ${c === getLocale() ? 'selected' : ''}>${n}</option>`).join('')}
        </select></div>
      </div>
      <div id="ai-out" style="display:none;border:1px solid var(--border);border-radius:9px;padding:14px;max-height:200px;overflow:auto;font-size:13.5px;line-height:1.7;white-space:pre-wrap"></div>
      <div style="display:flex;gap:9px;margin-top:12px;align-items:center;flex-wrap:wrap">
        <button class="btn btn-primary" id="ai-go">${t('ai.translate')}</button>
        <button class="btn" id="ai-rep" style="display:none">${t('ai.replace_body')}</button>
        <button class="btn" id="ai-app" style="display:none">${t('ai.append')}</button>
        <span id="ai-status" style="font-size:12px;color:var(--text-3)"></span>
      </div>`;
    let translated = '';
    const bodyText = () => area.innerText.trim();
    pane.querySelector('#ai-go').addEventListener('click', async () => {
      if (!bodyText()) return toast(t('mail.empty_mail'), 'err');
      const btn = pane.querySelector('#ai-go');
      const status = pane.querySelector('#ai-status');
      btn.disabled = true;
      status.textContent = t('ai.generating');
      try {
        const r = await API.post('/ai/translate', { text: bodyText(), targetLang: pane.querySelector('#ai-tlang').value });
        translated = r.translated;
        const out = pane.querySelector('#ai-out');
        out.textContent = translated;
        out.style.display = 'block';
        pane.querySelector('#ai-rep').style.display = '';
        pane.querySelector('#ai-app').style.display = '';
        status.textContent = '';
      } catch (e) { status.textContent = '✗ ' + e.message; }
      btn.disabled = false;
    });
    pane.querySelector('#ai-rep').addEventListener('click', () => {
      area.innerHTML = translated.split(/\n{2,}/).map(p => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('');
      dirty = true;
      m.close();
      toast(t('ai.replace_body') + ' ✓', 'ok');
    });
    pane.querySelector('#ai-app').addEventListener('click', () => {
      area.insertAdjacentHTML('beforeend', `<hr><p><b>— ${t('ai.translate')} —</b></p>${translated.split(/\n{2,}/).map(p => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('')}`);
      dirty = true;
      m.close();
      toast(t('ai.append') + ' ✓', 'ok');
    });
  };

  const show = (tab) => {
    m.el.querySelectorAll('[data-aitab]').forEach(b => b.classList.toggle('btn-primary', b.dataset.aitab === tab));
    (tab === 'write' ? renderWrite : renderTranslate)();
  };
  m.el.querySelectorAll('[data-aitab]').forEach(b => b.addEventListener('click', () => show(b.dataset.aitab)));
  show('write');
}

function addChip(wrap, addr) {
  addr = addr.trim().replace(/[,;]+$/, '');
  if (!addr) return;
  if ([...wrap.querySelectorAll('.chip')].some(c => c.dataset.addr === addr)) return;
  const chip = document.createElement('span');
  chip.className = 'chip';
  chip.dataset.addr = addr;
  chip.innerHTML = `${esc(addr)}<button type="button">×</button>`;
  chip.querySelector('button').addEventListener('click', () => { chip.remove(); dirty = true; });
  wrap.insertBefore(chip, wrap.querySelector('input'));
}

function bindChipField(wrap, input) {
  let acMenu = null;
  const commit = () => {
    input.value.split(/[,;]+/).forEach(a => a.trim() && addChip(wrap, a));
    input.value = '';
    dirty = true;
  };
  input.addEventListener('blur', () => setTimeout(() => { commit(); acMenu?.remove(); }, 180));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); commit(); }
    if (e.key === 'Backspace' && !input.value) {
      const chips = wrap.querySelectorAll('.chip');
      if (chips.length) chips[chips.length - 1].remove();
    }
  });
  input.addEventListener('input', async () => {
    const q = input.value.trim();
    acMenu?.remove();
    if (q.length < 1) return;
    try {
      const r = await API.get(`/autocomplete?q=${encodeURIComponent(q)}`);
      if (!r.suggestions?.length) return;
      acMenu = document.createElement('div');
      acMenu.className = 'ac-menu';
      acMenu.innerHTML = r.suggestions.map(s =>
        `<div data-addr="${esc(s.email)}"><b>${esc(s.name || s.email)}</b><span>${esc(s.email)}</span></div>`).join('');
      acMenu.querySelectorAll('[data-addr]').forEach(opt => {
        opt.addEventListener('mousedown', (e) => {
          e.preventDefault();
          addChip(wrap, opt.dataset.addr);
          input.value = '';
          acMenu?.remove();
          dirty = true;
        });
      });
      wrap.appendChild(acMenu);
    } catch {}
  });
}

function quoteBlock(msg) {
  return `<p><br></p><p>${t('compose.quote_header')}</p>
    <p><b>${t('compose.fwd_from')}:</b> ${esc(msg.from_name || '')} &lt;${esc(msg.from_addr)}&gt;<br>
    <b>${t('compose.fwd_date')}:</b> ${new Date(msg.delivered_at).toLocaleString()}<br>
    <b>${t('compose.fwd_subject')}:</b> ${esc(msg.subject || '')}</p>
    <blockquote>${msg.body_html || `<pre style="white-space:pre-wrap;font-family:inherit">${esc(msg.body_text || '')}</pre>`}</blockquote>`;
}

function buildToolbar(el, area) {
  const bar = el.querySelector('#ed-toolbar');
  const cmds = [
    ['bold', '<b>B</b>', t('compose.toolbar_bold')], ['italic', '<i>I</i>', t('compose.toolbar_italic')], ['underline', '<u>U</u>', t('compose.toolbar_underline')],
    ['sep'],
    ['insertUnorderedList', t('compose.toolbar_ul'), t('compose.toolbar_ul')], ['insertOrderedList', t('compose.toolbar_ol'), t('compose.toolbar_ol')],
    ['formatBlock:h3', t('compose.toolbar_h3'), t('compose.toolbar_h3')],
    ['formatBlock:blockquote', t('compose.toolbar_quote'), t('compose.toolbar_quote')],
    ['formatBlock:pre', t('compose.toolbar_code'), t('compose.toolbar_code')],
    ['sep'],
    ['foreColor', t('compose.toolbar_color'), t('compose.toolbar_color')], ['removeFormat', t('compose.toolbar_clear'), t('compose.toolbar_clear')],
    ['createLink', t('compose.toolbar_link'), t('compose.toolbar_link')],
  ];
  bar.innerHTML = cmds.map(([c, label, title]) => c === 'sep'
    ? '<span class="sep"></span>'
    : `<button type="button" data-cmd="${c}" title="${title}">${label}</button>`).join('');

  bar.querySelectorAll('[data-cmd]').forEach(btn => {
    btn.addEventListener('mousedown', e => e.preventDefault());
    btn.addEventListener('click', async () => {
      const cmd = btn.dataset.cmd;
      area.focus();
      if (cmd === 'foreColor') {
        const color = prompt(t('compose.color_prompt'), '#e5484d');
        if (color) document.execCommand('foreColor', false, color);
      } else if (cmd === 'createLink') {
        const url = prompt(t('compose.link_prompt'), 'https://');
        if (url) document.execCommand('createLink', false, url);
      } else if (cmd.startsWith('formatBlock:')) {
        document.execCommand('formatBlock', false, cmd.split(':')[1]);
      } else {
        document.execCommand(cmd, false, null);
      }
      dirty = true;
    });
  });
}
