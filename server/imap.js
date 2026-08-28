// 极简 IMAP4rev1 服务端：支持 Thunderbird/Apple Mail 等客户端基本收信
// 支持：LOGIN/AUTHENTICATE PLAIN/STARTTLS、SELECT/EXAMINE、LIST、FETCH(BODY/ENVELOPE/FLAGS...)、
//       STORE、SEARCH、COPY/MOVE、APPEND、EXPUNGE、IDLE、UID 命令族
import net from 'node:net';
import tls from 'node:tls';
import bcrypt from 'bcryptjs';
import mailparser from 'mailparser';
import { q, now } from './db.js';
import { config } from './config.js';
import { getTLSContext } from './util/tlsutil.js';
import { mailEvents, storeMessage, saveAttachmentBuffer } from './mail/mailstore.js';

const { simpleParser } = mailparser;

function nextUid(folderId) {
  const f = q.get('SELECT uid_next FROM folders WHERE id = ?', folderId);
  q.run('UPDATE folders SET uid_next = uid_next + 1 WHERE id = ?', folderId);
  return f ? f.uid_next : 1;
}

const CAPABILITIES = ['IMAP4rev1', 'UIDPLUS', 'IDLE', 'MOVE', 'UTF8=ACCEPT', 'LITERAL+'];

// ---------------- 词法 ----------------
function tokenize(line) {
  const tokens = [];
  let i = 0;
  while (i < line.length) {
    const c = line[i];
    if (c === ' ') { i++; continue; }
    if (c === '"') {
      let j = i + 1, out = '';
      while (j < line.length) {
        if (line[j] === '\\' && j + 1 < line.length) { out += line[j + 1]; j += 2; }
        else if (line[j] === '"') break;
        else { out += line[j]; j++; }
      }
      tokens.push({ type: 'string', value: out });
      i = j + 1;
    } else if (c === '(' || c === ')') {
      tokens.push({ type: 'paren', value: c }); i++;
    } else if (c === '[' || c === ']') {
      tokens.push({ type: 'bracket', value: c }); i++;
    } else {
      let j = i;
      while (j < line.length && !' ()[]"'.includes(line[j])) j++;
      tokens.push({ type: 'atom', value: line.slice(i, j) });
      i = j;
    }
  }
  return tokens;
}

// 从 socket 缓冲中提取一条完整命令（处理 {N} 字面量）
function tryExtractCommand(buf) {
  let i = 0;
  const tokens = [];
  for (;;) {
    const crlf = buf.indexOf('\r\n', i);
    if (crlf === -1) return null;
    const line = buf.slice(i, crlf).toString('utf8');
    const m = line.match(/\{(\d+)\}$|\{(\d+)\+}$/);
    if (!m) {
      tokens.push(...tokenize(line));
      return { tokens, consumed: crlf + 2 };
    }
    const litLen = parseInt(m[1] || m[2]);
    const litStart = crlf + 2;
    if (buf.length < litStart + litLen) return null;
    tokens.push(...tokenize(line.slice(0, -m[0].length)));
    tokens.push({ type: 'literal', value: buf.slice(litStart, litStart + litLen) });
    i = litStart + litLen;
  }
}

// 序列号集合解析 "1:5,7,9:*"
function parseSeqSet(str, total) {
  const out = [];
  for (const part of String(str).split(',')) {
    let [a, b] = part.split(':');
    a = a === '*' ? total : parseInt(a);
    if (b === undefined) b = a;
    else b = b === '*' ? total : parseInt(b);
    if (isNaN(a) || isNaN(b)) continue;
    if (a > b) [a, b] = [b, a];
    for (let n = a; n <= b; n++) if (n >= 1 && n <= total) out.push(n);
  }
  return [...new Set(out)];
}

function imapQuote(s) {
  if (s === null || s === undefined) return 'NIL';
  return `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function imapDate(ts) {
  const d = new Date(ts);
  const pad = n => String(n).padStart(2, '0');
  return `${String(d.getDate()).padStart(2, '0')}-${MONTHS[d.getMonth()]}-${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())} +0800`;
}

function flagsOf(m) {
  const f = [];
  if (m.is_read) f.push('\\Seen');
  if (m.is_answered) f.push('\\Answered');
  if (m.is_starred) f.push('\\Flagged');
  if (m.is_draft) f.push('\\Draft');
  if (m.imap_deleted) f.push('\\Deleted');
  return f.join(' ');
}

function addressListImap(csv) {
  if (!csv) return 'NIL';
  const addrs = String(csv).split(',').map(s => s.trim()).filter(Boolean);
  if (!addrs.length) return 'NIL';
  const parts = addrs.map(a => {
    // 尝试匹配 "Name <a@b>"
    const m = a.match(/^(.*?)<([^>]+)>$/) || [null, '', a];
    const name = (m[1] || '').trim().replace(/^"|"$/g, '');
    const addr = (m[2] || a).trim();
    const [local, host] = addr.split('@');
    return `(${imapQuote(name || null)} NIL ${imapQuote(local)} ${imapQuote(host)})`;
  });
  return `(${parts.join(' ')})`;
}

function envelopeOf(m) {
  return `(${imapQuote(imapDate(m.delivered_at))} ${imapQuote(m.subject)} ` +
    `${addressListImap(m.from_addr ? `${m.from_name ? `"${m.from_name}" ` : ''}<${m.from_addr}>` : '')} ` +
    `${addressListImap(m.from_addr)} ${addressListImap(m.reply_to || m.from_addr)} ` +
    `${addressListImap(m.to_addrs)} ${addressListImap(m.cc_addrs)} ${addressListImap(m.bcc_addrs)} ` +
    `${imapQuote(m.in_reply_to || null)} ${imapQuote(m.message_id || null)})`;
}

function splitRaw(raw) {
  const s = Buffer.isBuffer(raw) ? raw : Buffer.from(String(raw || ''), 'utf8');
  const idx = s.indexOf('\r\n\r\n');
  const sep = 4;
  let header, body;
  if (idx === -1) {
    const idx2 = s.indexOf('\n\n');
    if (idx2 === -1) return { header: s, body: Buffer.alloc(0) };
    return { header: s.slice(0, idx2 + 1), body: s.slice(idx2 + 2) };
  }
  header = s.slice(0, idx);
  body = s.slice(idx + sep);
  return { header, body };
}

// ---------------- 会话 ----------------
class ImapSession {
  constructor(socket) {
    this.socket = socket;
    this.buffer = Buffer.alloc(0);
    this.user = null;
    this.selected = null;   // {folderId, readOnly, uidValidity}
    this.idling = false;
    this.idleHandler = null;
  }

  write(s) { try { this.socket.write(s.endsWith('\r\n') ? s : s + '\r\n'); } catch {} }

  resolveMailbox(name) {
    if (!this.user) return null;
    const nm = String(name || '');
    if (nm.toUpperCase() === 'INBOX') {
      return q.get("SELECT * FROM folders WHERE user_id = ? AND type = 'inbox'", this.user.id);
    }
    return q.get('SELECT * FROM folders WHERE user_id = ? AND name = ?', this.user.id, nm)
      || q.get('SELECT * FROM folders WHERE user_id = ? AND name = ?', this.user.id, nm.replace(/^"|"$/g, ''));
  }

  orderedMessages(folderId) {
    return q.all('SELECT id, uid FROM messages WHERE user_id = ? AND folder_id = ? ORDER BY uid ASC', this.user.id, folderId);
  }

  uidValidity(folderId) { return 100000 + Number(folderId); }

  notifyStore(userId, folderId) {
    if (!this.user || this.user.id !== userId || !this.selected || this.selected.folderId !== folderId) return;
    const n = q.get('SELECT COUNT(*) AS c FROM messages WHERE user_id = ? AND folder_id = ?', userId, folderId).c;
    this.write(`* ${n} EXISTS`);
    const unread = q.get('SELECT COUNT(*) AS c FROM messages WHERE user_id = ? AND folder_id = ? AND is_read = 0', userId, folderId).c;
    this.write(`* ${unread} RECENT`);
  }

  // ---------- 命令处理 ----------
  async handle(tokens) {
    const tag = tokens.shift()?.value;
    if (!tag) return;
    const cmd = (tokens.shift()?.value || '').toUpperCase();
    const ok = (msg) => this.write(`${tag} OK ${msg}`);
    const bad = (msg) => this.write(`${tag} BAD ${msg}`);
    const no = (msg) => this.write(`${tag} NO ${msg}`);

    try {
      switch (cmd) {
        case 'CAPABILITY':
          this.write(`* CAPABILITY ${CAPABILITIES.join(' ')}${this.user ? '' : ' AUTH=PLAIN'}`);
          return ok('CAPABILITY completed');
        case 'NOOP': return ok('NOOP completed');
        case 'LOGOUT':
          this.write('* BYE OpenMail IMAP closing');
          this.socket.end();
          return;
        case 'ID':
          this.write(`* ID ("name" "OpenMail" "version" "1.0")`);
          return ok('ID completed');
        case 'LOGIN': {
          if (this.user) return no('Already authenticated');
          const userArg = tokens[0]?.value ?? '';
          const passArg = tokens[1]?.value ?? '';
          return this.doAuth(tag, String(userArg), String(passArg), ok, no);
        }
        case 'AUTHENTICATE': {
          const mech = (tokens[0]?.value || '').toUpperCase();
          if (mech !== 'PLAIN') return no('Unsupported auth mechanism');
          if (tokens[1]) {
            const decoded = Buffer.from(String(tokens[1]?.value ?? ''), 'base64').toString('utf8').split('\0');
            return this.doAuth(tag, decoded[1] || '', decoded[2] || '', ok, no);
          }
          this.write('+ ');
          this.awaitContinuation = (line) => {
            try {
              const decoded = Buffer.from(line.trim(), 'base64').toString('utf8').split('\0');
              this.doAuth(tag, decoded[1] || '', decoded[2] || '', ok, no);
            } catch { no('Invalid SASL response'); }
          };
          return;
        }
        case 'STARTTLS': {
          const ctx = getTLSContext();
          if (!ctx) return no('TLS not available');
          this.write(`${tag} OK Begin TLS`);
          const tlsSocket = new tls.TLSSocket(this.socket, { isServer: true, key: ctx.key, cert: ctx.cert });
          this.socket = tlsSocket;
          this.buffer = Buffer.alloc(0);
          tlsSocket.on('data', (d) => this.onData(d));
          tlsSocket.on('error', () => {});
          return;
        }
      }

      if (!this.user) return bad('Please authenticate first');

      switch (cmd) {
        case 'LIST': case 'LSUB': return this.cmdList(tag, ok);
        case 'SELECT': case 'EXAMINE': return this.cmdSelect(tag, tokens, ok, no, cmd === 'EXAMINE');
        case 'CREATE': return this.cmdCreate(tag, tokens, ok, no);
        case 'DELETE': return this.cmdDelete(tag, tokens, ok, no);
        case 'RENAME': return this.cmdRename(tag, tokens, ok, no);
        case 'STATUS': return this.cmdStatus(tag, tokens, ok, no);
        case 'APPEND': return this.cmdAppend(tag, tokens, ok, no);
        case 'FETCH': return this.cmdFetch(tag, tokens, ok, no, false);
        case 'UID': {
          const sub = (tokens.shift()?.value || '').toUpperCase();
          if (sub === 'FETCH') return this.cmdFetch(tag, tokens, ok, no, true);
          if (sub === 'STORE') return this.cmdStore(tag, tokens, ok, no, true);
          if (sub === 'SEARCH') return this.cmdSearch(tag, tokens, ok, no, true);
          if (sub === 'COPY') return this.cmdCopy(tag, tokens, ok, no, true, false);
          if (sub === 'MOVE') return this.cmdCopy(tag, tokens, ok, no, true, true);
          return bad(`Unknown UID command ${sub}`);
        }
        case 'STORE': return this.cmdStore(tag, tokens, ok, no, false);
        case 'SEARCH': return this.cmdSearch(tag, tokens, ok, no, false);
        case 'COPY': return this.cmdCopy(tag, tokens, ok, no, false, false);
        case 'MOVE': return this.cmdCopy(tag, tokens, ok, no, false, true);
        case 'EXPUNGE': return this.cmdExpunge(tag, ok);
        case 'CLOSE': {
          q.run('UPDATE messages SET imap_deleted = 1 WHERE ...'); // noop guard
          if (this.selected) {
            q.run('DELETE FROM messages WHERE user_id = ? AND folder_id = ? AND imap_deleted = 1', this.user.id, this.selected.folderId);
          }
          this.selected = null;
          return ok('CLOSE completed');
        }
        case 'UNSELECT': this.selected = null; return ok('UNSELECT completed');
        case 'CHECK': case 'SUBSCRIBE': case 'UNSUBSCRIBE': case 'ENABLE': return ok(`${cmd} completed`);
        case 'IDLE': {
          this.idling = true;
          this.write('+ idling');
          this.awaitContinuation = () => {
            this.idling = false;
            ok('IDLE terminated');
          };
          return;
        }
        default: return bad(`Unknown command ${cmd}`);
      }
    } catch (err) {
      console.error('[imap] 命令错误:', err);
      this.write(`${tag} NO Internal error: ${err.message}`);
    }
  }

  doAuth(tag, username, password, ok, no) {
    const uname = String(username).toLowerCase().trim();
    const fullAddr = uname.includes('@') ? uname : `${uname}@${config.primaryDomain}`;
    const user = q.get('SELECT * FROM users WHERE address = ? OR address = ?', fullAddr, uname);
    if (!user || user.status === 'banned') return no('[AUTHENTICATIONFAILED] Authentication failed');
    bcrypt.compare(String(password), user.password_hash).then(match => {
      if (!match) return no('[AUTHENTICATIONFAILED] Authentication failed');
      this.user = user;
      ok(`[CAPABILITY ${CAPABILITIES.join(' ')}] Authenticated`);
    });
  }

  cmdList(tag, ok) {
    const folders = q.all('SELECT * FROM folders WHERE user_id = ? ORDER BY sort_order, id', this.user.id);
    this.write('* LIST () "/" "INBOX"');
    for (const f of folders) {
      if (f.type === 'inbox') continue;
      this.write(`* LIST (\\HasNoChildren) "/" ${imapQuote(f.name)}`);
    }
    ok('LIST completed');
  }

  cmdSelect(tag, tokens, ok, no, readOnly) {
    if (!this.selected) { /* ok */ }
    const name = tokens[0]?.value ?? '';
    const folder = this.resolveMailbox(name);
    if (!folder) return no('Mailbox does not exist');
    const msgs = this.orderedMessages(folder.id);
    this.selected = { folderId: folder.id, readOnly, name: folder.name };
    const exists = msgs.length;
    const unseen = q.get('SELECT COUNT(*) AS c FROM messages WHERE user_id = ? AND folder_id = ? AND is_read = 0', this.user.id, folder.id).c;
    const firstUnseen = q.get('SELECT uid FROM messages WHERE user_id = ? AND folder_id = ? AND is_read = 0 ORDER BY uid LIMIT 1', this.user.id, folder.id);
    this.write(`* ${exists} EXISTS`);
    this.write('* 0 RECENT');
    this.write(`* FLAGS (\\Answered \\Flagged \\Deleted \\Seen \\Draft)`);
    this.write(`* OK [PERMANENTFLAGS (\\Answered \\Flagged \\Deleted \\Seen \\Draft)] Flags permitted`);
    this.write(`* OK [UIDVALIDITY ${this.uidValidity(folder.id)}] UIDs valid`);
    this.write(`* OK [UIDNEXT ${folder.uid_next}] Predicted next UID`);
    if (firstUnseen) this.write(`* OK [UNSEEN] There are unseen messages`);
    ok(`[READ-${readOnly ? 'ONLY' : 'WRITE'}] ${'SELECT'} completed`);
  }

  cmdCreate(tag, tokens, ok, no) {
    const name = tokens[0]?.value ?? '';
    if (!name) return no('Missing mailbox name');
    if (name.toUpperCase() === 'INBOX') return no('Cannot create INBOX');
    const exists = q.get('SELECT id FROM folders WHERE user_id = ? AND name = ?', this.user.id, name);
    if (exists) return no('Mailbox already exists');
    q.run('INSERT INTO folders(user_id, name, type, sort_order) VALUES(?,?,?,?)', this.user.id, name, 'custom', 100);
    ok('CREATE completed');
  }

  cmdDelete(tag, tokens, ok, no) {
    const name = tokens[0]?.value ?? '';
    const folder = this.resolveMailbox(name);
    if (!folder) return no('Mailbox does not exist');
    if (['inbox', 'sent', 'drafts', 'trash', 'junk'].includes(folder.type)) return no('System folder cannot be deleted');
    q.run('DELETE FROM folders WHERE id = ?', folder.id);
    ok('DELETE completed');
  }

  cmdRename(tag, tokens, ok, no) {
    const from = this.resolveMailbox(tokens[0]?.value ?? '');
    const toName = tokens[1]?.value ?? '';
    if (!from) return no('Mailbox does not exist');
    if (!toName) return no('Missing new name');
    q.run('UPDATE folders SET name = ? WHERE id = ?', toName, from.id);
    ok('RENAME completed');
  }

  cmdStatus(tag, tokens, ok, no) {
    const folder = this.resolveMailbox(tokens[0]?.value ?? '');
    if (!folder) return no('Mailbox does not exist');
    const total = q.get('SELECT COUNT(*) AS c FROM messages WHERE user_id = ? AND folder_id = ?', this.user.id, folder.id).c;
    const unseen = q.get('SELECT COUNT(*) AS c FROM messages WHERE user_id = ? AND folder_id = ? AND is_read = 0', this.user.id, folder.id).c;
    this.write(`* STATUS ${imapQuote(folder.name)} (MESSAGES ${total} UNSEEN ${unseen} UIDNEXT ${folder.uid_next} UIDVALIDITY ${this.uidValidity(folder.id)})`);
    ok('STATUS completed');
  }

  cmdAppend(tag, tokens, ok, no) {
    const name = tokens[0]?.value ?? '';
    const folder = this.resolveMailbox(name);
    if (!folder) return no('Mailbox does not exist');
    const lit = [...tokens].reverse().find(t => t.type === 'literal');
    if (!lit) return no('Missing literal');
    const flagTokens = tokens.filter(t => t.type === 'atom' && t.value.startsWith('\\'));
    const raw = lit.value;
    simpleParser(raw).then(parsed => {
      const meta = {
        fromName: parsed.from?.value?.[0]?.name || '', fromAddr: parsed.from?.value?.[0]?.address || '',
        toAddrs: (parsed.to?.value || []).map(v => v.address).join(', '),
        ccAddrs: (parsed.cc?.value || []).map(v => v.address).join(', '),
        bccAddrs: '', replyTo: '', subject: parsed.subject || '(无主题)',
        messageId: parsed.messageId || '', inReplyTo: parsed.inReplyTo || '', references: parsed.references || '',
        bodyText: parsed.text || '', bodyHtml: typeof parsed.html === 'string' ? parsed.html : '',
        date: parsed.date ? parsed.date.getTime() : now(), spamScore: 0, authResults: 'appended',
        size: raw.length,
      };
      const atts = (parsed.attachments || []).map(a => {
        const saved = saveAttachmentBuffer(this.user.id, a.filename, a.contentType, a.content, a.cid);
        return { ...saved, isInline: !!a.related };
      });
      const id = storeMessage(this.user.id, meta, atts, {
        folderId: folder.id, skipFilters: true,
        isRead: flagTokens.some(t => /seen/i.test(t.value)),
        rawEml: raw.toString('utf8'), isOutgoing: true,
      });
      const uid = q.get('SELECT uid FROM messages WHERE id = ?', id).uid;
      ok(`[APPENDUID ${this.uidValidity(folder.id)} ${uid}] APPEND completed`);
    }).catch(err => {
      console.error('[imap] APPEND 失败:', err);
      no('APPEND failed');
    });
  }

  cmdFetch(tag, tokens, ok, no, byUid) {
    if (!this.selected) return no('No mailbox selected');
    const set = tokens[0]?.value;
    const msgs = this.orderedMessages(this.selected.folderId);
    const total = msgs.length;
    const seqs = parseSeqSet(set, total);
    if (!seqs.length) return ok('FETCH completed (no messages)');

    // fetch 项：处理括号包裹与单项
    let itemTokens = tokens.slice(1);
    if (itemTokens[0]?.type === 'paren' && itemTokens[0].value === '(') {
      itemTokens = itemTokens.slice(1);
      const closeIdx = itemTokens.findIndex(t => t.type === 'paren' && t.value === ')');
      if (closeIdx >= 0) itemTokens = itemTokens.slice(0, closeIdx);
    }

    for (const seq of seqs) {
      const row = msgs[seq - 1];
      const m = q.get('SELECT * FROM messages WHERE id = ? AND user_id = ?', row.id, this.user.id);
      if (!m) continue;
      const parts = [];   // 字符串 或 {head, buf}（二进制字面量）
      let markSeen = false;
      let i = 0;
      while (i < itemTokens.length) {
        const t = itemTokens[i];
        const name = (t?.value || '').toString();
        if (/^BODY(\.PEEK)?$/i.test(name) || (t.type === 'atom' && name.toUpperCase() === 'RFC822')) {
          const peek = /\.PEEK$/i.test(name);
          // 收集 [...] 内容
          let spec = '';
          i++;
          if (itemTokens[i]?.type === 'bracket' && itemTokens[i].value === '[') {
            i++;
            let depth = 1;
            let buf2 = '';
            while (i < itemTokens.length && depth > 0) {
              const tk = itemTokens[i];
              if (tk.type === 'bracket' && tk.value === '[') depth++;
              if (tk.type === 'bracket' && tk.value === ']') { depth--; if (depth === 0) break; }
              buf2 += (buf2 && !buf2.endsWith(' ') ? ' ' : '') + tk.value;
              i++;
            }
            spec = buf2.trim();
          }
          i++; // 跳过 ]
          const rawBuf = m.raw_eml ? Buffer.from(m.raw_eml, 'utf8') : Buffer.from(buildEmlFromRow(m), 'utf8');
          if (!peek) markSeen = true;
          if (!spec) {
            parts.push({ head: `BODY[] {${rawBuf.length}}\r\n`, buf: rawBuf });
          } else if (/^HEADER(\.FIELDS)?/i.test(spec)) {
            const { header } = splitRaw(rawBuf);
            const fieldsMatch = spec.match(/HEADER\.FIELDS\s*\(([^)]*)\)/i);
            if (fieldsMatch) {
              const fields = fieldsMatch[1].split(/\s+/).map(s => s.toUpperCase());
              const lines = header.toString('utf8').split(/\r?\n/);
              const kept = lines.filter(l => fields.includes(l.split(':')[0].toUpperCase()));
              const out = Buffer.from(kept.join('\r\n') + '\r\n\r\n', 'utf8');
              parts.push({ head: `BODY[HEADER.FIELDS (${fields.join(' ')})] {${out.length}}\r\n`, buf: out });
            } else {
              parts.push({ head: `BODY[HEADER] {${header.length}}\r\n`, buf: header });
            }
          } else if (/^TEXT$/i.test(spec)) {
            const { body } = splitRaw(rawBuf);
            parts.push({ head: `BODY[TEXT] {${body.length}}\r\n`, buf: body });
          } else {
            // 简化 MIME part：返回整个正文
            const { body } = splitRaw(rawBuf);
            parts.push({ head: `BODY[${spec}] {${body.length}}\r\n`, buf: body });
          }
          if (name.toUpperCase() === 'RFC822') {
            parts[parts.length - 1] = { head: `RFC822 {${rawBuf.length}}\r\n`, buf: rawBuf };
          }
        } else if (/^FLAGS$/i.test(name)) {
          parts.push(`FLAGS (${flagsOf(m)})`);
        } else if (/^UID$/i.test(name)) {
          parts.push(`UID ${m.uid}`);
        } else if (/^RFC822\.SIZE$/i.test(name)) {
          parts.push(`RFC822.SIZE ${m.size}`);
        } else if (/^INTERNALDATE$/i.test(name)) {
          parts.push(`INTERNALDATE "${imapDate(m.delivered_at)}"`);
        } else if (/^ENVELOPE$/i.test(name)) {
          parts.push(`ENVELOPE ${envelopeOf(m)}`);
        } else if (/^BODYSTRUCTURE$/i.test(name)) {
          parts.push(`BODYSTRUCTURE ${bodyStructureOf(m)}`);
        } else if (/^BODY$/i.test(name) && !itemTokens[i + 1]) {
          parts.push(`BODY ${bodyStructureOf(m)}`);
        }
        i++;
      }
      if (markSeen && !m.is_read && !this.selected.readOnly) {
        q.run('UPDATE messages SET is_read = 1 WHERE id = ?', m.id);
        m.is_read = 1;
        const fl = parts.findIndex(p => typeof p === 'string' && p.startsWith('FLAGS'));
        if (fl === -1) parts.push('FLAGS (\\Seen)');
      }
      // 混合输出（字符串 + 二进制字面量）
      let line = `* ${seq} FETCH (`;
      let first = true;
      for (const p of parts) {
        if (!first) line += ' ';
        first = false;
        if (typeof p === 'string') { line += p; continue; }
        line += p.head;
        this.socket.write(line);
        this.socket.write(p.buf);
        line = '';
      }
      this.socket.write(line + ')\r\n');
    }
    ok('FETCH completed');
  }

  cmdStore(tag, tokens, ok, no, byUid) {
    if (!this.selected) return no('No mailbox selected');
    const set = tokens[0]?.value;
    const op = (tokens[1]?.value || '').toUpperCase();
    const flagTokens = [];
    for (let i = 2; i < tokens.length; i++) {
      const t = tokens[i];
      if (t.type === 'atom') flagTokens.push(t.value);
    }
    const msgs = this.orderedMessages(this.selected.folderId);
    const seqs = parseSeqSet(set, msgs.length);
    const silent = op.endsWith('.SILENT');
    const mode = op.replace('.SILENT', '');
    const flagMap = { '\\SEEN': 'is_read', '\\FLAGGED': 'is_starred', '\\ANSWERED': 'is_answered', '\\DELETED': 'imap_deleted', '\\DRAFT': 'is_draft' };
    const allCols = Object.values(flagMap);

    for (const seq of seqs) {
      const row = msgs[seq - 1];
      const m = q.get('SELECT * FROM messages WHERE id = ?', row.id);
      if (!m) continue;
      if (mode === 'FLAGS') {
        // 整体替换：未列出的标志清零
        const listed = new Set(flagTokens.map(f => flagMap[f.toUpperCase()]).filter(Boolean));
        for (const col of allCols) {
          q.run(`UPDATE messages SET ${col} = ? WHERE id = ?`, listed.has(col) ? 1 : 0, m.id);
        }
      } else if (mode === '+FLAGS') {
        for (const f of flagTokens) {
          const col = flagMap[f.toUpperCase()];
          if (col) q.run(`UPDATE messages SET ${col} = 1 WHERE id = ?`, m.id);
        }
      } else if (mode === '-FLAGS') {
        for (const f of flagTokens) {
          const col = flagMap[f.toUpperCase()];
          if (col) q.run(`UPDATE messages SET ${col} = 0 WHERE id = ?`, m.id);
        }
      }
      if (!silent) {
        const m2 = q.get('SELECT * FROM messages WHERE id = ?', m.id);
        this.write(`* ${seq} FETCH (FLAGS (${flagsOf(m2)}) UID ${m2.uid})`);
      }
    }
    ok('STORE completed');
  }

  cmdSearch(tag, tokens, ok, no, byUid) {
    if (!this.selected) return no('No mailbox selected');
    const msgs = this.orderedMessages(this.selected.folderId);
    const rows = msgs.map((r, idx) => ({ seq: idx + 1, ...q.get('SELECT * FROM messages WHERE id = ?', r.id) })).filter(m => m.id);
    const matched = searchFilter(rows, tokens.slice(0), byUid);
    this.write(`* SEARCH ${matched.join(' ')}`.trimEnd());
    ok('SEARCH completed');
  }

  cmdCopy(tag, tokens, ok, no, byUid, isMove) {
    if (!this.selected) return no('No mailbox selected');
    const set = tokens[0]?.value;
    const dest = this.resolveMailbox(tokens[1]?.value ?? '');
    if (!dest) return no('Target mailbox does not exist');
    const msgs = this.orderedMessages(this.selected.folderId);
    const seqs = parseSeqSet(set, msgs.length);
    const copyCols = ['user_id', 'thread_id', 'message_id', 'in_reply_to', 'refs', 'from_name', 'from_addr',
      'to_addrs', 'cc_addrs', 'bcc_addrs', 'reply_to', 'subject', 'snippet', 'body_text', 'body_html',
      'raw_eml', 'size', 'is_read', 'is_starred', 'is_answered', 'is_forwarded', 'is_draft',
      'has_attachments', 'spam_score', 'auth_results', 'delivered_at'];
    for (const seq of seqs) {
      const row = msgs[seq - 1];
      const m = q.get('SELECT * FROM messages WHERE id = ?', row.id);
      if (!m) continue;
      if (isMove) {
        const uid = nextUid(dest.id);
        q.run('UPDATE messages SET folder_id = ?, uid = ?, imap_deleted = 0 WHERE id = ?', dest.id, uid, m.id);
      } else {
        const uid = nextUid(dest.id);
        const cols = [...copyCols, 'folder_id', 'uid'];
        const vals = copyCols.map(c => m[c]);
        q.run(`INSERT INTO messages(${cols.join(',')}) VALUES(${cols.map(() => '?').join(',')})`,
          ...vals, dest.id, uid);
      }
    }
    ok(isMove ? 'MOVE completed' : 'COPY completed');
  }

  cmdExpunge(tag, ok) {
    if (!this.selected) return no('No mailbox selected');
    const msgs = this.orderedMessages(this.selected.folderId).map((r, i) => ({ seq: i + 1, id: r.id }));
    const toDelete = q.all('SELECT id FROM messages WHERE user_id = ? AND folder_id = ? AND imap_deleted = 1', this.user.id, this.selected.folderId);
    const delIds = new Set(toDelete.map(d => d.id));
    for (const m of [...msgs].reverse()) {
      if (delIds.has(m.id)) this.write(`* ${m.seq} EXPUNGE`);
    }
    q.run('DELETE FROM messages WHERE user_id = ? AND folder_id = ? AND imap_deleted = 1', this.user.id, this.selected.folderId);
    ok('EXPUNGE completed');
  }

  // ---------------- socket ----------------
  onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (;;) {
      const extracted = tryExtractCommand(this.buffer);
      if (!extracted) break;
      this.buffer = this.buffer.slice(extracted.consumed);
      const first = extracted.tokens[0];
      if (this.idling || this.awaitContinuation) {
        const cont = this.awaitContinuation;
        this.awaitContinuation = null;
        cont(extracted.tokens.map(t => t.value).join(' '));
        continue;
      }
      this.handle(extracted.tokens).catch(e => console.error('[imap]', e));
    }
  }
}

function searchFilter(rows, tokens, byUid) {
  // 简易 AND 搜索；支持 FLAG/UNFLAG、FROM/TO/SUBJECT/BODY/TEXT/HEADER、SINCE/BEFORE/ON、UID/序号集合、NOT/OR
  const out = [];
  const matchStr = (m, field, val) => {
    const v = String(val || '').toLowerCase();
    const map = {
      from: m.from_addr + ' ' + m.from_name, to: m.to_addrs, cc: m.cc_addrs, bcc: m.bcc_addrs,
      subject: m.subject, body: m.body_text, text: m.subject + ' ' + m.body_text + ' ' + m.from_addr,
    };
    return String(map[field] || '').toLowerCase().includes(v);
  };
  const flagTest = (m, f, want) => {
    const has = {
      seen: !!m.is_read, flagged: !!m.is_starred, answered: !!m.is_answered,
      deleted: !!m.imap_deleted, draft: !!m.is_draft,
    }[f.replace('\\', '').toLowerCase()];
    return want ? has : !has;
  };
  const dateTest = (m, kind, ds) => {
    const d = new Date(ds);
    if (isNaN(d)) return true;
    const md = new Date(m.delivered_at);
    const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    if (kind === 'SINCE') return day(md) >= day(d);
    if (kind === 'BEFORE') return day(md) < day(d);
    return day(md) === day(d);
  };

  // 平铺 tokens 为字符串列表（简化处理）
  const args = tokens.map(t => (t.type === 'paren' ? (t.value === '(' ? '(' : ')') : String(t.value)));

  const evalOne = (m) => {
    let result = true;
    let i = 0;
    while (i < args.length && result) {
      const kw = args[i].toUpperCase();
      switch (kw) {
        case 'ALL': i++; break;
        case 'ANSWERED': result = flagTest(m, 'answered', true); i++; break;
        case 'UNANSWERED': result = flagTest(m, 'answered', false); i++; break;
        case 'DELETED': result = flagTest(m, 'deleted', true); i++; break;
        case 'UNDELETED': result = flagTest(m, 'deleted', false); i++; break;
        case 'DRAFT': result = flagTest(m, 'draft', true); i++; break;
        case 'FLAGGED': result = flagTest(m, 'flagged', true); i++; break;
        case 'UNFLAGGED': result = flagTest(m, 'flagged', false); i++; break;
        case 'SEEN': result = flagTest(m, 'seen', true); i++; break;
        case 'UNSEEN': result = flagTest(m, 'seen', false); i++; break;
        case 'RECENT': i++; break; // 不跟踪 recent，全部匹配
        case 'FROM': result = matchStr(m, 'from', args[i + 1]); i += 2; break;
        case 'TO': result = matchStr(m, 'to', args[i + 1]); i += 2; break;
        case 'CC': result = matchStr(m, 'cc', args[i + 1]); i += 2; break;
        case 'BCC': result = matchStr(m, 'bcc', args[i + 1]); i += 2; break;
        case 'SUBJECT': result = matchStr(m, 'subject', args[i + 1]); i += 2; break;
        case 'BODY': result = matchStr(m, 'body', args[i + 1]); i += 2; break;
        case 'TEXT': result = matchStr(m, 'text', args[i + 1]); i += 2; break;
        case 'HEADER': result = String(m.message_id || '').toLowerCase().includes(String(args[i + 2] || '').toLowerCase()); i += 3; break;
        case 'SINCE': result = dateTest(m, 'SINCE', args[i + 1]); i += 2; break;
        case 'BEFORE': result = dateTest(m, 'BEFORE', args[i + 1]); i += 2; break;
        case 'ON': result = dateTest(m, 'ON', args[i + 1]); i += 2; break;
        case 'LARGER': result = m.size > parseInt(args[i + 1]); i += 2; break;
        case 'SMALLER': result = m.size < parseInt(args[i + 1]); i += 2; break;
        case 'NOT': {
          // 简化：NOT <key> <val>
          const subKw = (args[i + 1] || '').toUpperCase();
          const isMatch = evalSimple(m, subKw, args[i + 2]);
          result = !isMatch;
          i += 3; break;
        }
        case 'OR': {
          const k1 = (args[i + 1] || '').toUpperCase();
          const k2 = (args[i + 2] || '').toUpperCase();
          result = evalSimple(m, k1, args[i + 3]) || evalSimple(m, k2, args[i + 4]);
          i += 5; break;
        }
        case 'UID': {
          const setStr = args[i + 1] || '';
          const uids = parseSeqSet(setStr, rows.length ? Math.max(...rows.map(r => r.uid)) : 0);
          result = uids.includes(m.uid);
          i += 2; break;
        }
        case '(': case ')': i++; break;
        default:
          if (/^[\d:,*]+$/.test(args[i])) {
            const seqs = parseSeqSet(args[i], rows.length);
            result = seqs.includes(m.seq);
            i++;
          } else i++;
      }
    }
    return result;
  };
  const evalSimple = (m, kw, val) => {
    switch (kw) {
      case 'FROM': return matchStr(m, 'from', val);
      case 'TO': return matchStr(m, 'to', val);
      case 'SUBJECT': return matchStr(m, 'subject', val);
      case 'SEEN': return flagTest(m, 'seen', true);
      case 'UNSEEN': return flagTest(m, 'seen', false);
      case 'FLAGGED': return flagTest(m, 'flagged', true);
      case 'ANSWERED': return flagTest(m, 'answered', true);
      default: return true;
    }
  };

  for (const m of rows) {
    if (evalOne(m)) out.push(byUid ? m.uid : m.seq);
  }
  return out;
}

function bodyStructureOf(m) {
  if (m.body_html && m.body_text) {
    return `(("TEXT" "PLAIN" ("CHARSET" "UTF-8") NIL NIL "7BIT" ${Buffer.byteLength(m.body_text || '')} 0)("TEXT" "HTML" ("CHARSET" "UTF-8") NIL NIL "8BIT" ${Buffer.byteLength(m.body_html || '')} 0) "ALTERNATIVE" ("BOUNDARY" "openmail-bnd") NIL NIL NIL)`;
  }
  if (m.body_html) {
    return `("TEXT" "HTML" ("CHARSET" "UTF-8") NIL NIL "8BIT" ${Buffer.byteLength(m.body_html)} 0)`;
  }
  return `("TEXT" "PLAIN" ("CHARSET" "UTF-8") NIL NIL "7BIT" ${Buffer.byteLength(m.body_text || '')} 0)`;
}

function buildEmlFromRow(m) {
  const lines = [
    `From: ${m.from_name ? `"${m.from_name}" ` : ''}<${m.from_addr}>`,
    `To: ${m.to_addrs}`,
    m.cc_addrs ? `Cc: ${m.cc_addrs}` : null,
    `Subject: ${m.subject}`,
    `Date: ${new Date(m.delivered_at).toUTCString()}`,
    `Message-ID: ${m.message_id || `<om-${m.id}@openmail>`}`,
    `MIME-Version: 1.0`,
    `Content-Type: text/plain; charset=UTF-8`,
    '',
    m.body_text || '',
  ];
  return lines.filter(l => l !== null).join('\r\n');
}

export function startImapServer() {
  const tlsCtx = getTLSContext();

  const connHandler = (socket) => {
    const session = new ImapSession(socket);
    session.write(`* OK [CAPABILITY ${CAPABILITIES.join(' ')}${tlsCtx ? ' STARTTLS' : ''}${' AUTH=PLAIN'}] OpenMail IMAP ready`);
    socket.on('data', (d) => session.onData(d));
    socket.on('error', () => {});
    const listener = (evt) => session.notifyStore(evt.userId, evt.folderId);
    mailEvents.on('stored', listener);
    socket.on('close', () => mailEvents.off('stored', listener));
  };

  const plain = net.createServer(connHandler);
  plain.listen(config.imapPort, () => console.log(`[imap] 端口 :${config.imapPort} (生产 143)`));

  if (tlsCtx) {
    const tlsServer = tls.createServer({ key: tlsCtx.key, cert: tlsCtx.cert }, connHandler);
    tlsServer.listen(config.imapsPort, () => console.log(`[imap] IMAPS 端口 :${config.imapsPort} (生产 993)`));
  }
}
