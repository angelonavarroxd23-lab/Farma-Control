// Cliente de la API REST. El token se guarda solo en sessionStorage (se borra al cerrar la pestaña).
// El navegador nunca conoce credenciales de base de datos: solo habla con el backend.
const BASE = (window.FARMACONTROL_API || '');
const KEY = 'fc_token';
let onUnauthorized = () => {};

export const session = {
  get token() { try { return sessionStorage.getItem(KEY); } catch { return null; } },
  set token(v) { try { v ? sessionStorage.setItem(KEY, v) : sessionStorage.removeItem(KEY); } catch { /* sin almacenamiento */ } },
};
export const setUnauthorizedHandler = (fn) => { onUnauthorized = fn; };

export class ApiError extends Error {
  constructor(status, payload) {
    super(payload?.error?.message || `Error ${status}`);
    this.status = status; this.code = payload?.error?.code; this.details = payload?.error?.details || [];
  }
}

async function request(method, path, body, { raw = false } = {}) {
  const headers = {};
  if (session.token) headers.Authorization = `Bearer ${session.token}`;
  if (method !== 'GET') headers['Content-Type'] = 'application/json';
  let res;
  try { res = await fetch(BASE + path, { method, headers, body: method === 'GET' ? undefined : JSON.stringify(body ?? {}) }); }
  catch { throw new ApiError(0, { error: { message: 'No se pudo conectar con el servidor. Verifique que el backend esté en ejecución.' } }); }
  if (raw && res.ok) return res;
  let data = null; try { data = await res.json(); } catch { /* sin cuerpo */ }
  if (!res.ok) {
    if (res.status === 401 && path !== '/api/auth/login') onUnauthorized();
    throw new ApiError(res.status, data);
  }
  return data;
}

export const api = {
  get: (p) => request('GET', p), post: (p, b) => request('POST', p, b), patch: (p, b) => request('PATCH', p, b), del: (p) => request('DELETE', p),
  async download(path, filename) {
    const res = await request('GET', path, undefined, { raw: true });
    const url = URL.createObjectURL(await res.blob());
    const a = Object.assign(document.createElement('a'), { href: url, download: filename });
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  },
};
export const qs = (o) => { const p = new URLSearchParams(); Object.entries(o).forEach(([k, v]) => { if (v !== '' && v != null) p.set(k, v); }); const s = p.toString(); return s ? `?${s}` : ''; };
