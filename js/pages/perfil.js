import { api } from '../api.js';
import { h, title, toast, formDialog } from '../ui.js';
import { icon } from '../iconos.js';
import { usuarios } from './admin.js';

const ROL = { 'Quimico farmaceutico': 'Químico farmacéutico' };
export const rolLabel = (r) => ROL[r] || r || '';
export const iniciales = (n) => String(n || '?').trim().split(/\s+/).slice(0, 2).map((p) => p[0]).join('').toUpperCase();

// Perfil del usuario que usa el sistema. Para el Administrador incluye además la gestión de usuarios (CU-11).
export async function render(el, ctx) {
  const u = ctx.user;
  el.innerHTML = title('Perfil', 'Sus datos de acceso. Los permisos dependen del perfil asignado por el administrador.') + `
  <div class="panel profileCard">
    <span class="avatar big" aria-hidden="true">${h(iniciales(u.nombres))}</span>
    <div class="profileData">
      <strong class="hd" style="font-size:22px">${h(u.nombres)}</strong>
      <span class="muted">${h(u.correo || '')}</span>
      <span><span class="badge info">${h(rolLabel(u.rol))}</span></span>
    </div>
    <div class="rowButtons">
      <button class="btn" type="button" id="pwd">${icon('llave')} Cambiar mi contraseña</button>
      <a class="btn" href="#/preferencias">${icon('preferencias')} Preferencias</a>
      <button class="btn danger" type="button" id="out">${icon('salir')} Cerrar sesión</button>
    </div>
  </div>
  <div id="adminUsers"></div>`;
  el.querySelector('#pwd').addEventListener('click', () => formDialog({ title: 'Cambiar mi contraseña', submitLabel: 'Actualizar', fields: [
    { name: 'actual', label: 'Contraseña actual', type: 'password', req: true, autocomplete: 'current-password' },
    { name: 'nueva', label: 'Nueva contraseña', type: 'password', req: true, autocomplete: 'new-password', hint: 'Mínimo 10 caracteres, con mayúsculas, minúsculas y números.' }],
  onSubmit: async (v) => { await api.post('/api/auth/password', v); toast('Contraseña actualizada.'); } }));
  el.querySelector('#out').addEventListener('click', () => ctx.logout());
  // Solo el Administrador ve y edita los usuarios; el servidor vuelve a comprobar el permiso en cada petición.
  if (ctx.can('usuarios:read')) await usuarios.render(el.querySelector('#adminUsers'), ctx);
}
