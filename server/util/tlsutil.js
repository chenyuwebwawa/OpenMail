// TLS 证书：优先使用环境变量指定证书，否则首次启动自动生成自签名证书（开发/内网用）
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { config, ensureDirs } from '../config.js';

const require = createRequire(import.meta.url);

let ctxCache = null;

export function getTLSContext() {
  if (ctxCache) return ctxCache;
  ensureDirs();
  if (config.tlsCert && config.tlsKey) {
    ctxCache = {
      cert: fs.readFileSync(config.tlsCert),
      key: fs.readFileSync(config.tlsKey),
      generated: false,
    };
    console.log('[tls] 使用外部证书');
    return ctxCache;
  }
  const certPath = path.join(config.dataDir, 'tls-cert.pem');
  const keyPath = path.join(config.dataDir, 'tls-key.pem');
  if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
    ctxCache = { cert: fs.readFileSync(certPath), key: fs.readFileSync(keyPath), generated: true };
    return ctxCache;
  }
  try {
    const selfsigned = require('selfsigned');
    const pems = selfsigned.generate([{ name: 'commonName', value: 'openmail.local' }], {
      days: 3650, keySize: 2048, extensions: [
        { name: 'subjectAltName', altNames: [{ type: 2, value: 'localhost' }, { type: 7, ip: '127.0.0.1' }] },
      ],
    });
    fs.writeFileSync(certPath, pems.cert);
    fs.writeFileSync(keyPath, pems.private);
    ctxCache = { cert: pems.cert, key: pems.private, generated: true };
    console.log("[tls] 已生成自签名证书（生产环境请配置 Let's Encrypt 证书到 OM_TLS_CERT / OM_TLS_KEY）");
    return ctxCache;
  } catch (e) {
    console.warn('[tls] 生成自签名证书失败，TLS 服务将不可用:', e.message);
    return null;
  }
}
