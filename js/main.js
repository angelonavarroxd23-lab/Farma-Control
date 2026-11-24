import { api, session, setUnauthorizedHandler } from './api.js';
import { h, toast } from './ui.js';
import * as inicio from './pages/inicio.js';
import * as venta from './pages/venta.js';
import * as ventas from './pages/ventas.js';
import * as catalogo from './pages/catalogo.js';
import * as compras from './pages/compras.js';
import * as maestros from './pages/maestros.js';
import * as inventario from './pages/inventario.js';
import * as reportes from './pages/reportes.js';
import * as admin from './pages/admin.js';
import * as reposicion from './pages/reposicion.js';
import * as preferencias from './pages/preferencias.js';
import * as perfil from './pages/perfil.js';
import { icon } from './iconos.js';

// Permisos de la interfaz: solo controlan qué se muestra. La autorización real la aplica el servidor.
const PERMS = {
  'clientes:write': ['Administrador', 'Cajero'], 'clientes:delete': ['Administrador'], 'proveedores:read': ['Administrador', 'Almacenero'], 'catalogo:write': ['Administrador', 'Almacenero'],
  'recetas:read': ['Administrador', 'Cajero', 'Quimico farmaceutico'], 'recetas:create': ['Administrador', 'Cajero', 'Quimico farmaceutico'], 'recetas:write': ['Administrador', 'Quimico farmaceutico'], 'reposicion:read': ['Administrador', 'Almacenero'],
  'ventas:read': ['Administrador', 'Cajero', 'Quimico farmaceutico'], 'ventas:create': ['Administrador', 'Cajero'], 'ventas:anular': ['Administrador'],
  'compras:read': ['Administrador', 'Almacenero'], 'movimientos:read': ['Administrador', 'Almacenero', 'Quimico farmaceutico'],
  'reportes:read': ['Administrador'], 'usuarios:read': ['Administrador'], 'auditoria:read': ['Administrador'],
};
const can = (user, p) => !PERMS[p] || PERMS[p].includes(user.rol);

const PAGES = [
  ['Operación'],
  { id: 'inicio', label: 'Resumen', icon: '▦', mod: inicio },
  { id: 'venta', label: 'Nueva venta', icon: '▣', perm: 'ventas:create', mod: venta },
  { id: 'ventas', label: 'Historial de ventas', icon: '☰', perm: 'ventas:read', mod: ventas },
  { id: 'compras', label: 'Compras', icon: '▧', perm: 'compras:read', mod: compras },
  ['Inventario'],
  { id: 'medicamentos', label: 'Medicamentos y lotes', icon: '▤', mod: catalogo },
  { id: 'alertas', label: 'Alertas', icon: '⚠', mod: inventario.alertas },
  { id: 'reposicion', label: 'Reposición', icon: '⟳', perm: 'reposicion:read', mod: reposicion },
  { id: 'movimientos', label: 'Movimientos', icon: '⇄', perm: 'movimientos:read', mod: inventario.movimientos },
  ['Gestión'],
  { id: 'clientes', label: 'Clientes', icon: '♙', mod: maestros.clientes },
  { id: 'recetas', label: 'Recetas', icon: '℞', perm: 'recetas:read', mod: maestros.recetas },
  { id: 'proveedores', label: 'Proveedores', icon: '⛟', perm: 'proveedores:read', mod: maestros.proveedores },
  ['Administración'],
  { id: 'reportes', label: 'Reportes', icon: '▥', perm: 'reportes:read', mod: reportes },
  { id: 'auditoria', label: 'Auditoría', icon: '✎', perm: 'auditoria:read', mod: admin.auditoria },
  // Accesibles desde los botones de la derecha de la barra superior (no aparecen en el riel).
  { id: 'perfil', label: 'Perfil', icon: '', mod: perfil, top: true },
  { id: 'preferencias', label: 'Preferencias', icon: '', mod: preferencias, top: true },
];

const $ = (s) => document.querySelector(s);
let user = null;
let current = null;

function renderLogin() {
  $('#app').classList.add('hidden'); const el = $('#login'); el.classList.remove('hidden');
  el.innerHTML = `<div class="loginHero"><span class="shape s1" aria-hidden="true"></span><span class="shape s2" aria-hidden="true"></span><span class="shape s3" aria-hidden="true"></span><div class="logoBar"><div class="logoMark">✚</div><span>FarmaControl</span></div><h1>Tu farmacia,<br>bajo control.</h1><p>Sistema de gestión de ventas, compras e inventario por lotes.</p><div>● Ventas por lote &nbsp; ● Alertas de vencimiento &nbsp; ● Reportes</div></div>
  <form class="loginForm" id="loginForm" novalidate><h2>Iniciar sesión</h2><p>Ingrese con la cuenta asignada a su perfil.</p><div data-error></div>
  <div class="field"><label for="correo">Correo</label><input class="input" id="correo" name="correo" type="email" autocomplete="username" required></div>
  <div class="field"><label for="contrasena">Contraseña</label><input class="input" id="contrasena" name="contrasena" type="password" autocomplete="current-password" required></div>
  <button class="btn primary" type="submit">Ingresar →</button>
</form>`;
  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target; const box = f.querySelector('[data-error]'); box.innerHTML = '';
    try {
      const r = await api.post('/api/auth/login', { correo: f.correo.value, contrasena: f.contrasena.value });
      session.token = r.token; user = r.usuario; startApp();
    } catch (err) { box.innerHTML = `<div class="formError" role="alert">${h(err.message)}</div>`; }
  });
  el.querySelector('#correo').focus();
}

function startApp() {
  $('#login').classList.add('hidden'); $('#app').classList.remove('hidden');
  $('#userName').textContent = user.nombres; $('#userRole').textContent = perfil.rolLabel(user.rol); $('#avatar').textContent = perfil.iniciales(user.nombres);
  $('#perfilBtn').setAttribute('aria-label', `Perfil de ${user.nombres}, ${perfil.rolLabel(user.rol)}`);
  const nav = PAGES.map((p) => {
    if (Array.isArray(p)) return `<div class="navGroup">${h(p[0])}</div>`;
    if (p.top || (p.perm && !can(user, p.perm))) return '';
    return `<a class="nav" href="#/${p.id}" data-page="${p.id}" aria-label="${h(p.label)}"><span class="icobox">${icon(p.id)}</span><span class="nlabel" aria-hidden="true">${h(p.label)}</span></a>`;
  }).join('').replace(/<div class="navGroup">[^<]*<\/div>(?=<div class="navGroup">|$)/g, '');
  $('#sidebar').innerHTML = `<a class="logoBar" href="#/inicio" aria-label="FarmaControl: ir al Resumen" title="Ir al Resumen"><div class="logoMark">✚</div><span>FarmaControl</span></a>${nav}<div class="sideNote"><span class="dotState" id="driverDot" role="img" aria-label="Verificando conexión" title="Verificando conexión…"></span><span class="muted" style="font-size:11px">v2.2</span></div>`;
  api.get('/api/health').then((x) => { const n = document.getElementById('driverDot'); if (!n) return; const t = x.driver === 'mssql' ? 'Datos en SQL Server mediante API REST' : 'Modo demostración: datos en memoria (sin SQL Server)'; n.classList.add(x.driver === 'mssql' ? 'ok' : 'mem'); n.title = t; n.setAttribute('aria-label', t); }).catch(() => {});
  route();
}

async function route() {
  if (!user) return;
  const id = (location.hash.replace(/^#\//, '') || 'inicio').split('?')[0];
  let page = PAGES.find((p) => !Array.isArray(p) && p.id === id && (!p.perm || can(user, p.perm)));
  if (!page) { page = PAGES.find((p) => p.id === 'inicio'); if (id !== 'inicio') location.hash = '#/inicio'; }
  document.querySelectorAll('.nav[data-page]').forEach((a) => a.classList.toggle('active', a.dataset.page === page.id));
  $('#perfilBtn').classList.toggle('active', page.id === 'perfil'); $('#prefBtn').classList.toggle('active', page.id === 'preferencias');
  $('#topTitle').textContent = page.label; $('#topIcon').innerHTML = icon(page.id); $('#sidebar').classList.remove('open');
  const content = $('#content'); const token = (current = Symbol());
  content.innerHTML = ''; const host = document.createElement('div'); host.innerHTML = '<p class="muted">Cargando…</p>'; content.appendChild(host); // contenedor nuevo: evita acumular listeners
  try { await page.mod.render(host, { user, can: (p) => can(user, p), go: (hash) => { location.hash = hash; }, isCurrent: () => current === token, logout: () => logout(false) }); }
  catch (e) { if (current === token) host.innerHTML = `<div class="notice warning" role="alert">${h(e.message)}</div>`; }
  content.focus({ preventScroll: true });
}

function logout(silent) {
  if (user && !silent) api.post('/api/auth/logout', {}).catch(() => {});
  session.token = null; user = null; current = null; renderLogin();
}


setUnauthorizedHandler(() => { if (user) { toast('Su sesión expiró. Inicie sesión nuevamente.', 'error'); logout(true); } });
window.addEventListener('hashchange', route);
$('#logoutBtn').addEventListener('click', () => logout(false));
$('#logoutBtn').innerHTML = `<span class="topIco">${icon('salir')}</span><span class="topTxt"><b>Salir</b></span>`; $('#prefIco').innerHTML = icon('preferencias');
function paintThemeBtn() { const t = window.FCPrefs.leer().tema; $('#themeBtn').innerHTML = `<span class="topIco">${icon(t === 'oscuro' ? 'sol' : 'luna')}</span><span class="topTxt"><b>${t === 'oscuro' ? 'Claro' : 'Oscuro'}</b></span>`; $('#themeBtn').setAttribute('aria-label', t === 'oscuro' ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro'); }
$('#themeBtn').addEventListener('click', () => { window.FCPrefs.alternarTema(); paintThemeBtn(); if ((location.hash || '').includes('preferencias')) route(); });
window.addEventListener('fc:tema', paintThemeBtn);
paintThemeBtn();
$('#menuBtn').addEventListener('click', () => $('#sidebar').classList.toggle('open'));

(async function boot() {
  if (!session.token) return renderLogin();
  try { user = await api.get('/api/auth/me'); startApp(); } catch { session.token = null; renderLogin(); }
})();
