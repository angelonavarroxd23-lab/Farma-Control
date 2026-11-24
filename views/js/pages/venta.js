import { api, qs } from '../api.js';
import { h, money, title, fdate, toast, debounce, estadoLote } from '../ui.js';
import { openConstancia } from './ventas.js';
import { nuevaReceta } from './recetaForm.js';

// CU-05 Registrar venta. La interfaz solo ayuda; las reglas (stock, vencimiento, receta) las aplica el servidor.
export async function render(el, ctx) {
  const [clientes] = await Promise.all([api.get('/api/clientes')]);
  let lotes = []; let cart = []; let recetas = []; let recDetalle = null;
  el.innerHTML = title('Nueva venta', 'Seleccione cliente, productos por lote y tipo de comprobante.') + `
  <div class="gridSale">
    <div class="panel"><h3>Productos disponibles</h3>
      <div class="actions"><input class="input" id="q" placeholder="Buscar medicamento, SKU o lote…" aria-label="Buscar producto"></div>
      <div id="lotes"></div></div>
    <section class="ticket" aria-label="Ticket de venta"><h3>Ticket de venta</h3><div class="ticketHead">FarmaControl · Caja<br>Constancia interna, sin valor tributario</div><div data-error></div>
      <div class="field"><label for="cli">Cliente</label><select class="input" id="cli">${clientes.map((c) => `<option value="${c.cliente_id}" data-tipo="${h(c.tipo_documento)}">${h(c.nombre_razon_social)} · ${h(c.tipo_documento)} ${h(c.numero_documento)}</option>`).join('')}</select></div>
      <div class="field"><label for="tipo">Comprobante</label><select class="input" id="tipo"><option>BOLETA</option><option>FACTURA</option></select><span class="hint">La factura requiere un cliente con RUC.</span></div>
      <div class="field" id="recetaBox"><label for="rec">Receta registrada</label>
        <div class="inlineRow"><select class="input" id="rec"></select>${ctx.can('recetas:create') ? '<button class="btn small" type="button" id="newRec">+ Nueva receta</button>' : ''}</div>
        <span class="hint" id="recHint">Obligatoria si el carrito incluye medicamentos con receta. Si el cliente no la tiene registrada, créela aquí mismo.</span></div>
      <div id="recDet"></div>
      <div id="cart"></div>
      <div class="totals"><span>Total</span><span id="total">${money(0)}</span></div>
      <button class="btn primary" id="confirm" style="margin-top:16px;width:100%">Confirmar venta</button></section>
  </div>`;
  const $ = (s) => el.querySelector(s);

  async function loadLotes() { lotes = await api.get('/api/lotes' + qs({ disponibles: 'true', q: $('#q').value })); drawLotes(); }
  function drawLotes() {
    $('#lotes').innerHTML = lotes.length ? `<div class="tableWrap"><table><thead><tr><th>Medicamento</th><th>Lote / venc.</th><th class="num">Stock</th><th class="num">Precio</th><th>Cant.</th><th></th></tr></thead><tbody>${lotes.map((l) => `<tr>
      <td><b>${h(l.medicamento)}</b><br><span class="muted">${h(l.presentacion)}</span> ${l.requiere_receta ? '<span class="badge alert">Con receta</span>' : ''}</td>
      <td>${h(l.codigo_lote)}<br><span class="muted">${fdate(l.fecha_vencimiento)}</span> ${l.fefo_sugerido ? '<span class="badge info" title="Vence primero: se recomienda despacharlo antes">FEFO</span>' : ''} ${l.alerta === 'POR_VENCER' ? '<span class="badge alert">Por vencer</span>' : ''}</td>
      <td class="num">${l.stock_actual}</td><td class="num">${money(l.precio_venta)}</td>
      <td><input class="input qty" type="number" min="1" max="${l.stock_actual}" value="1" aria-label="Cantidad de ${h(l.medicamento)}" data-qty="${l.lote_id}"></td>
      <td><button class="btn small" data-add="${l.lote_id}">Agregar</button></td></tr>`).join('')}</tbody></table></div>` : '<p class="empty">No hay lotes disponibles con ese criterio.</p>';
  }
  function drawCart() {
    $('#cart').innerHTML = cart.length ? cart.map((x) => `<div class="detailLine"><div><b>${h(x.medicamento)}</b><small>Lote ${h(x.codigo_lote)} · ${x.cantidad} × ${money(x.precio_venta)}</small></div><div><b>${money(x.cantidad * x.precio_venta)}</b><button class="btn small danger" data-del="${x.lote_id}" aria-label="Quitar ${h(x.medicamento)}">Quitar</button></div></div>`).join('') : '<p class="empty">Agregue medicamentos para empezar.</p>';
    $('#total').textContent = money(cart.reduce((a, x) => a + x.cantidad * x.precio_venta, 0));
    const needs = cart.some((x) => x.requiere_receta);
    $('#recHint').textContent = needs ? 'El carrito incluye medicamentos con receta: seleccione una receta vigente del cliente.' : 'Obligatoria si el carrito incluye medicamentos con receta.';
  }
  async function loadRecetas(seleccionar) {
    const id = $('#cli').value;
    recetas = id ? await api.get('/api/recetas' + qs({ cliente_id: id, vigentes: 'true' })) : [];
    $('#rec').innerHTML = `<option value="">— Sin receta —</option>${recetas.map((r) => `<option value="${r.receta_id}">${h(r.numero_receta)} · vence ${fdate(r.fecha_vencimiento)}</option>`).join('')}`;
    if (seleccionar) $('#rec').value = String(seleccionar);
    await drawReceta();
  }
  // Detalle de la receta elegida: lo prescrito, lo ya dispensado y el saldo; permite cargar el saldo al carrito por FEFO.
  async function drawReceta() {
    recDetalle = null; const id = $('#rec').value;
    if (!id) { $('#recDet').innerHTML = ''; return; }
    recDetalle = await api.get(`/api/recetas/${id}`);
    $('#recDet').innerHTML = recDetalle.detalle.length ? `<div class="recetaBox"><b>Prescrito en la receta ${h(recDetalle.numero_receta)}</b>${recDetalle.detalle.map((d) => `<div class="detailLine"><div><b>${h(d.medicamento)}</b><small>Prescrito ${d.cantidad} · dispensado ${d.dispensado} · pendiente <b>${d.pendiente}</b>${d.indicaciones ? ' · ' + h(d.indicaciones) : ''}</small></div>${d.pendiente > 0 ? `<button class="btn small" type="button" data-fefo="${d.medicamento_id}" data-cant="${d.pendiente}">Agregar pendiente</button>` : '<span class="badge muted">Completo</span>'}</div>`).join('')}</div>` : '<p class="muted" style="font-size:12px">Esta receta se registró sin detalle de medicamentos: solo se verifica su vigencia y titular.</p>';
  }
  // Agrega al carrito unidades de un medicamento tomando primero el lote que vence antes (FEFO) y pasando al siguiente si no alcanza.
  async function agregarFefo(medId, cantidad) {
    const ls = await api.get('/api/lotes' + qs({ disponibles: 'true', medicamento_id: medId }));
    let falta = cantidad;
    for (const l of ls) {
      if (falta <= 0) break;
      const ya = cart.find((x) => x.lote_id === l.lote_id); const libre = l.stock_actual - (ya?.cantidad || 0); const toma = Math.min(libre, falta);
      if (toma <= 0) continue;
      if (ya) ya.cantidad += toma; else cart.push({ ...l, cantidad: toma });
      falta -= toma;
    }
    drawCart();
    if (falta > 0) toast(`Solo había stock para ${cantidad - falta} de ${cantidad} unidades.`, 'error');
  }

  el.addEventListener('click', (e) => {
    const add = e.target.closest('[data-add]'); const del = e.target.closest('[data-del]');
    if (add) {
      const l = lotes.find((x) => x.lote_id === Number(add.dataset.add));
      const cantidad = Number(el.querySelector(`[data-qty="${l.lote_id}"]`).value);
      if (!Number.isInteger(cantidad) || cantidad < 1) return toast('Indique una cantidad entera mayor que cero.', 'error');
      const antes = lotes.find((x) => x.medicamento_id === l.medicamento_id && x.fefo_sugerido);
      if (antes && antes.lote_id !== l.lote_id) toast(`Aviso FEFO: el lote ${antes.codigo_lote} vence antes (${fdate(antes.fecha_vencimiento)}). Se recomienda despacharlo primero.`);
      const ya = cart.find((x) => x.lote_id === l.lote_id); const total = (ya?.cantidad || 0) + cantidad;
      if (total > l.stock_actual) return toast(`Solo hay ${l.stock_actual} unidades disponibles en el lote ${l.codigo_lote}.`, 'error');
      if (ya) ya.cantidad = total; else cart.push({ ...l, cantidad });
      drawCart();
    }
    const fefo = e.target.closest('[data-fefo]');
    if (fefo) agregarFefo(Number(fefo.dataset.fefo), Number(fefo.dataset.cant)).catch((x) => toast(x.message, 'error'));
    if (del) { cart = cart.filter((x) => x.lote_id !== Number(del.dataset.del)); drawCart(); }
  });
  $('#q').addEventListener('input', debounce(loadLotes));
  $('#rec').addEventListener('change', () => drawReceta().catch((x) => toast(x.message, 'error')));
  $('#newRec')?.addEventListener('click', () => nuevaReceta({ clientes, clienteId: Number($('#cli').value), onCreated: async (r) => { await loadRecetas(r.receta_id); } }).catch((x) => toast(x.message, 'error')));
  $('#cli').addEventListener('change', () => { loadRecetas().catch((x) => toast(x.message, 'error')); $('#tipo').value = $('#cli').selectedOptions[0]?.dataset.tipo === 'RUC' ? $('#tipo').value : 'BOLETA'; });
  $('#confirm').addEventListener('click', async () => {
    const btn = $('#confirm'); const box = $('[data-error]'); box.innerHTML = '';
    if (!cart.length) return toast('Agregue al menos un medicamento.', 'error');
    btn.disabled = true;
    try {
      const r = await api.post('/api/ventas', { cliente_id: Number($('#cli').value), tipo_comprobante: $('#tipo').value, receta_id: $('#rec').value || null, items: cart.map((x) => ({ lote_id: x.lote_id, cantidad: x.cantidad })) });
      toast(`Venta ${r.numero_comprobante} registrada.`);
      cart = []; drawCart(); await Promise.all([loadLotes(), drawReceta()]); openConstancia(r.venta_id);
    } catch (err) {
      const list = (err.details || []).map((d) => `<li>${h(d)}</li>`).join('');
      box.innerHTML = `<div class="formError" role="alert">${h(err.message)}${list ? `<ul>${list}</ul>` : ''}</div>`;
      await loadLotes(); // refresca existencias por si cambiaron
    } finally { btn.disabled = false; }
  });
  await Promise.all([loadLotes(), loadRecetas()]); drawCart();
}
