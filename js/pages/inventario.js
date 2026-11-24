import { api, qs } from '../api.js';
import { h, title, table, fdate, fdt, estadoLote, badge, toast, ALERTA } from '../ui.js';

// CU-09 Consultar alertas de stock bajo, agotados y vencimientos (calculadas con el estado real de los lotes).
export const alertas = {
  async render(el) {
    const r = await api.get('/api/alertas'); let filtro = '';
    el.innerHTML = title('Alertas de inventario', 'Se calculan en cada consulta a partir de las existencias y fechas de vencimiento de los lotes.') + `
    <div class="stats">${Object.entries(ALERTA).map(([k, [n]]) => `<button class="stat" style="text-align:left;cursor:pointer" data-f="${k}"><span class="label">${n}</span><strong>${r.conteo[k]}</strong><small>Clic para filtrar</small></button>`).join('')}</div>
    <div class="panel" style="margin-top:20px"><div class="actions"><h3 style="margin:0">Detalle por lote</h3><button class="btn small" data-f="">Quitar filtro</button></div><div id="tbl"></div>
    <p class="muted" style="font-size:12px">Reglas: <b>Vencido</b> = lote con stock y fecha pasada · <b>Agotado</b> = stock 0 · <b>Por vencer</b> = vence en 30 días o menos · <b>Stock bajo</b> = stock menor o igual al mínimo del lote.</p></div>`;
    const draw = () => { const rows = r.alertas.filter((a) => !filtro || a.alerta === filtro);
      el.querySelector('#tbl').innerHTML = table([{ label: 'Medicamento', html: (a) => `<b>${h(a.medicamento)}</b><br><span class="muted">${h(a.sku)}</span>` }, { label: 'Lote', key: 'codigo_lote' }, { label: 'Vencimiento', val: (a) => fdate(a.fecha_vencimiento) },
        { label: 'Stock', num: true, key: 'stock_actual' }, { label: 'Mínimo', num: true, key: 'stock_minimo' }, { label: 'Alerta', html: estadoLote }], rows, 'No hay alertas para el filtro seleccionado.'); };
    el.addEventListener('click', (e) => { const b = e.target.closest('[data-f]'); if (b) { filtro = b.dataset.f; draw(); } });
    draw();
  },
};

// Historial y trazabilidad de movimientos (kardex)
export const movimientos = {
  async render(el, ctx) {
    el.innerHTML = title('Movimientos de inventario', 'Cada entrada, salida y reverso conserva su operación de origen, lote y responsable.') + `
    <div class="panel"><div class="actions"><div class="filters">
      <div class="field"><label for="t">Tipo</label><select class="input" id="t"><option value="">Todos</option><option value="ENTRADA_COMPRA">Entrada por compra</option><option value="SALIDA_VENTA">Salida por venta</option><option value="REVERSO_VENTA">Reverso por anulación</option></select></div>
      <div class="field"><label for="d">Desde</label><input class="input" type="date" id="d"></div><div class="field"><label for="a">Hasta</label><input class="input" type="date" id="a"></div><button class="btn" id="go">Filtrar</button></div>
      ${ctx.can('reportes:read') ? '<button class="btn" id="csv">Exportar CSV</button>' : ''}</div><div id="tbl"></div></div>`;
    const $ = (s) => el.querySelector(s); const filt = () => ({ tipo: $('#t').value, desde: $('#d').value, hasta: $('#a').value });
    const K = { ENTRADA_COMPRA: ['Entrada', ''], SALIDA_VENTA: ['Salida', 'alert'], REVERSO_VENTA: ['Reverso', 'info'] };
    async function load() { try { const rows = await api.get('/api/movimientos' + qs({ ...filt(), limit: 300 }));
      $('#tbl').innerHTML = table([{ label: 'N.º', key: 'movimiento_id' }, { label: 'Fecha', val: (m) => fdt(m.fecha) }, { label: 'Tipo', html: (m) => badge(K[m.tipo][0], K[m.tipo][1]) }, { label: 'Medicamento', html: (m) => `<b>${h(m.medicamento)}</b><br><span class="muted">${h(m.sku)}</span>` },
        { label: 'Lote', key: 'codigo_lote' }, { label: 'Cantidad', num: true, html: (m) => `<b>${m.tipo === 'SALIDA_VENTA' ? '−' : '+'}${m.cantidad}</b>` }, { label: 'Documento', key: 'documento' }, { label: 'Responsable', key: 'usuario' }], rows, 'No hay movimientos para el filtro.'); } catch (e) { toast(e.message, 'error'); } }
    $('#go').addEventListener('click', load);
    $('#csv')?.addEventListener('click', () => api.download('/api/reportes/movimientos.csv' + qs(filt()), 'movimientos.csv').catch((e) => toast(e.message, 'error')));
    await load();
  },
};
