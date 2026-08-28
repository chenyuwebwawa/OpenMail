// 极简 POP3 服务端（RFC 1939）：USER/PASS、STAT、LIST、RETR、DELE、UIDL、TOP、QUIT
import net from 'node:net';
import tls from 'node:tls';
import bcrypt from 'bcryptjs';
import { q, now, audit } from './db.js';
import { config } from './config.js';
import { getTLSContext } from './util/tlsutil.js';

function handleConnection(socket) {
  let buffer = '';
  let user = null;
  let pendingName = '';
  let messages = [];   // [{id, uid, size, deleted}]
  let cmdQueue = Promise.resolve();
  socket.write('+OK OpenMail POP3 ready\r\n');

  const write = (s) => { try { socket.write(s); } catch {} };

  socket.on('data', (chunk) => {
    buffer += chunk.toString('binary');
    let idx;
    while ((idx = buffer.indexOf('\r\n')) !== -1) {
      const line = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      // 串行化处理（PASS 中的 bcrypt 比较是异步的，必须保证命令顺序）
      cmdQueue = cmdQueue.then(() => processLine(line)).catch(err => {
        console.error('[pop3]', err);
        write('-ERR internal error\r\n');
      });
    }
  });

  function mailboxMessages() {
    const inbox = q.get("SELECT id FROM folders WHERE user_id = ? AND type = 'inbox'", user.id);
    if (!inbox) return [];
    return q.all('SELECT id, uid, size FROM messages WHERE user_id = ? AND folder_id = ? ORDER BY uid', user.id, inbox.id)
      .map(m => ({ ...m, deleted: false }));
  }

  async function processLine(line) {
    const [cmd, ...rest] = line.trim().split(/\s+/);
    const arg = rest.join(' ');
    const C = (cmd || '').toUpperCase();

    switch (C) {
      case 'CAPA':
        write('+OK capability list follows\r\nUIDL\r\nTOP\r\nUSER\r\nPIPELINING\r\n.\r\n');
        return;
      case 'USER':
        pendingName = arg.toLowerCase();
        user = null;
        write('+OK\r\n');
        return;
      case 'PASS': {
        const name = pendingName;
        if (!name) { write('-ERR USER first\r\n'); return; }
        const addr = name.includes('@') ? name : `${name}@${config.primaryDomain}`;
        const u = q.get('SELECT * FROM users WHERE address = ?', addr);
        if (!u || u.status === 'banned' || !(await bcrypt.compare(arg || '', u.password_hash))) {
          user = null;
          write('-ERR authentication failed\r\n');
          auditLog(null, 'pop3.login_failed', addr);
          return;
        }
        user = u;
        messages = mailboxMessages();
        write(`+OK ${user.address} maildrop locked and ready\r\n`);
        auditLog(user.id, 'pop3.login', `${user.address}`);
        return;
      }
      case 'STAT': {
        if (!requireAuth()) return;
        const alive = messages.filter(m => !m.deleted);
        write(`+OK ${alive.length} ${alive.reduce((s, m) => s + m.size, 0)}\r\n`);
        return;
      }
      case 'LIST': {
        if (!requireAuth()) return;
        if (arg) {
          const m = messages[parseInt(arg) - 1];
          write(m && !m.deleted ? `+OK ${arg} ${m.size}\r\n` : '-ERR no such message\r\n');
          return;
        }
        const alive = messages.filter(m => !m.deleted);
        let out = `+OK ${alive.length} messages\r\n`;
        alive.forEach((m, i) => { out += `${i + 1} ${m.size}\r\n`; });
        out += '.\r\n';
        write(out);
        return;
      }
      case 'UIDL': {
        if (!requireAuth()) return;
        const alive = messages.filter(m => !m.deleted);
        if (arg) {
          const m = messages[parseInt(arg) - 1];
          write(m && !m.deleted ? `+OK ${arg} om-${m.uid}\r\n` : '-ERR no such message\r\n');
          return;
        }
        let out = `+OK\r\n`;
        alive.forEach((m, i) => { out += `${i + 1} om-${m.uid}\r\n`; });
        out += '.\r\n';
        write(out);
        return;
      }
      case 'RETR': {
        if (!requireAuth()) return;
        const m = messages[parseInt(arg) - 1];
        if (!m || m.deleted) { write('-ERR no such message\r\n'); return; }
        const row = q.get('SELECT raw_eml, body_text, body_html, subject, from_addr, to_addrs, delivered_at, message_id FROM messages WHERE id = ?', m.id);
        const raw = row.raw_eml || buildMinimalEml(row);
        const buf = Buffer.from(raw, 'utf8');
        write(`+OK ${buf.length} octets\r\n`);
        // 字节填充：以 "." 开头的行需要 escape
        const escaped = raw.replace(/^\./gm, '..');
        write(escaped + '\r\n.\r\n');
        return;
      }
      case 'TOP': {
        if (!requireAuth()) return;
        const [n, k] = arg.split(/\s+/);
        const m = messages[parseInt(n) - 1];
        if (!m || m.deleted) { write('-ERR no such message\r\n'); return; }
        const row = q.get('SELECT raw_eml, body_text FROM messages WHERE id = ?', m.id);
        const raw = row.raw_eml || buildMinimalEml(row);
        const { header, body } = splitHeader(raw);
        const lines = body.split(/\r\n/).slice(0, parseInt(k) || 0);
        const escaped = (header + '\r\n' + lines.join('\r\n')).replace(/^\./gm, '..');
        write('+OK\r\n' + escaped + '\r\n.\r\n');
        return;
      }
      case 'DELE': {
        if (!requireAuth()) return;
        const m = messages[parseInt(arg) - 1];
        if (!m || m.deleted) { write('-ERR no such message\r\n'); return; }
        m.deleted = true;
        write(`+OK message ${arg} deleted\r\n`);
        return;
      }
      case 'RSET': {
        if (!requireAuth()) return;
        messages.forEach(m => { m.deleted = false; });
        write('+OK\r\n');
        return;
      }
      case 'NOOP': write('+OK\r\n'); return;
      case 'QUIT': {
        if (user?.id) {
          const inbox = q.get("SELECT id FROM folders WHERE user_id = ? AND type = 'inbox'", user.id);
          if (inbox) {
            let bytes = 0;
            for (const m of messages.filter(x => x.deleted)) {
              const row = q.get('SELECT size FROM messages WHERE id = ?', m.id);
              if (row) bytes += row.size;
            }
            if (messages.some(x => x.deleted)) {
              const ids = messages.filter(x => x.deleted).map(x => x.id);
              q.run(`DELETE FROM attachments WHERE message_id IN (${ids.map(() => '?').join(',')})`, ...ids);
              q.run(`DELETE FROM messages WHERE id IN (${ids.map(() => '?').join(',')})`, ...ids);
              q.run('UPDATE users SET used_bytes = MAX(0, used_bytes - ?) WHERE id = ?', bytes, user.id);
            }
          }
        }
        write('+OK OpenMail POP3 signing off\r\n');
        socket.end();
        return;
      }
      default: write('-ERR unknown command\r\n');
    }
  }

  function requireAuth() {
    if (!user?.id) { write('-ERR authenticate first\r\n'); return false; }
    return true;
  }

  socket.on('error', () => {});
}

function splitHeader(raw) {
  const idx = raw.indexOf('\r\n\r\n');
  if (idx === -1) return { header: raw, body: '' };
  return { header: raw.slice(0, idx), body: raw.slice(idx + 4) };
}

function buildMinimalEml(row) {
  return [
    `From: ${row.from_addr}`, `To: ${row.to_addrs}`, `Subject: ${row.subject}`,
    `Date: ${new Date(row.delivered_at).toUTCString()}`,
    `Message-ID: ${row.message_id || '<om@openmail>'}`,
    'MIME-Version: 1.0', 'Content-Type: text/plain; charset=UTF-8', '',
    row.body_text || '',
  ].join('\r\n');
}

function auditLog(userId, action, detail) {
  try { audit(userId, '', action, detail); } catch {}
}

export function startPop3Server() {
  const plain = net.createServer(handleConnection);
  plain.listen(config.pop3Port, () => console.log(`[pop3] 端口 :${config.pop3Port} (生产 110)`));

  const ctx = getTLSContext();
  if (ctx) {
    const tlsServer = tls.createServer({ key: ctx.key, cert: ctx.cert }, handleConnection);
    tlsServer.listen(config.pop3sPort, () => console.log(`[pop3] POP3S 端口 :${config.pop3sPort} (生产 995)`));
  }
}
