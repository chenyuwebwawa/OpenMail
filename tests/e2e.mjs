// OpenMail 端到端测试：覆盖 API / SMTP / Submission / IMAP / POP3 / 2FA / 管理端
// 运行: npm test（需先启动服务: npm start）
import nodemailer from 'nodemailer';
import { ImapFlow } from 'imapflow';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.TEST_BASE || 'http://localhost:3000';
const SMTP_PORT = parseInt(process.env.TEST_SMTP || '2525');
const SUBMIT_PORT = parseInt(process.env.TEST_SUBMIT || '2587');
const IMAP_PORT = parseInt(process.env.TEST_IMAP || '1143');
const POP3_PORT = parseInt(process.env.TEST_POP3 || '1110');

let passed = 0, failed = 0;
const failures = [];
function ok(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; failures.push(name + (extra ? ` — ${extra}` : '')); console.log(`  ✗ ${name} ${extra}`); }
}

async function api(method, urlPath, { token, body } = {}) {
  const res = await fetch(BASE + urlPath, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let json = {};
  try { json = await res.json(); } catch {}
  return { status: res.status, json, headers: res.headers };
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const until = async (fn, timeoutMs = 8000, step = 300) => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await fn()) return true;
    await sleep(step);
  }
  return false;
};

// 发送原始 SMTP 邮件（用于 MX 端口测试）
function sendRawSmtp({ port, from, to, data }) {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection({ host: '127.0.0.1', port }, () => {});
    let step = 0; const cmds = [`HELO tester.example`, `MAIL FROM:<${from}>`, `RCPT TO:<${to}>`, 'DATA'];
    let buffer = '';
    sock.on('data', (d) => {
      buffer += d.toString();
      if (buffer.includes('\n')) {
        const lines = buffer.split(/\r?\n/).filter(Boolean);
        const last = lines[lines.length - 1];
        buffer = '';
        if (last.startsWith('2') || last.startsWith('3')) {
          if (step < cmds.length) { sock.write(cmds[step] + '\r\n'); step++; }
          else if (step === cmds.length) { sock.write(data + '\r\n.\r\n'); step++; }
          else { sock.write('QUIT\r\n'); sock.end(); resolve(true); }
        } else { sock.destroy(); reject(new Error('SMTP error: ' + last)); }
      }
    });
    sock.on('error', reject);
    setTimeout(() => { sock.destroy(); reject(new Error('SMTP timeout')); }, 8000);
  });
}

// POP3 客户端（简易）
function pop3({ user, pass }) {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection({ host: '127.0.0.1', port: POP3_PORT }, () => {});
    let buffer = '';
    const lines = [];
    sock.on('data', (d) => {
      buffer += d.toString('binary');
      let idx;
      while ((idx = buffer.indexOf('\r\n')) !== -1) {
        lines.push(buffer.slice(0, idx));
        buffer = buffer.slice(idx + 2);
      }
      if (lines.length >= 8) {
        sock.write('QUIT\r\n');
        sock.end();
        resolve(lines);
      }
    });
    sock.on('error', reject);
    sock.write(`USER ${user}\r\n`);
    sock.write(`PASS ${pass}\r\n`);
    sock.write('STAT\r\n');
    sock.write('LIST\r\n');
    setTimeout(() => { try { sock.destroy(); } catch {} reject(new Error('POP3 timeout')); }, 8000);
    sock.on('close', () => { if (lines.length) resolve(lines); });
  });
}

// ---------------- 主流程 ----------------
async function main() {
  console.log('\n== 1. 健康检查 ==');
  const health = await api('GET', '/api/auth/me');
  ok('HTTP 服务响应', health.status === 401);

  console.log('\n== 2. 注册 / 登录 ==');
  const pw = 'TestPass123!';
  const regA = await api('POST', '/api/auth/register', { body: { address: 'alice@localhost', password: pw, displayName: 'Alice' } });
  const regB = await api('POST', '/api/auth/register', { body: { address: 'bob@localhost', password: pw, displayName: 'Bob' } });
  if (regA.status === 409) console.log('  (用户已存在，继续)');
  const loginA = await api('POST', '/api/auth/login', { body: { address: 'alice@localhost', password: pw } });
  const loginB = await api('POST', '/api/auth/login', { body: { address: 'bob@localhost', password: pw } });
  ok('alice 登录', loginA.status === 200 && loginA.json.token, JSON.stringify(loginA.json));
  ok('bob 登录', loginB.status === 200 && loginB.json.token, JSON.stringify(loginB.json));
  const tokA = loginA.json.token, tokB = loginB.json.token;
  const badLogin = await api('POST', '/api/auth/login', { body: { address: 'alice@localhost', password: 'wrong' } });
  ok('错误密码被拒绝', badLogin.status === 401);

  console.log('\n== 3. 站内发信 / 收信 / 线程 ==');
  const send1 = await api('POST', '/api/send', {
    token: tokA,
    body: { to: 'bob@localhost', subject: '项目周报 #1', html: '<p>这是 <b>第一封</b> 周报，包含要点。</p>', text: '这是第一封周报，包含要点。' },
  });
  ok('alice → bob 发信成功', send1.status === 200 && send1.json.sentId, JSON.stringify(send1.json));
  const gotIt = await until(async () => {
    const inbox = await api('GET', '/api/messages?folderId=', { token: tokB });
    return inbox.json.messages?.some(m => m.subject.includes('项目周报 #1'));
  });
  ok('bob 收件箱收到邮件', gotIt);
  const inboxB = await api('GET', '/api/messages?folderId=', { token: tokB });
  const msg1 = inboxB.json.messages.find(m => m.subject.includes('项目周报 #1'));
  const detail = await api('GET', `/api/messages/${msg1.id}`, { token: tokB });
  ok('邮件详情含 HTML 正文', detail.status === 200 && detail.json.message.body_html.includes('第一封'));
  ok('自动标记已读', detail.json.message.is_read === 1);

  // 回复 → 线程聚合（线程 id 是按用户空间隔离的，需在同一用户的消息间比较）
  const reply = await api('POST', '/api/send', {
    token: tokB, body: { to: 'alice@localhost', subject: 'Re: 项目周报 #1', text: '收到，谢谢！',
      inReplyTo: detail.json.message.message_id, references: detail.json.message.message_id },
  });
  ok('bob 回复成功', reply.status === 200, JSON.stringify(reply.json));
  await until(async () => {
    const inbox = await api('GET', '/api/messages?folderId=', { token: tokA });
    return inbox.json.messages?.some(m => m.subject.includes('Re: 项目周报'));
  });
  const aliceSearch = await api('GET', '/api/search?q=项目周报', { token: tokA });
  const aOrig = aliceSearch.json.messages.find(m => m.subject.includes('项目周报 #1'));
  const aReply = aliceSearch.json.messages.find(m => m.subject.includes('Re: 项目周报'));
  ok('alice 收到回复且线程聚合一致', aOrig && aReply && aOrig.thread_id === aReply.thread_id,
    `orig=${aOrig?.thread_id} reply=${aReply?.thread_id}`);

  console.log('\n== 4. 草稿 / 定时发送 ==');
  const draft = await api('POST', '/api/drafts', { token: tokA, body: { to: 'bob@localhost', subject: '草稿测试', text: '自动保存的草稿' } });
  ok('创建草稿', draft.status === 200 && draft.json.draftId);
  const upd = await api('PUT', `/api/drafts/${draft.json.draftId}`, { token: tokA, body: { to: 'bob@localhost', subject: '草稿测试(已修改)', text: '更新后的内容' } });
  ok('自动保存更新草稿', upd.status === 200);
  const draftFolder = await api('GET', '/api/messages?folderId=', { token: tokA });
  const draftsF = await api('GET', '/api/folders', { token: tokA });
  const draftsFolder = draftsF.json.folders.find(f => f.type === 'drafts');
  const draftsList = await api('GET', `/api/messages?folderId=${draftsFolder.id}`, { token: tokA });
  ok('草稿出现在草稿箱', draftsList.json.messages.some(m => m.id === draft.json.draftId));

  // 定时发送: 3 秒后
  const sched = await api('POST', '/api/send', {
    token: tokA, draftId: draft.json.draftId,
    body: { to: 'bob@localhost', subject: '定时邮件 ' + Date.now(), text: '这是定时发送的邮件', scheduledAt: Date.now() + 3000 },
  });
  ok('定时发送已排队', sched.status === 200 && sched.json.scheduled === true, JSON.stringify(sched.json));
  const schedArrived = await until(async () => {
    const inbox = await api('GET', '/api/messages?folderId=', { token: tokB });
    return inbox.json.messages?.some(m => m.subject.startsWith('定时邮件'));
  }, 30000);
  ok('定时邮件到点投递', schedArrived);

  console.log('\n== 5. 附件 ==');
  const content = Buffer.from('Hello attachment 内容 ' + 'x'.repeat(100)).toString('base64');
  const att = await api('POST', '/api/attachments', { token: tokA, body: { draftId: null, filename: '测试附件.txt', contentType: 'text/plain', data: content } });
  ok('上传附件', att.status === 200 && att.json.id, JSON.stringify(att.json));
  const draft2 = await api('POST', '/api/drafts', { token: tokA, body: { to: 'bob@localhost', subject: '带附件的邮件', text: '见附件' } });
  const attachToDraft = await fetch(BASE + '/api/attachments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokA}` },
    body: JSON.stringify({ draftId: draft2.json.draftId, filename: '测试附件.txt', contentType: 'text/plain', data: content }),
  });
  ok('附件挂到草稿', attachToDraft.status === 200);
  const sendAtt = await api('POST', '/api/send', { token: tokA, body: { draftId: draft2.json.draftId, to: 'bob@localhost', subject: '带附件的邮件', text: '见附件' } });
  ok('发送带附件邮件', sendAtt.status === 200, JSON.stringify(sendAtt.json));
  await until(async () => {
    const inbox = await api('GET', '/api/messages?folderId=', { token: tokB });
    return inbox.json.messages?.some(m => m.subject === '带附件的邮件');
  });
  const inboxB2 = await api('GET', '/api/messages?folderId=', { token: tokB });
  const attMsg = inboxB2.json.messages.find(m => m.subject === '带附件的邮件');
  const attDetail = await api('GET', `/api/messages/${attMsg.id}`, { token: tokB });
  ok('收件方看到附件', attDetail.json.message.attachments?.length > 0, JSON.stringify(attDetail.json.message.attachments || []));
  const dl = await fetch(BASE + `/api/attachments/${attDetail.json.message.attachments[0].id}/download`, { headers: { Authorization: `Bearer ${tokB}` } });
  const dlText = await dl.text();
  ok('附件下载内容一致', dl.status === 200 && dlText.includes('Hello attachment 内容'));

  console.log('\n== 6. MX 端口 2525 外部来信（SPF/DKIM/DMARC + 反垃圾）==');
  const raw = [
    'From: External Sender <news@example-external.com>',
    'To: alice@localhost',
    'Subject: External newsletter test',
    'Message-ID: <ext-1@example-external.com>',
    'Date: ' + new Date().toUTCString(),
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    '',
    'Hello from the outside world, this is a normal message.',
  ].join('\r\n');
  let mxOk = true;
  try { await sendRawSmtp({ port: SMTP_PORT, from: 'news@example-external.com', to: 'alice@localhost', data: raw }); }
  catch (e) { mxOk = false; console.log('  MX 错误:', e.message); }
  ok('外部邮件经 MX 投递成功', mxOk);
  const extArrived = await until(async () => {
    const inbox = await api('GET', '/api/messages?folderId=', { token: tokA });
    return inbox.json.messages?.some(m => m.subject === 'External newsletter test');
  });
  ok('外部邮件进入 alice 收件箱', extArrived);
  const aliceInbox2 = await api('GET', '/api/messages?folderId=', { token: tokA });
  const extMsg = aliceInbox2.json.messages.find(m => m.subject === 'External newsletter test');
  ok('记录了认证结果(auth_results)', !!extMsg?.auth_results, extMsg?.auth_results);

  console.log('\n== 7. Submission 587 发信 ==');
  const subTransport = nodemailer.createTransport({
    host: '127.0.0.1', port: SUBMIT_PORT, secure: false, ignoreTLS: true,
    auth: { user: 'alice@localhost', pass: pw },
  });
  const subResult = await subTransport.sendMail({
    from: 'alice@localhost', to: 'bob@localhost',
    subject: 'Via Thunderbird-like submission', text: 'Sent through SMTP submission port.',
  });
  ok('SASL 认证发信成功', !!subResult.messageId, JSON.stringify(subResult.response || ''));
  const subArrived = await until(async () => {
    const inbox = await api('GET', '/api/messages?folderId=', { token: tokB });
    return inbox.json.messages?.some(m => m.subject === 'Via Thunderbird-like submission');
  });
  ok('submission 投递到 bob', subArrived);
  const badAuth = nodemailer.createTransport({ host: '127.0.0.1', port: SUBMIT_PORT, secure: false, ignoreTLS: true, auth: { user: 'alice@localhost', pass: 'nope' } });
  let rejected = false;
  try { await badAuth.sendMail({ from: 'alice@localhost', to: 'bob@localhost', subject: 'x', text: 'x' }); }
  catch { rejected = true; }
  ok('错误密码被 Submission 拒绝', rejected);

  console.log('\n== 8. IMAP ==');
  const client = new ImapFlow({ host: '127.0.0.1', port: IMAP_PORT, secure: false, auth: { user: 'bob@localhost', pass: pw }, logger: false, tls: { rejectUnauthorized: false } });
  await client.connect();
  const lock = await client.getMailboxLock('INBOX');
  let imapCount = 0, firstSubject = '', imapUid = 0;
  try {
    for await (const msg of client.fetch({ all: true }, { envelope: true, flags: true, uid: true, size: true })) {
      imapCount++;
      if (!firstSubject) { firstSubject = msg.envelope?.subject || ''; imapUid = msg.uid; }
    }
  } finally { lock.release(); }
  ok('IMAP SELECT+FETCH 成功', imapCount > 0, `count=${imapCount}`);
  ok('IMAP ENVELOPE 主题正确', firstSubject.length > 0, firstSubject);
  // STORE 标记
  const storeOk = await client.messageFlagsAdd({ uid: imapUid }, ['\\Flagged'], { uid: true });
  ok('IMAP STORE 加星', storeOk === true);
  // SEARCH
  const found = await client.search({ subject: '周报' }, { uid: true });
  ok('IMAP SEARCH 按主题', Array.isArray(found) && found.length > 0, JSON.stringify(found));
  // APPEND
  const appendOk = await client.append('INBOX', 'Subject: IMAP appended\r\nFrom: tester@x.com\r\n\r\nAppended body', ['\\Seen']);
  ok('IMAP APPEND', !!appendOk);
  // LIST
  const mailboxes = (await client.list()).map(m => m.path);
  ok('IMAP LIST 文件夹', mailboxes.some(n => String(n).toUpperCase() === 'INBOX') && mailboxes.length >= 5, mailboxes.join(','));
  await client.logout();

  console.log('\n== 9. POP3 ==');
  const popLines = await pop3({ user: 'alice@localhost', pass: pw }).catch(e => { console.log('  POP3 错误:', e.message); return []; });
  ok('POP3 认证+STAT+LIST', popLines.some(l => l.startsWith('+OK')), popLines.slice(0, 6).join(' | '));

  console.log('\n== 10. 文件夹 / 批量操作 / 归档 / 清空 ==');
  const runTag = Date.now().toString(36);
  const newFolder = await api('POST', '/api/folders', { token: tokB, body: { name: '项目文件' } });
  ok('创建自定义文件夹', newFolder.status === 200 || newFolder.status === 409);
  const foldersB = await api('GET', '/api/folders', { token: tokB });
  const projFolder = foldersB.json.folders.find(f => f.name === '项目文件');
  const someMsgs = (await api('GET', '/api/messages?folderId=', { token: tokB })).json.messages.slice(0, 2).map(m => m.id);
  const batchMove = await api('POST', '/api/messages/batch', { token: tokB, body: { ids: someMsgs, action: 'move', folderId: projFolder.id } });
  ok('批量移动', batchMove.status === 200);
  const inProj = await api('GET', `/api/messages?folderId=${projFolder.id}`, { token: tokB });
  ok('邮件已移动到目标文件夹', inProj.json.messages.length >= 2);
  const batchTrash = await api('POST', '/api/messages/batch', { token: tokB, body: { ids: someMsgs, action: 'trash' } });
  ok('批量删除到垃圾箱', batchTrash.status === 200);
  const starBatch = await api('POST', '/api/messages/batch', { token: tokB, body: { ids: someMsgs.slice(0, 1), action: 'star' } });
  ok('批量加星', starBatch.status === 200);
  const archiveRes = await api('POST', '/api/archive-read', { token: tokA });
  ok('一键归档已读', archiveRes.status === 200);
  const emptyTrash = await api('POST', '/api/folders/trash/empty', { token: tokB });
  ok('清空垃圾箱', emptyTrash.status === 200 && emptyTrash.json.deleted >= 0);

  console.log('\n== 11. 搜索 / 过滤规则 / 黑名单 ==');
  const searchRes = await api('GET', '/api/search?q=周报', { token: tokA });
  ok('全文搜索', searchRes.status === 200 && searchRes.json.messages.length > 0);
  // 过滤规则：来自 example-external.com 的自动移动到 项目文件
  const fltFolder = await api('POST', '/api/folders', { token: tokA, body: { name: '外部订阅' } });
  const foldersA = await api('GET', '/api/folders', { token: tokA });
  const targetF = foldersA.json.folders.find(f => f.name === '外部订阅');
  const flt = await api('POST', '/api/filters', { token: tokA, body: { name: '外部订阅规则', field: 'from', operator: 'contains', value: 'example-external.com', action: 'move_to', folderId: targetF.id } });
  ok('创建过滤规则', flt.status === 200);
  const raw2 = raw.replace('External newsletter test', 'Filtered newsletter test');
  try { await sendRawSmtp({ port: SMTP_PORT, from: 'news@example-external.com', to: 'alice@localhost', data: raw2 }); } catch {}
  const filtered = await until(async () => {
    const list = await api('GET', `/api/messages?folderId=${targetF.id}`, { token: tokA });
    return list.json.messages?.some(m => m.subject === 'Filtered newsletter test');
  }, 8000);
  ok('过滤规则自动归类', filtered);
  // bob 黑名单 example-external.com
  const bl = await api('POST', '/api/blacklist', { token: tokB, body: { pattern: 'example-external.com' } });
  ok('添加用户黑名单', bl.status === 200);
  const raw3 = raw.replace('To: alice@localhost', 'To: bob@localhost').replace('Subject: External newsletter test', 'Subject: Blacklisted mail');
  try { await sendRawSmtp({ port: SMTP_PORT, from: 'news@example-external.com', to: 'bob@localhost', data: raw3 }); } catch {}
  const junkB = await until(async () => {
    const folders = await api('GET', '/api/folders', { token: tokB });
    const junk = folders.json.folders.find(f => f.type === 'junk');
    const list = await api('GET', `/api/messages?folderId=${junk.id}`, { token: tokB });
    return list.json.messages?.some(m => m.subject === 'Blacklisted mail');
  }, 8000);
  ok('黑名单邮件进入垃圾邮件', junkB);

  console.log('\n== 12. 通讯录 ==');
  const c1 = await api('POST', '/api/contacts', { token: tokA, body: { name: '张三', email: `zhangsan-${runTag}@corp.com`, organization: 'ABC公司', phone: '13800138000' } });
  ok('新建联系人', c1.status === 200);
  const groupName = `客户-${runTag}`;
  const group = await api('POST', '/api/contact-groups', { token: tokA, body: { name: groupName } });
  ok('新建分组', group.status === 200, JSON.stringify(group.json));
  const updC = await api('PUT', `/api/contacts/${c1.json.id}`, { token: tokA, body: { groupId: group.json.id } });
  ok('联系人加入分组', updC.status === 200);
  const imp = await api('POST', '/api/contacts/import', { token: tokA, body: { format: 'csv', data: `Name,Email\n李四,lisi-${runTag}@corp.com\n王五,wangwu-${runTag}@corp.com` } });
  ok('CSV 导入', imp.status === 200 && imp.json.imported === 2, JSON.stringify(imp.json));
  const vcardImp = await api('POST', '/api/contacts/import', { token: tokA, body: { format: 'vcard', data: `BEGIN:VCARD\nVERSION:3.0\nFN:赵六\nEMAIL:zhaoliu-${runTag}@corp.com\nEND:VCARD` } });
  ok('vCard 导入', vcardImp.status === 200 && vcardImp.json.imported === 1);
  const exp = await fetch(BASE + '/api/contacts/export?format=vcard', { headers: { Authorization: `Bearer ${tokA}` } });
  const expText = await exp.text();
  ok('vCard 导出', exp.status === 200 && expText.includes('BEGIN:VCARD') && expText.includes(`zhangsan-${runTag}@corp.com`));
  const auto = await api('GET', `/api/autocomplete?q=zhangsan-${runTag}`, { token: tokA });
  ok('收件人自动补全', auto.status === 200 && auto.json.suggestions.length > 0);

  console.log('\n== 13. 2FA ==');
  const { totpCode } = await import('../server/util/crypto.js');
  const setup = await api('POST', '/api/auth/2fa/setup', { token: tokA });
  ok('2FA 密钥生成', setup.status === 200 && setup.json.secret && setup.json.uri.includes('otpauth://'), JSON.stringify(setup.json));
  const enable = await api('POST', '/api/auth/2fa/enable', { token: tokA, body: { code: totpCode(setup.json.secret) } });
  ok('2FA 启用', enable.status === 200);
  const login2 = await api('POST', '/api/auth/login', { body: { address: 'alice@localhost', password: pw } });
  ok('登录要求 2FA', login2.json.need2fa === true && login2.json.ticket);
  const verify2 = await api('POST', '/api/auth/login/2fa', { body: { ticket: login2.json.ticket, code: totpCode(setup.json.secret) } });
  ok('2FA 验证通过并登录', verify2.status === 200 && verify2.json.token);
  const wrong2 = await api('POST', '/api/auth/login', { body: { address: 'bob@localhost', password: pw } });
  const wrongVerify = await api('POST', '/api/auth/login/2fa', { body: { ticket: wrong2.json.ticket, code: '000000' } });
  ok('错误 2FA 码被拒', wrongVerify.status === 401);
  const disable = await api('POST', '/api/auth/2fa/disable', { token: verify2.json.token, body: { code: totpCode(setup.json.secret) } });
  ok('关闭 2FA', disable.status === 200);

  console.log('\n== 14. 管理端 ==');
  const adminLogin = await api('POST', '/api/auth/login', { body: { address: 'admin@localhost', password: 'wrong-password' } });
  ok('管理端拒绝错误密码', adminLogin.status === 401);
  // 从凭据文件读取管理员密码
  const credPath = path.join(__dirname, '..', 'data', 'admin-credentials.txt');
  const adminPass = process.env.ADMIN_PASS || (fs.existsSync(credPath) ? (fs.readFileSync(credPath, 'utf8').match(/密码: (.+)/) || [])[1] : null);
  if (adminPass) {
    const al = await api('POST', '/api/auth/login', { body: { address: 'admin@localhost', password: adminPass } });
    ok('管理员登录', al.status === 200 && al.json.user.role === 'admin');
    const tokAdmin = al.json.token;
    const stats = await api('GET', '/api/admin/stats', { token: tokAdmin });
    ok('仪表盘统计', stats.status === 200 && stats.json.users >= 3 && stats.json.chart.length === 14);
    const domRes = await api('POST', '/api/admin/domains', { token: tokAdmin, body: { name: 'test-domain.com' } });
    ok('添加域名+DKIM', domRes.status === 200 || domRes.status === 409);
    let domId = domRes.json.id;
    if (!domId) {
      const dl = await api('GET', '/api/admin/domains', { token: tokAdmin });
      domId = dl.json.domains.find(d => d.name === 'test-domain.com')?.id;
    }
    const dns = await api('GET', `/api/admin/domains/${domId}/dns?ip=1.2.3.4`, { token: tokAdmin });
    ok('DNS 记录生成(A/MX/SPF/DKIM/DMARC)',
      dns.json.records?.length === 6 &&
      dns.json.records.some(r => r.type.includes('DKIM') && r.value.includes('v=DKIM1')) &&
      dns.json.records.some(r => r.type === 'MX'), JSON.stringify(dns.json.records?.map(r => r.type)));
    const chk = await api('GET', `/api/admin/domains/${domId}/check?ip=1.2.3.4`, { token: tokAdmin });
    ok('DNS 一键检测接口（A/MX/SPF/DKIM/DMARC/PTR/SMTP监听）',
      chk.status === 200 && Array.isArray(chk.json.results) && chk.json.results.length >= 7 && chk.json.results.some(r => r.name.includes('SMTP')),
      JSON.stringify(chk.json.results?.map(r => `${r.name}:${r.ok ? 'ok' : 'miss'}`)));
    const aliasRes = await api('POST', '/api/admin/aliases', { token: tokAdmin, body: { source: 'info@test-domain.com', destination: 'alice@localhost' } });
    ok('创建别名', aliasRes.status === 200 || aliasRes.status === 409);
    // 别名投递测试（用独立发件域名，避免与前面创建的过滤规则/黑名单相互影响）
    const raw4 = raw.replace('To: alice@localhost', 'To: info@test-domain.com').replace('From: External Sender <news@example-external.com>', 'From: External Sender <news@other-example.org>').replace('Subject: External newsletter test', 'Subject: Alias delivery test');
    try { await sendRawSmtp({ port: SMTP_PORT, from: 'news@other-example.org', to: 'info@test-domain.com', data: raw4 }); } catch {}
    const aliasArrived = await until(async () => {
      const inbox = await api('GET', '/api/messages?folderId=', { token: tokA });
      return inbox.json.messages?.some(m => m.subject === 'Alias delivery test');
    });
    ok('别名转发投递成功', aliasArrived);
    // catch-all
    const catchAll = await api('PATCH', `/api/admin/domains/${domId}`, { token: tokAdmin, body: { catchAll: 'bob@localhost' } });
    ok('设置 Catch-all', catchAll.status === 200);
    const raw5 = raw.replace('To: alice@localhost', 'To: anyone@test-domain.com').replace('news@example-external.com', 'news@other-example.org').replace('External newsletter test', 'Catchall delivery test');
    try { await sendRawSmtp({ port: SMTP_PORT, from: 'news@other-example.org', to: 'anyone@test-domain.com', data: raw5 }); } catch {}
    const catchArrived = await until(async () => {
      const search = await api('GET', '/api/search?q=Catchall', { token: tokB });
      return search.json.messages?.some(m => m.subject === 'Catchall delivery test');
    }, 10000);
    ok('Catch-all 投递成功', catchArrived);
    const gbl = await api('POST', '/api/admin/blacklist', { token: tokAdmin, body: { pattern: 'spam-source.example' } });
    ok('全局黑名单', gbl.status === 200);
    const auditLogs = await api('GET', '/api/admin/audit?page=1', { token: tokAdmin });
    ok('审计日志', auditLogs.status === 200 && auditLogs.json.logs.length > 0);
    const smtpTest = await api('POST', '/api/admin/smtp-test', { token: tokAdmin, body: { to: 'alice@localhost' } });
    ok('SMTP 测试邮件', smtpTest.status === 200, JSON.stringify(smtpTest.json));
    const backup = await fetch(BASE + '/api/admin/backup', { headers: { Authorization: `Bearer ${tokAdmin}` } });
    ok('数据库备份下载', backup.status === 200);
    const noAccess = await api('GET', '/api/admin/stats', { token: tokB });
    ok('普通用户无权访问管理端(RBAC)', noAccess.status === 403);
  } else {
    console.log('  (跳过管理端测试：未找到管理员凭据)');
  }

  console.log('\n== 15. 忘记密码 / 会话 ==');
  const forgot = await api('POST', '/api/auth/forgot', { body: { address: 'bob@localhost' } });
  ok('忘记密码请求', forgot.status === 200);
  const sysMailArrived = await until(async () => {
    const inbox = await api('GET', '/api/messages?folderId=', { token: tokB });
    return inbox.json.messages?.some(m => m.subject.includes('密码重置'));
  });
  ok('重置链接通过站内信送达', sysMailArrived);
  const sessList = await api('GET', '/api/auth/sessions', { token: tokB });
  ok('会话列表', sessList.status === 200 && sessList.json.sessions.length > 0);
  const pwdChange = await api('POST', '/api/auth/password', { token: tokB, body: { current: pw, next: 'NewPass456!' } });
  ok('修改密码', pwdChange.status === 200);
  const relLogin = await api('POST', '/api/auth/login', { body: { address: 'bob@localhost', password: 'NewPass456!' } });
  ok('新密码可登录', relLogin.status === 200);
  await api('POST', '/api/auth/password', { token: relLogin.json.token, body: { current: 'NewPass456!', next: pw } });

  console.log('\n== 16. 语言与语言包 ==');
  // 管理员 token（区块 14 中定义的 tokAdmin 作用域不在此处）
  const credPath16 = path.join(__dirname, '..', 'data', 'admin-credentials.txt');
  const adminPass16 = process.env.ADMIN_PASS || (fs.existsSync(credPath16) ? (fs.readFileSync(credPath16, 'utf8').match(/密码: (.+)/) || [])[1] : null);
  const tokAdmin16 = adminPass16 ? (await api('POST', '/api/auth/login', { body: { address: 'admin@localhost', password: adminPass16 } })).json.token : null;

  const langs0 = await (await fetch(BASE + '/api/langs')).json();
  ok('语言列表 API（内置 zh/en + 8 个可安装包）',
    langs0.length === 10 && langs0.filter(l => l.installed).length === 2 && langs0.some(l => l.code === 'ar' && l.rtl),
    JSON.stringify(langs0.map(l => l.code + (l.installed ? '*' : ''))));
  const builtinGuard = await api('POST', '/api/admin/langs/remove', { token: tokAdmin16, body: { code: 'zh' } });
  ok('内置语言不可移除', builtinGuard.status === 400);
  const noPerm = await api('POST', '/api/admin/langs/install', { token: tokB, body: { code: 'fr' } });
  ok('普通用户不能安装语言包(RBAC)', noPerm.status === 403 || noPerm.status === 401);
  const instFr = await api('POST', '/api/admin/langs/install', { token: tokAdmin16, body: { code: 'fr' } });
  ok('管理端安装语言包 fr', instFr.status === 200, JSON.stringify(instFr.json));
  const langs1 = await (await fetch(BASE + '/api/langs')).json();
  ok('安装后 fr 标记为已安装', langs1.find(l => l.code === 'fr')?.installed === true);
  const frFile = await fetch(BASE + '/locales/fr.json');
  const frJson = await frFile.json();
  ok('fr.json 可访问且词条完整', frFile.status === 200 && frJson.__name === 'Français' && !!frJson['nav.mail']);
  const arFile = await fetch(BASE + '/locales/ar.json');
  ok('ar.json（未安装包）不可作为语言包访问',
    arFile.status === 404 || !(arFile.headers.get('content-type') || '').includes('json'),
    `status=${arFile.status} type=${arFile.headers.get('content-type')}`);
  const rmFr = await api('POST', '/api/admin/langs/remove', { token: tokAdmin16, body: { code: 'fr' } });
  ok('移除语言包 fr', rmFr.status === 200);

  console.log('\n== 17.5 外发队列入队 ==');
  const extSend = await api('POST', '/api/send', { token: tokA, body: { to: 'someone@external-check.com', subject: '外部队列入队测试', text: 'queue test' } });
  ok('发往外部地址立即返回并入队', extSend.status === 200 && (extSend.json.external || []).length === 1, JSON.stringify(extSend.json));
  const queueCheck = await api('GET', '/api/admin/queue', { token: tokAdmin16 });
  ok('外发队列已记录外部收件人', queueCheck.status === 200 && JSON.stringify(queueCheck.json.queue).includes('external-check.com'), JSON.stringify(queueCheck.json.queue?.slice(0, 2)));

  console.log('\n== 17. 官网 / 邮件模板 / AI 配置 ==');
  const site = await fetch(BASE + '/home');
  const siteHtml = await site.text();
  ok('产品官网（/home）', site.status === 200 && siteHtml.includes('进入邮箱') && siteHtml.includes('JOUaaaaa'));
  const appPage = await fetch(BASE + '/app/');
  const appHtml = await appPage.text();
  ok('邮件客户端（/app/）', appPage.status === 200 && appHtml.includes('/js/app.js'));
  const rootPage = await fetch(BASE + '/');
  const rootHtml = await rootPage.text();
  ok('根路径直达邮箱（/）', rootPage.status === 200 && rootHtml.includes('/js/app.js'));
  // 模板 CRUD
  const tplC = await api('POST', '/api/templates', { token: tokA, body: { name: '周报模板', subject: '每周播报', html: '<h1>周报</h1><p>内容</p>' } });
  ok('创建模板', tplC.status === 200 && tplC.json.id, JSON.stringify(tplC.json));
  const tplImp = await api('POST', '/api/templates/import', { token: tokA, body: { name: '导入的新闻模板', html: '<html><title>News Digest</title><body>hello</body></html>' } });
  ok('导入 HTML 模板（自动取 title 为主题）', tplImp.status === 200, JSON.stringify(tplImp.json));
  const tplG = await api('GET', '/api/templates/' + tplC.json.id, { token: tokA });
  ok('读取模板详情', tplG.json.template?.html?.includes('周报'));
  const tplU = await api('PUT', '/api/templates/' + tplC.json.id, { token: tokA, body: { name: '周报模板 v2' } });
  ok('更新模板', tplU.status === 200);
  const tplL = await api('GET', '/api/templates', { token: tokA });
  ok('模板列表（含来源标记）', tplL.json.templates.length >= 2 && tplL.json.templates.every(x => ['manual', 'import', 'ai'].includes(x.source)));
  const tplOther = await api('GET', '/api/templates/' + tplC.json.id, { token: tokB });
  ok('模板按用户隔离', tplOther.status === 404);
  // AI 配置（先重置为未配置状态）
  await api('PUT', '/api/ai/config', { token: tokA, body: { baseUrl: '', model: '', apiKey: null, enabled: false } });
  const aiNo = await api('POST', '/api/ai/write', { token: tokA, body: { instruction: 'test' } });
  ok('未配置 AI 时给出明确错误', aiNo.status === 400 && /配置/.test(aiNo.json.error || ''), JSON.stringify(aiNo.json));
  const aiCfg = await api('PUT', '/api/ai/config', { token: tokA, body: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', apiKey: 'sk-test-1234567890abcdef', enabled: true } });
  ok('保存 AI 配置（密钥打码返回）', aiCfg.status === 200 && /sk-t\*+cdef/.test(aiCfg.json.config.apiKeyMasked) && !JSON.stringify(aiCfg.json).includes('sk-test-1234567890'), JSON.stringify(aiCfg.json.config));
  const aiGet = await api('GET', '/api/ai/config', { token: tokA });
  ok('读取 AI 配置不泄露明文密钥', aiGet.status === 200 && aiGet.json.config.hasKey === true && !JSON.stringify(aiGet.json).includes('sk-test-1234567890'));
  const aiTest = await api('POST', '/api/ai/test', { token: tokA });
  ok('假密钥调用上游返回可读错误', [400, 502].includes(aiTest.status) && !!aiTest.json.error, JSON.stringify(aiTest.json).slice(0, 120));
  const aiCfg2 = await api('PUT', '/api/ai/config', { token: tokA, body: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', apiKey: '', enabled: false } });
  ok('留空 API Key 保留原密钥', aiCfg2.status === 200 && aiCfg2.json.config.hasKey === true);

  console.log('\n' + '='.repeat(50));
  console.log(`结果: ${passed} 通过, ${failed} 失败`);
  if (failures.length) {
    console.log('失败项:');
    failures.forEach(f => console.log('  - ' + f));
    process.exit(1);
  }
}

main().catch(err => { console.error('测试框架异常:', err); process.exit(1); });
