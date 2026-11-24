'use strict';
// Recorrido de la interfaz 2.2 con Chromium (Playwright) y captura de las pantallas usadas en el Informe (prototipos y manual).
// Ejecución: PORT=3116 node scripts/start-memory.js  (modo demostración, datos en memoria, SIN SQL Server)
//            node docs/evidencias/recorrido_ui_v22_capturas.js http://localhost:3116/ docs/capturas_v22/sistema
const { chromium } = require('playwright');
const BASE = process.argv[2] || 'http://localhost:3116/'; const OUT = process.argv[3] || 'docs/capturas_v22/sistema';
const log = []; const ok = (name, cond, extra = '') => { log.push(`${cond ? 'OK   ' : 'FALLO'} ${name}${extra ? ' — ' + extra : ''}`); };
(async () => {
  const b = await chromium.launch(); const errs = [];
  const nueva = async () => { const c = await b.newContext({ viewport: { width: 1440, height: 900 } }); const p = await c.newPage();
    p.on('pageerror', (e) => errs.push('pageerror ' + e.message)); p.on('console', (m) => { if (m.type() === 'error' && !/401|403|409|422/.test(m.text())) errs.push(m.text()); }); return p; };
  let p = await nueva();
  const go = async (h) => { await p.evaluate((x) => { location.hash = x; }, h); await p.waitForTimeout(900); };
  const shot = (n) => p.screenshot({ path: `${OUT}/${n}.png` });
  const login = async (c, k) => { await p.goto(BASE); await p.waitForSelector('#loginForm'); await p.fill('#correo', c); await p.fill('#contrasena', k); await p.click('#loginForm button[type=submit]'); await p.waitForSelector('#sidebar .nav'); await p.waitForTimeout(700); };
  const stamp = Date.now().toString(36).toUpperCase(); const sku = 'UI-' + stamp; const lote = 'L-' + stamp; const dni = String(Date.now()).slice(-8); const nombreCli = 'Cliente UI ' + stamp;

  await p.goto(BASE); await p.waitForSelector('#loginForm'); await p.waitForTimeout(800); await shot('01_login');
  await p.fill('#correo', 'admin@farmacontrol.local'); await p.fill('#contrasena', 'incorrecta'); await p.click('#loginForm button[type=submit]'); await p.waitForTimeout(700);
  ok('credenciales incorrectas muestran un mensaje', await p.locator('.formError').count() > 0); await shot('02_login_error');
  await p.fill('#contrasena', 'Admin#2026Fc'); await p.click('#loginForm button[type=submit]'); await p.waitForSelector('#sidebar .nav'); await p.waitForTimeout(900);
  ok('ingreso como administrador; nombre y rol bajo el perfil', /Ana Administradora[\s\S]*Administrador/.test(await p.locator('#perfilBtn').innerText())); await shot('03_resumen');

  await go('#/clientes'); await p.click('#new'); await p.waitForTimeout(300);
  await p.selectOption('[name=tipo_documento]', 'DNI'); await p.fill('[name=numero_documento]', dni); await p.fill('[name=nombre_razon_social]', nombreCli); await p.fill('[name=telefono]', '987654321'); await shot('04_cliente_form');
  await p.click('[data-submit]'); await p.waitForTimeout(800); await shot('05_clientes');
  ok('cliente registrado', (await p.locator(`text=${nombreCli}`).count()) === 1);
  await p.locator('[data-del]').first().click(); await p.click('.modal [data-ok]'); await p.waitForTimeout(600); await shot('05b_cliente_con_historial');
  ok('un cliente con ventas o recetas no se elimina', /No se puede eliminar/.test(await p.locator('.modal').innerText())); await p.keyboard.press('Escape');

  await go('#/medicamentos'); await p.click('#new'); await p.waitForTimeout(300);
  await p.fill('[name=sku]', sku); await p.fill('[name=nombre]', 'Medicamento UI ' + stamp); await p.fill('[name=principio_activo]', 'Paracetamol'); await p.fill('[name=presentacion]', 'Caja x 20 tabletas');
  await p.selectOption('[name=categoria_id]', { index: 1 }); await p.fill('[name=precio_venta]', '12.50'); await shot('06_medicamento_form');
  await p.click('[data-submit]'); await p.waitForTimeout(800); await p.fill('#q', sku); await p.waitForTimeout(900); await shot('07_medicamentos_busqueda');
  await p.locator('[data-lotes]').first().click(); await p.waitForTimeout(600); await p.locator('[data-newlot]').click(); await p.waitForTimeout(300);
  await p.fill('[name=codigo_lote]', lote); await p.fill('[name=fecha_vencimiento]', new Date(Date.now() + 400 * 864e5).toISOString().slice(0, 10)); await p.fill('[name=stock_minimo]', '5');
  await p.click('[data-submit]'); await p.waitForTimeout(800); await shot('08_lote_nuevo');
  await p.keyboard.press('Escape'); await p.locator('#modalRoot [data-close]').first().click().catch(() => {}); await p.waitForTimeout(300);

  await go('#/compras'); await p.selectOption('#prov', { index: 0 }); await p.fill('#doc', 'FAC-UI-' + stamp);
  await p.selectOption('#lote', { label: (await p.locator(`#lote option:has-text("${lote}")`).first().textContent()).trim() });
  await p.fill('#cant', '40'); await p.fill('#costo', '3.50'); await p.click('#add'); await p.waitForTimeout(300); await shot('09_compra');
  await p.click('#save'); await p.waitForTimeout(1000); ok('compra registrada', /registrada/i.test(await p.locator('#toast').innerText()));
  await p.getByText('Historial', { exact: true }).first().click().catch(() => {}); await p.waitForTimeout(700); await shot('10_compras_historial');

  await go('#/venta'); await p.selectOption('#cli', { label: (await p.locator(`#cli option:has-text("${nombreCli}")`).first().textContent()).trim() });
  await p.fill('#q', sku); await p.waitForTimeout(900); await p.locator('[data-qty]').first().fill('9999'); await p.locator('[data-add]').first().click(); await p.waitForTimeout(500); await shot('11_venta_stock_excedido');
  ok('el carrito rechaza más unidades que el stock', /disponibles/i.test(await p.locator('#toast').innerText()));
  await p.locator('[data-qty]').first().fill('6'); await p.locator('[data-add]').first().click(); await p.waitForTimeout(500); await shot('12_venta_carrito');
  await p.click('#confirm'); await p.waitForTimeout(1200); await shot('13_constancia');
  ok('venta confirmada y constancia abierta', await p.locator('.receipt').count() > 0);
  await p.locator('#modalRoot [data-close]').first().click().catch(() => {}); await p.waitForTimeout(300);
  await go('#/ventas'); await shot('14_historial');
  await p.locator('[data-anular]').first().click(); await p.waitForTimeout(400); await p.fill('textarea, input[name=motivo]', 'Error de digitación (recorrido de interfaz)'); await shot('15_anular_dialogo');
  await p.click('[data-submit]'); await p.waitForTimeout(1000); await shot('16_anulada');
  ok('venta anulada en el historial', /Anulada/i.test(await p.locator('#content').innerText()));
  await go('#/movimientos'); await shot('17_movimientos'); ok('movimientos muestra el reverso', /Reverso/i.test(await p.locator('#content').innerText()));
  await go('#/medicamentos'); await p.getByText('Lotes y vencimientos').click(); await p.waitForTimeout(700); await shot('18_lotes');
  await go('#/alertas'); await shot('19_alertas');
  await go('#/reportes'); await p.getByRole('button', { name: /Generar/i }).click().catch(() => {}); await p.waitForTimeout(900); await shot('20_reportes');
  await p.click('#perfilBtn'); await p.waitForSelector('#adminUsers [data-edit]'); await p.waitForTimeout(600); await shot('21_perfil_usuarios');
  ok('el administrador gestiona usuarios desde Perfil', await p.locator('#adminUsers [data-edit]').count() >= 4);
  await go('#/auditoria'); await shot('22_auditoria'); ok('auditoría registra la anulación', /ANULADA/i.test(await p.locator('#content').innerText()));
  await go('#/recetas'); await shot('23_recetas');
  await p.click('#prefBtn'); await p.waitForSelector('.themeCard'); await p.waitForTimeout(500); await shot('25_preferencias');
  await p.click('[data-tema=oscuro]'); await p.waitForTimeout(400); await go('#/venta'); await shot('26_venta_oscuro');
  ok('el tema oscuro se aplica', (await p.evaluate(() => document.documentElement.dataset.theme)) === 'oscuro'); await p.evaluate(() => window.FCPrefs.tema('claro'));

  // Cajero: menú reducido, receta en caja, venta con receta
  p = await nueva(); await login('cajero@farmacontrol.local', 'Cajero#2026Fc'); await shot('24_menu_cajero');
  ok('el menú del cajero no incluye Reportes ni Auditoría', !/Reportes|Auditor/.test(await p.locator('#sidebar').innerText()));
  await go('#/venta'); await p.waitForSelector('#lotes table');
  const optLuis = await p.locator('#cli option', { hasText: 'Luis Paredes' }).getAttribute('value'); await p.selectOption('#cli', optLuis); await p.waitForTimeout(400);
  await p.click('#newRec'); await p.waitForSelector('#rf_num'); await p.fill('#rf_num', 'REC-UI-' + stamp.slice(-4)); await p.fill('#rf_pre', 'Dr. Interfaz');
  const d = new Date(); d.setDate(d.getDate() + 15); await p.fill('#rf_vc', d.toISOString().slice(0, 10));
  await p.selectOption('#rf_med', { index: 1 }); await p.fill('#rf_cant', '2'); await p.fill('#rf_ind', '1 cada 8 horas'); await p.click('#rf_add'); await shot('27_receta_en_caja');
  await p.click('[data-save]'); await p.waitForTimeout(700); await p.click('[data-fefo]'); await p.waitForTimeout(600); await shot('28_venta_con_receta');
  ok('el saldo de la receta se agrega al ticket', await p.locator('#cart .detailLine').count() >= 1);

  // Almacenero: reposición y compra con lote nuevo asociada a la orden
  p = await nueva(); await login('almacen@farmacontrol.local', 'Almacen#2026Fc');
  await go('#/reposicion'); await p.waitForSelector('#tbl table'); await shot('29_reposicion_sugerencias');
  await p.click('#gen'); await p.waitForTimeout(800); await p.click('[data-tab=ord]'); await p.waitForSelector('#tbl table'); await shot('30_reposicion_ordenes');
  await go('#/compras'); const prov1 = await p.locator('#prov option').first().getAttribute('value'); await p.selectOption('#prov', prov1); await p.waitForTimeout(200);
  await p.selectOption('#orden', { index: 1 }); await p.waitForTimeout(400); await p.click('[data-pre]'); await p.fill('#ncod', 'UI-NL-' + stamp.slice(-4));
  const f = new Date(); f.setDate(f.getDate() + 200); await p.fill('#nven', f.toISOString().slice(0, 10)); await p.fill('#doc', 'FAC-NL-' + stamp); await p.click('#add'); await shot('31_compra_lote_nuevo');
  await p.click('#save'); await p.waitForTimeout(900); ok('compra con lote nuevo asociada a la orden', /registrada/i.test(await p.locator('#toast').innerText()));
  await go('#/recetas').catch(() => {});

  ok('sin errores de JavaScript inesperados', errs.length === 0, errs.join(' | ').slice(0, 300));
  console.log(log.join('\n')); await b.close();
  if (log.some((l) => l.startsWith('FALLO'))) process.exitCode = 1;
})().catch((e) => { console.log(log.join('\n')); console.error('ERROR', e.message); process.exit(1); });
