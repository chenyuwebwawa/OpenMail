// 登录 / 注册 / 忘记密码 / 重置 / 2FA（i18n 已接入）
import { API, icon, logoSvg, toast, CREDIT_HTML } from '../api.js';
import { t } from '../i18n.js';
import { render as renderApp } from '../app.js';

export async function render(root, route, params) {
  const views = { login: vLogin, register: vRegister, forgot: vForgot, reset: vReset };
  root.innerHTML = `<div class="auth-page">${brandPane()}<div class="auth-right"><div class="auth-card" id="auth-card"></div></div></div><div class="auth-credit">${CREDIT_HTML}</div>`;
  const card = document.getElementById('auth-card');
  (views[route] || vLogin)(card, params);
}

function brandPane() {
  return `
    <div class="auth-left">
      <div class="auth-brand">${logoSvg(52)} OpenMail</div>
      <p class="lead">${t('login.brand_line')}</p>
      <div class="auth-feats">
        <div>${icon('check')} ${t('login.feat1')}</div>
        <div>${icon('check')} ${t('login.feat2')}</div>
        <div>${icon('check')} ${t('login.feat3')}</div>
        <div>${icon('check')} ${t('login.feat4')}</div>
        <div>${icon('check')} ${t('login.feat5')}</div>
      </div>
    </div>`;
}

function vLogin(card) {
  card.innerHTML = `
    <div class="auth-logo">${logoSvg(30)}<button class="btn btn-ghost btn-icon" id="theme-btn" title="${t('login.theme')}">${icon('sun')}</button></div>
    <h2>${t('login.welcome')}</h2>
    <div class="sub">${t('login.sub')}</div>
    <form id="f">
      <div class="field"><label>${t('login.address')}</label><input class="input" name="address" placeholder="${t('login.address_ph')}" autofocus required></div>
      <div class="field"><label>${t('login.password')}</label><input class="input" type="password" name="password" placeholder="••••••••" required></div>
      <button class="btn btn-primary" style="width:100%;padding:11px" type="submit">${t('login.signin')}</button>
    </form>
    <div class="auth-foot">
      <a href="#/forgot">${t('login.forgot')}</a> · <a href="#/register">${t('login.register')}</a>
    </div>`;
  card.querySelector('#theme-btn').addEventListener('click', () => {
    import('../api.js').then(({ toggleTheme }) => toggleTheme());
  });
  card.querySelector('#f').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const btn = e.target.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      const r = await API.post('/auth/login', { address: fd.get('address'), password: fd.get('password') });
      if (r.need2fa) return v2fa(card, r.ticket);
      API.setAuth(r.token, r.user);
      toast(t('nav.mail'), 'ok');
      location.hash = '#/mail';
    } catch (err) { toast(err.message, 'err'); btn.disabled = false; }
  });
}

function v2fa(card, ticket) {
  card.innerHTML = `
    <div class="auth-logo">${logoSvg(30)}</div>
    <h2>${t('twofa.title')}</h2>
    <div class="sub">${t('twofa.sub')}</div>
    <form id="f">
      <div class="field"><input class="input" name="code" placeholder="000000" inputmode="numeric" maxlength="6"
        style="text-align:center;font-size:22px;letter-spacing:8px;font-family:ui-monospace,monospace" autofocus></div>
      <button class="btn btn-primary" style="width:100%;padding:11px" type="submit">${t('twofa.verify')}</button>
      <button class="btn btn-ghost" style="width:100%;margin-top:9px" type="button" id="back">${t('login.back')}</button>
    </form>`;
  card.querySelector('#back').addEventListener('click', () => vLogin(card));
  card.querySelector('#f').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const r = await API.post('/auth/login/2fa', { ticket, code: new FormData(e.target).get('code') });
      API.setAuth(r.token, r.user);
      toast(t('compose.sent'), 'ok');
      location.hash = '#/mail';
    } catch (err) { toast(err.message, 'err'); }
  });
}

function vRegister(card) {
  card.innerHTML = `
    <div class="auth-logo">${logoSvg(30)}<a class="btn btn-ghost btn-sm" href="#/login">${t('login.signin')}</a></div>
    <h2>${t('register.title')}</h2>
    <div class="sub">${t('register.sub')}</div>
    <form id="f">
      <div class="field"><label>${t('login.address')}</label>
        <input class="input" name="address" placeholder="${t('login.address_ph')}" required>
        <div style="font-size:11.5px;color:var(--text-3);margin-top:5px">${t('register.domain_hint')}</div>
      </div>
      <div class="field"><label>${t('register.display')}</label><input class="input" name="displayName"></div>
      <div class="field"><label>${t('register.password')}</label><input class="input" type="password" name="password" required minlength="6"></div>
      <button class="btn btn-primary" style="width:100%;padding:11px" type="submit">${t('register.create')}</button>
    </form>
    <div class="auth-foot">${t('register.have')}<a href="#/login">${t('login.signin')}</a></div>`;
  card.querySelector('#f').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      const r = await API.post('/auth/register', Object.fromEntries(fd));
      API.setAuth(r.token, r.user);
      toast(t('register.create'), 'ok');
      location.hash = '#/mail';
    } catch (err) { toast(err.message, 'err'); }
  });
}

function vForgot(card) {
  card.innerHTML = `
    <div class="auth-logo">${logoSvg(30)}<a class="btn btn-ghost btn-sm" href="#/login">${t('login.signin')}</a></div>
    <h2>${t('forgot.title')}</h2>
    <div class="sub">${t('forgot.sub')}</div>
    <form id="f">
      <div class="field"><input class="input" name="address" placeholder="${t('login.address_ph')}" required></div>
      <button class="btn btn-primary" style="width:100%;padding:11px" type="submit">${t('forgot.send')}</button>
    </form>`;
  card.querySelector('#f').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const r = await API.post('/auth/forgot', { address: new FormData(e.target).get('address') });
      toast(r.message || 'OK', 'ok');
    } catch (err) { toast(err.message, 'err'); }
  });
}

function vReset(card, params) {
  const token = new URLSearchParams(params ? '?' + params : location.search).get('token') || '';
  card.innerHTML = `
    <div class="auth-logo">${logoSvg(30)}</div>
    <h2>${t('reset.title')}</h2>
    <div class="sub">${t('reset.sub')}</div>
    <form id="f">
      <div class="field"><label>${t('reset.new')}</label><input class="input" type="password" name="password" required minlength="6"></div>
      <button class="btn btn-primary" style="width:100%;padding:11px" type="submit">${t('reset.btn')}</button>
    </form>
    <div class="auth-foot"><a href="#/login">${t('login.signin')}</a></div>`;
  card.querySelector('#f').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await API.post('/auth/reset', { token, password: new FormData(e.target).get('password') });
      toast(t('profile.pwd_ok'), 'ok');
      location.hash = '#/login';
    } catch (err) { toast(err.message, 'err'); }
  });
}
