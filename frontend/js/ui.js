// Utilidades de interfaz: escape HTML, formatos, toasts, modales y formularios.
export const h = (s) => String(s ?? '').replace(/[&<>"']/g, (x) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[x]));
export const money = (n) => 'S/ ' + Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const fdate = (s) => (s ? String(s).slice(0, 10).split('-').reverse().join('/') : '');
export const fdt = (s) => (s ? `${fdate(s)} ${String(s).slice(11, 16)}` : '');
export const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
export const title = (t, s) => `<h2>${h(t)}</h2><p class="sub">${h(s)}</p>`;

let toastTimer;
export function toast(msg, kind = 'ok') {
  const el = document.getElementById('toast');
  el.textContent = msg; el.className = `show ${kind === 'error' ? 'error' : ''}`;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.className = ''; }, kind === 'error' ? 7000 : 4000);
}

export const ALERTA = {
  VENCIDO: ['Vencido', 'error'], AGOTADO: ['Agotado', 'error'], POR_VENCER: ['Por vencer', 'alert'], STOCK_BAJO: ['Stock bajo', 'alert'],
};
export const estadoLote = (l) => (l.alerta ? `<span class="badge ${ALERTA[l.alerta][1]}">${ALERTA[l.alerta][0]}</span>` : '<span class="badge">Disponible</span>');
export const badge = (txt, kind = '') => `<span class="badge ${kind}">${h(txt)}</span>`;

export function table(cols, rows, empty = 'Sin registros.') {
  if (!rows.length) return `<p class="empty">${h(empty)}</p>`;
  return `<div class="tableWrap"><table><thead><tr>${cols.map((c) => `<th class="${c.num ? 'num' : ''}">${h(c.label)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${cols.map((c) => `<td class="${c.num ? 'num' : ''}">${c.html ? c.html(r) : h(c.val ? c.val(r) : r[c.key])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

// Modal accesible. Devuelve { el, close }. Cierra con Esc o clic fuera.
export function modal({ title: t, body, footer = '', wide = false, onClose }) {
  const root = document.getElementById('modalRoot');
  const ov = document.createElement('div'); ov.className = 'overlay';
  ov.innerHTML = `<div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-label="${h(t)}"><header><h3>${h(t)}</h3><button class="btn small" data-close aria-label="Cerrar">✕</button></header><div class="mbody">${body}</div>${footer ? `<footer>${footer}</footer>` : ''}</div>`;
  root.appendChild(ov);
  const prev = document.activeElement;
  const close = () => { ov.remove(); document.removeEventListener('keydown', esc); prev?.focus?.(); onClose?.(); };
  const esc = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', esc);
  ov.addEventListener('mousedown', (e) => { if (e.target === ov) close(); });
  ov.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', close));
  ov.querySelector('input,select,textarea,button:not([data-close])')?.focus();
  return { el: ov, close };
}

// Formularios declarativos. f: {name,label,type,req,options,hint,max,min,step,value,rows}
export function fieldHtml(f, v = {}) {
  const val = v[f.name] ?? f.value ?? '';
  const id = `f_${f.name}`;
  const common = `id="${id}" name="${f.name}" ${f.req ? 'required' : ''} ${f.max ? `maxlength="${f.max}"` : ''} ${f.disabled ? 'disabled' : ''}`;
  let ctl;
  if (f.type === 'select') ctl = `<select class="input" ${common}>${f.placeholder ? `<option value="">${h(f.placeholder)}</option>` : ''}${f.options.map((o) => `<option value="${h(o.value)}" ${String(o.value) === String(val) ? 'selected' : ''}>${h(o.label)}</option>`).join('')}</select>`;
  else if (f.type === 'checkbox') return `<div class="field"><label class="check"><input type="checkbox" id="${id}" name="${f.name}" ${val === true || val === 'true' ? 'checked' : ''}> ${h(f.label)}</label>${f.hint ? `<span class="hint">${h(f.hint)}</span>` : ''}</div>`;
  else if (f.type === 'textarea') ctl = `<textarea class="input" rows="${f.rows || 3}" ${common}>${h(val)}</textarea>`;
  else ctl = `<input class="input" type="${f.type || 'text'}" ${common} value="${h(val)}" ${f.min !== undefined ? `min="${f.min}"` : ''} ${f.step ? `step="${f.step}"` : ''} ${f.autocomplete ? `autocomplete="${f.autocomplete}"` : ''}>`;
  return `<div class="field"><label for="${id}">${h(f.label)}${f.req ? ' *' : ''}</label>${ctl}${f.hint ? `<span class="hint">${h(f.hint)}</span>` : ''}</div>`;
}
export const formHtml = (fields, v) => `<div data-error></div>${fields.map((f) => fieldHtml(f, v)).join('')}`;
export function readForm(root, fields) {
  const out = {};
  for (const f of fields) {
    const el = root.querySelector(`[name="${f.name}"]`); if (!el || f.disabled) continue;
    out[f.name] = f.type === 'checkbox' ? el.checked : (f.type === 'number' && el.value !== '' ? Number(el.value) : el.value);
  }
  return out;
}
export function showError(root, e) {
  const box = root.querySelector('[data-error]'); if (!box) return toast(e.message, 'error');
  const list = (e.details || []).map((d) => `<li>${h(d)}</li>`).join('');
  box.innerHTML = `<div class="formError" role="alert">${h(e.message)}${list ? `<ul>${list}</ul>` : ''}</div>`;
}

// Diálogo de formulario: abre un modal, valida en servidor mediante onSubmit y se cierra si tiene éxito.
export function formDialog({ title: t, fields, values = {}, submitLabel = 'Guardar', onSubmit, wide }) {
  const m = modal({ title: t, wide, body: `<form novalidate>${formHtml(fields, values)}</form>`,
    footer: `<button class="btn" data-close type="button">Cancelar</button><button class="btn primary" data-submit type="button">${h(submitLabel)}</button>` });
  const form = m.el.querySelector('form'); const btn = m.el.querySelector('[data-submit]');
  const go = async () => {
    btn.disabled = true;
    try { await onSubmit(readForm(form, fields)); m.close(); }
    catch (e) { showError(form, e); } finally { btn.disabled = false; }
  };
  btn.addEventListener('click', go);
  form.addEventListener('submit', (e) => { e.preventDefault(); go(); });
  return m;
}
export function confirmDialog({ title: t, message, confirmLabel = 'Aceptar', danger = false, onConfirm }) {
  const m = modal({ title: t, body: `<p>${h(message)}</p><div data-error></div>`, footer: `<button class="btn" data-close>Cancelar</button><button class="btn ${danger ? 'danger' : 'primary'}" data-ok>${h(confirmLabel)}</button>` });
  m.el.querySelector('[data-ok]').addEventListener('click', async () => { try { await onConfirm(); m.close(); } catch (e) { showError(m.el, e); } });
  return m;
}

export function debounce(fn, ms = 250) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
export function download(rows, name) { /* reservado */ }
