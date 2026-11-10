import { api, qs } from '../api.js';
import { h, money, title, fdate, toast, debounce, estadoLote } from '../ui.js';
import { openConstancia } from './ventas.js';

// CU-05 Registrar venta. La interfaz solo ayuda; las reglas (stock, vencimiento, receta) las aplica el servidor.
export async function render(el, ctx) {
  const [clientes] = await Promise.all([api.get('/api/clientes')]);
  let lotes = []; let cart = []; let recetas = [];
  el.innerHTML = title('Nueva venta', 'Seleccione cliente, productos por lote y tipo de comprobante.') + `
  <div class="gridSale">
    <div class="panel"><h3>Productos disponibles</h3>
      <div class="actions"><input class="input" id="q" placeholder="Buscar medicamento, SKU o lote…" aria-label="Buscar producto"></div>
      <div id="lotes"></div></div>
    <div class="panel"><h3>Detalle de venta</h3><div data-error></div>
      <div class="field"><label for="cli">Cliente</label><select class="input" id="cli">${clientes.map((c) => `<option value="${c.cliente_id}" data-tipo="${h(c.tipo_documento)}">${h(c.nombre_razon_social)} · ${h(c.tipo_documento)} ${h(c.numero_documento)}</option>`).join('')}</select></div>
      <div class="field"><label for="tipo">Comprobante</label><select class="input" id="tipo"><option>BOLETA</option><option>FACTURA</option></select><span class="hint">La factura requiere un cliente con RUC.</span></div>
      <div class="field" id="recetaBox"><label for="rec">Receta registrada</label><select class="input" id="rec"></select><span class="hint" id="recHint">Obligatoria si el carrito incluye medicamentos con receta.</span></div>
      <div id="cart"></div>
      <div class="totals"><span>Total</span><span id="total">${money(0)}</span></div>
      <button class="btn primary" id="confirm" style="margin-top:16px;width:100%">Confirmar venta</button>
      <p class="muted" style="font-size:12px;line-height:1.5">Se registra la venta, se descuenta el stock del lote y se genera una constancia interna. La verificación de receta comprueba registro, vigencia y titular; no evalúa su contenido clínico.</p></div>
  </div>`;
  const $ = (s) => el.querySelector(s);

  async function loadLotes() { lotes = await api.get('/api/lotes' + qs({ disponibles: 'true', q: $('#q').value })); drawLotes(); }
  function drawLotes() {
    $('#lotes').innerHTML = lotes.length ? `<div class="tableWrap"><table><thead><tr><th>Medicamento</th><th>Lote / venc.</th><th class="num">Stock</th><th class="num">Precio</th><th>Cant.</th><th></th></tr></thead><tbody>${lotes.map((l) => `<tr>
      <td><b>${h(l.medicamento)}</b><br><span class="muted">${h(l.presentacion)}</span> ${l.requiere_receta ? '<span class="badge alert">Con receta</span>' : ''}</td>
      <td>${h(l.codigo_lote)}<br><span class="muted">${fdate(l.fecha_vencimiento)}</span> ${l.alerta === 'POR_VENCER' ? '<span class="badge alert">Por vencer</span>' : ''}</td>
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
  async function loadRecetas() {
    const id = $('#cli').value;
    recetas = id ? await api.get('/api/recetas' + qs({ cliente_id: id, vigentes: 'true' })) : [];
    $('#rec').innerHTML = `<option value="">— Sin receta —</option>${recetas.map((r) => `<option value="${r.receta_id}">${h(r.numero_receta)} · vence ${fdate(r.fecha_vencimiento)}</option>`).join('')}`;
  }

  el.addEventListener('click', (e) => {
    const add = e.target.closest('[data-add]'); const del = e.target.closest('[data-del]');
    if (add) {
      const l = lotes.find((x) => x.lote_id === Number(add.dataset.add));
      const cantidad = Number(el.querySelector(`[data-qty="${l.lote_id}"]`).value);
      if (!Number.isInteger(cantidad) || cantidad < 1) return toast('Indique una cantidad entera mayor que cero.', 'error');
      const ya = cart.find((x) => x.lote_id === l.lote_id); const total = (ya?.cantidad || 0) + cantidad;
      if (total > l.stock_actual) return toast(`Solo hay ${l.stock_actual} unidades disponibles en el lote ${l.codigo_lote}.`, 'error');
      if (ya) ya.cantidad = total; else cart.push({ ...l, cantidad });
      drawCart();
    }
    if (del) { cart = cart.filter((x) => x.lote_id !== Number(del.dataset.del)); drawCart(); }
  });
  $('#q').addEventListener('input', debounce(loadLotes));
  $('#cli').addEventListener('change', () => { loadRecetas(); $('#tipo').value = $('#cli').selectedOptions[0]?.dataset.tipo === 'RUC' ? $('#tipo').value : 'BOLETA'; });
  $('#confirm').addEventListener('click', async () => {
    const btn = $('#confirm'); const box = $('[data-error]'); box.innerHTML = '';
    if (!cart.length) return toast('Agregue al menos un medicamento.', 'error');
    btn.disabled = true;
    try {
      const r = await api.post('/api/ventas', { cliente_id: Number($('#cli').value), tipo_comprobante: $('#tipo').value, receta_id: $('#rec').value || null, items: cart.map((x) => ({ lote_id: x.lote_id, cantidad: x.cantidad })) });
      toast(`Venta ${r.numero_comprobante} registrada.`);
      cart = []; drawCart(); await loadLotes(); openConstancia(r.venta_id);
    } catch (err) {
      const list = (err.details || []).map((d) => `<li>${h(d)}</li>`).join('');
      box.innerHTML = `<div class="formError" role="alert">${h(err.message)}${list ? `<ul>${list}</ul>` : ''}</div>`;
      await loadLotes(); // refresca existencias por si cambiaron
    } finally { btn.disabled = false; }
  });
  await Promise.all([loadLotes(), loadRecetas()]); drawCart();
}
