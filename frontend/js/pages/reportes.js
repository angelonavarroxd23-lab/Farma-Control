import { api, qs } from '../api.js';
import { h, money, title, table, fdate, toast, today } from '../ui.js';

// CU-10 Generar reportes: ventas confirmadas del periodo (excluye anuladas) + exportación CSV.
export async function render(el) {
  const first = today().slice(0, 8) + '01';
  el.innerHTML = title('Reportes de gestión', 'Indicadores calculados con las operaciones registradas en la base de datos.') + `
  <div class="panel"><div class="actions"><div class="filters"><div class="field"><label for="d">Desde</label><input class="input" type="date" id="d" value="${first}"></div><div class="field"><label for="a">Hasta</label><input class="input" type="date" id="a" value="${today()}"></div><button class="btn primary" id="go">Generar</button></div>
  <div class="rowButtons"><button class="btn" data-csv="ventas">CSV de ventas</button><button class="btn" data-csv="inventario">CSV de inventario</button><button class="btn" data-csv="movimientos">CSV de movimientos</button></div></div><div data-error></div></div><div id="out"></div>`;
  const $ = (s) => el.querySelector(s); const per = () => ({ desde: $('#d').value, hasta: $('#a').value });
  async function load() {
    $('[data-error]').innerHTML = '';
    try {
      const r = await api.get('/api/reportes/resumen' + qs(per())); const s = r.resumen; const max = Math.max(1, ...r.por_dia.map((x) => x.importe));
      $('#out').innerHTML = `<div class="stats"><div class="stat"><span class="label">Ventas confirmadas</span><strong>${s.ventas_confirmadas}</strong><small>${s.ventas_anuladas} anulada(s) excluidas</small></div>
      <div class="stat"><span class="label">Importe total</span><strong>${money(s.importe_total)}</strong><small>Anulado: ${money(s.importe_anulado)}</small></div>
      <div class="stat"><span class="label">Ticket promedio</span><strong>${money(s.ticket_promedio)}</strong><small>Por venta confirmada</small></div>
      <div class="stat"><span class="label">Unidades vendidas</span><strong>${s.unidades_vendidas}</strong><small>Inventario vendible: ${r.inventario.unidades_vendibles} u.</small></div></div>
      <div class="grid2" style="margin-top:20px"><div class="panel"><h3>Ventas por día</h3>${r.por_dia.length ? `<div class="chart" role="img" aria-label="Importe de ventas por día">${r.por_dia.map((x) => `<div class="bar" style="height:${Math.max(4, (x.importe / max) * 100)}%"><span>${money(x.importe)}</span><small>${fdate(x.fecha).slice(0, 5)}</small></div>`).join('')}</div><div style="height:26px"></div>` : '<p class="empty">Sin ventas en el periodo.</p>'}</div>
      <div class="panel"><h3>Productos más vendidos</h3>${table([{ label: 'Medicamento', key: 'medicamento' }, { label: 'Unid.', num: true, key: 'unidades' }, { label: 'Importe', num: true, html: (t) => money(t.importe) }], r.top_productos, 'Sin ventas en el periodo.')}</div></div>
      <div class="panel"><h3>Inventario actual</h3><p class="muted">${r.inventario.lotes} lotes · ${r.inventario.unidades_vendibles} unidades vendibles (valor de venta ${money(r.inventario.valor_venta_vendible)}) · ${r.inventario.unidades_vencidas} unidades vencidas.</p></div>`;
    } catch (e) { $('[data-error]').innerHTML = `<div class="formError" role="alert">${h(e.message)}</div>`; $('#out').innerHTML = ''; }
  }
  $('#go').addEventListener('click', load);
  el.addEventListener('click', (e) => { const b = e.target.closest('[data-csv]'); if (!b) return; const n = b.dataset.csv;
    api.download(`/api/reportes/${n}.csv` + (n === 'inventario' ? '' : qs(per())), `${n}.csv`).then(() => toast('Archivo CSV generado.')).catch((x) => toast(x.message, 'error')); });
  await load();
}
