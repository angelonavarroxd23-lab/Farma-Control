import { api } from '../api.js';
import { h, money, title, estadoLote, fdate, table } from '../ui.js';

export async function render(el, ctx) {
  const r = await api.get('/api/resumen');
  const a = r.alertas;
  el.innerHTML = title('Resumen de operaciones', 'Estado actual del negocio y tareas pendientes.') + `
  <div class="stats">
    ${r.ventas_hoy ? `<div class="stat"><span class="label">Ventas de hoy</span><strong>${r.ventas_hoy.numero}</strong><small>${r.ventas_hoy.anuladas} anulada(s)</small></div>
    <div class="stat"><span class="label">Importe de hoy</span><strong>${money(r.ventas_hoy.importe)}</strong><small>Ventas confirmadas</small></div>`
    : `<div class="stat"><span class="label">Medicamentos activos</span><strong>${r.medicamentos_activos}</strong><small>En catálogo</small></div><div class="stat"><span class="label">Clientes</span><strong>${r.clientes}</strong><small>Registrados</small></div>`}
    <div class="stat"><span class="label">Stock bajo / agotados</span><strong>${a.STOCK_BAJO + a.AGOTADO}</strong><small>${a.AGOTADO} agotado(s)</small></div>
    <div class="stat"><span class="label">Por vencer / vencidos</span><strong>${a.POR_VENCER + a.VENCIDO}</strong><small>${a.VENCIDO} vencido(s) con stock</small></div>
  </div>
  <div class="grid2" style="margin-top:20px">
    <div class="panel"><h3>Alertas de inventario</h3>${r.alertas_recientes.length ? r.alertas_recientes.map((x) => `<div class="detailLine"><div><b>${h(x.medicamento)}</b><small>Lote ${h(x.codigo_lote)} · vence ${fdate(x.fecha_vencimiento)} · stock ${x.stock_actual}</small></div>${estadoLote(x)}</div>`).join('') : '<p class="empty">No hay alertas vigentes.</p>'}
      <p style="margin:14px 0 0"><a class="btn small" href="#/alertas">Ver todas las alertas</a></p></div>
    <div class="panel"><h3>Acciones rápidas</h3><p class="muted">Acceda a las operaciones más frecuentes de su perfil.</p>
      <div class="rowButtons">${ctx.can('ventas:create') ? '<a class="btn primary" href="#/venta">+ Registrar venta</a>' : ''}${ctx.can('compras:read') ? '<a class="btn" href="#/compras">+ Registrar compra</a>' : ''}<a class="btn" href="#/medicamentos">Consultar medicamentos</a>${ctx.can('reportes:read') ? '<a class="btn" href="#/reportes">Ver reportes</a>' : ''}</div>
      <div class="notice" style="margin-top:20px">Demostración: los datos de ejemplo viven en esta pestaña del navegador. En la instalación real se leen de SQL Server a través de la API.</div></div>
  </div>`;
}
