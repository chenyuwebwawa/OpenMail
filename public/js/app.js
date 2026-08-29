// OpenMail SPA 路由 + 应用框架（i18n 已接入）
import { API, icon, logoSvg, initTheme, toggleTheme, avatarHtml, esc, toast, CREDIT_HTML } from './api.js';
import { t, init as i18nInit } from './i18n.js';
import * as login from './views/login.js';
import * as mail from './views/mail.js';
import * as contacts from './views/contacts.js';
import * as settings from './views/settings.js';
import * as admin from './views/admin.js';

initTheme();

const app = document.getElementById('app');

const routes = {
  'login': { view: login, public: true },
  'register': { view: login, public: true },
  'forgot': { view: login, public: true },
  'reset': { view: login, public: true },
  'mail': { view: mail },
  'contacts': { view: contacts },
  'settings': { view: settings },
  'admin': { view: admin },
};

function parseHash() {
  const h = location.hash.replace(/^#\/?/, '') || 'mail';
  const [route, ...rest] = h.split('/');
  return { route: route || 'mail', params: rest.join('/') };
}

export function navigate(hash) { location.hash = hash; }

export async function render() {
  await i18nInit();
  const { route, params } = parseHash();
  const def = routes[route] || routes.mail;

  // 未登录 → 登录页；已登录访问登录页 → 跳 mail
  if (!def.public && !API.token) { location.hash = '#/login'; return; }
  if (def.public && API.token && ['login', 'register'].includes(route)) { location.hash = '#/mail'; return; }

  if (def.public) {
    app.innerHTML = '';
    await def.view.render(app, route, params);
    return;
  }

  // 应用框架
  app.innerHTML = `
    <div class="app-shell">
      <nav class="app-nav">
        <div class="nav-logo">${logoSvg(27)} OpenMail</div>
        <div class="nav-items">
          <button class="nav-item" data-nav="mail">${icon('mail')}<span>${t('nav.mail')}</span></button>
          <button class="nav-item" data-nav="contacts">${icon('users')}<span>${t('nav.contacts')}</span></button>
          ${API.user?.role === 'admin' ? `<button class="nav-item" data-nav="admin">${icon('chart')}<span>${t('nav.admin')}</span></button>` : ''}
          <button class="nav-item" data-nav="settings">${icon('gear')}<span>${t('nav.settings')}</span></button>
        </div>
        <div class="nav-foot">
          <div class="nav-user">
            ${avatarHtml(API.user?.displayName || API.user?.address, 'avatar-sm')}
            <div class="meta">
              <div class="name">${esc(API.user?.displayName || '')}</div>
              <div class="addr">${esc(API.user?.address || '')}</div>
            </div>
          </div>
          <button class="nav-item" data-theme-toggle>${icon('sun')}<span>${t('nav.theme')}</span></button>
          <button class="nav-item" data-logout>${icon('logout')}<span>${t('nav.logout')}</span></button>
          ${CREDIT_HTML}
        </div>
      </nav>
      <main class="app-main" id="main"></main>
      <nav class="app-tabbar">
        <button data-nav="mail" class="${route === 'mail' ? 'active' : ''}">${icon('mail')}<span>${t('nav.mail')}</span></button>
        <button data-nav="contacts" class="${route === 'contacts' ? 'active' : ''}">${icon('users')}<span>${t('nav.contacts')}</span></button>
        ${API.user?.role === 'admin' ? `<button data-nav="admin" class="${route === 'admin' ? 'active' : ''}">${icon('chart')}<span>${t('nav.admin')}</span></button>` : ''}
        <button data-nav="settings" class="${route === 'settings' ? 'active' : ''}">${icon('gear')}<span>${t('nav.settings')}</span></button>
      </nav>
    </div>`;

  app.querySelectorAll('[data-nav]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.nav === route);
    btn.addEventListener('click', () => { location.hash = '#/' + btn.dataset.nav; });
  });
  app.querySelector('[data-theme-toggle]').addEventListener('click', toggleTheme);
  app.querySelector('[data-logout]').addEventListener('click', async () => {
    API.logout();
    toast(t('nav.logout'), 'ok');
    location.hash = '#/login';
  });

  const main = document.getElementById('main');
  try {
    await def.view.render(main, route, params);
  } catch (e) {
    main.innerHTML = `<div class="empty-state">${icon('alert')}<div>${esc(e.message)}</div></div>`;
  }
}

window.addEventListener('hashchange', render);
render();

// 全局：未捕获 Promise 错误提示
window.addEventListener('unhandledrejection', (e) => {
  if (e.reason && e.reason.message && !String(e.reason.message).includes('Failed to fetch')) {
    console.error(e.reason);
  }
});
