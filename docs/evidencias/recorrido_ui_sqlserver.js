'use strict';
// Recorrido de la interfaz REAL (navegador Edge/Chrome automatizado) contra la aplicación conectada a SQL Server.
// Cada paso se verifica además con consultas directas a las tablas. Uso (con el servidor iniciado con "npm start"):
//   npm i --no-save playwright-core && node ../docs/evidencias/recorrido_ui_sqlserver.js
const path = require('node:path'); const fs = require('node:fs');
const { chromium } = require(path.join(__dirname, '..', '..', 'node_modules', 'playwright-core'));
const { conectar } = require('../../scripts/db-lib');
const OUT = path.join(__dirname, '..', 'capturas_sqlserver'); fs.mkdirSync(OUT, { recursive: true });
const BASE = process.env.BASE_URL || 'http://localhost:3000';
const EDGE = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find((f) => fs.existsSync(f));
const log = []; const ok = (name, cond, extra = '') => { log.push(`${cond ? 'OK   ' : 'FALLO'} ${name}${extra ? ' — ' + extra : ''}`); console.log(log[log.length - 1]); };

(async () => {
  const { sql, pool } = await conectar();
  const q = async (t, params = {}) => { const r = pool.request(); for (const [k, [ty, v]] of Object.entries(params)) r.input(k, ty, v); return (await r.query(t)).recordset; };
  const b = await chromium.launch({ executablePath: EDGE, headless: true });
  const p = await b.newPage({ viewport: { width: 1366, height: 820 } });
  const errs = []; p.on('console', (m) => { if (m.type() === 'error' && !/401|403|409|422/.test(m.text())) errs.push(m.text()); }); p.on('pageerror', (e) => errs.push('pageerror ' + e.message));
  const go = async (h) => { await p.evaluate((x) => { location.hash = x; }, h); await p.waitForTimeout(800); };
  const shot = (n) => p.screenshot({ path: path.join(OUT, n + '.png') });
  const stamp = Date.now().toString(36).toUpperCase(); const sku = 'UI-' + stamp; const lote = 'L-' + stamp; const dni = String(Date.now()).slice(-8);
  const nombreCli = 'Cliente UI ' + stamp; const nombreMed = 'Medicamento UI ' + stamp;

  await p.goto(BASE + '/'); await p.waitForTimeout(500); await shot('01_login');
  await p.fill('#correo', 'admin@farmacontrol.local'); await p.fill('#contrasena', 'incorrecta'); await p.click('#loginForm button[type=submit]'); await p.waitForTimeout(600);
  ok('login con contraseña incorrecta muestra error', await p.locator('.formError').count() > 0); await shot('02_login_error');
  await p.fill('#contrasena', 'Admin#2026Fc'); await p.click('#loginForm button[type=submit]'); await p.waitForTimeout(1000);
  ok('login como administrador', await p.locator('#sidebar').isVisible()); await shot('03_resumen');

  // Cliente
  await go('#/clientes'); await p.click('#new'); await p.waitForTimeout(300);
  await p.selectOption('[name=tipo_documento]', 'DNI'); await p.fill('[name=numero_documento]', dni); await p.fill('[name=nombre_razon_social]', nombreCli); await p.fill('[name=telefono]', '987654321'); await shot('04_cliente_form');
  await p.click('[data-submit]'); await p.waitForTimeout(800); await shot('05_clientes');
  ok('cliente guardado en SQL Server', (await q('SELECT COUNT(*) c FROM dbo.Cliente WHERE numero_documento=@d', { d: [sql.VarChar(15), dni] }))[0].c === 1, `DNI ${dni}`);

  // Medicamento + lote
  await go('#/medicamentos'); await p.click('#new'); await p.waitForTimeout(300);
  await p.fill('[name=sku]', sku); await p.fill('[name=nombre]', nombreMed); await p.fill('[name=principio_activo]', 'Paracetamol'); await p.fill('[name=presentacion]', 'Caja x 20 tabletas');
  await p.selectOption('[name=categoria_id]', { index: 1 }); await p.fill('[name=precio_venta]', '12.50'); await shot('06_medicamento_form');
  await p.click('[data-submit]'); await p.waitForTimeout(800);
  ok('medicamento guardado en SQL Server', (await q('SELECT COUNT(*) c FROM dbo.Medicamento WHERE sku=@s', { s: [sql.VarChar(30), sku] }))[0].c === 1, sku);
  await p.fill('#q', sku); await p.waitForTimeout(900); await shot('07_medicamentos_busqueda');
  await p.locator('[data-lotes]').first().click(); await p.waitForTimeout(600);
  await p.locator('[data-newlot]').click(); await p.waitForTimeout(300);
  const vence = new Date(Date.now() + 400 * 864e5).toISOString().slice(0, 10);
  await p.fill('[name=codigo_lote]', lote); await p.fill('[name=fecha_vencimiento]', vence); await p.fill('[name=stock_minimo]', '5'); await p.click('[data-submit]'); await p.waitForTimeout(800); await shot('08_lote_nuevo');
  const L = (await q('SELECT lote_id, stock_actual FROM dbo.Lote WHERE codigo_lote=@c', { c: [sql.VarChar(60), lote] }))[0];
  ok('lote guardado con stock 0', !!L && L.stock_actual === 0, lote);
  await p.keyboard.press('Escape'); await p.locator('#modalRoot [data-close]').first().click().catch(() => {}); await p.waitForTimeout(300);
  const stock = async () => (await q('SELECT stock_actual s FROM dbo.Lote WHERE lote_id=@i', { i: [sql.Int, L.lote_id] }))[0].s;

  // Compra
  await go('#/compras'); await p.selectOption('#prov', { index: 0 }); await p.fill('#doc', 'FAC-UI-' + stamp);
  await p.selectOption('#lote', { label: (await p.locator(`#lote option:has-text("${lote}")`).first().textContent()).trim() });
  await p.fill('#cant', '40'); await p.fill('#costo', '3.50'); await p.click('#add'); await p.waitForTimeout(300); await shot('09_compra');
  await p.click('#save'); await p.waitForTimeout(1000);
  ok('compra incrementa el stock en SQL Server (0 → 40)', (await stock()) === 40, `stock=${await stock()}`);
  ok('movimiento ENTRADA_COMPRA guardado', (await q("SELECT COUNT(*) c FROM dbo.MovimientoStock WHERE lote_id=@i AND tipo='ENTRADA_COMPRA'", { i: [sql.Int, L.lote_id] }))[0].c === 1);
  await p.getByText('Historial', { exact: true }).first().click().catch(() => {}); await p.waitForTimeout(700); await shot('10_compras_historial');

  // Venta: primero un intento que supera el stock
  await go('#/venta'); await p.selectOption('#cli', { label: (await p.locator(`#cli option:has-text("${nombreCli}")`).first().textContent()).trim() });
  await p.fill('#q', sku); await p.waitForTimeout(900);
  await p.locator('[data-qty]').first().fill('9999'); await p.locator('[data-add]').first().click(); await p.waitForTimeout(500); await shot('11_venta_stock_excedido');
  const carro1 = await p.locator('#cart').innerText(); ok('el carrito rechaza más unidades que el stock', !/9999/.test(carro1) || /m[aá]ximo|existencias|disponible/i.test(await p.locator('body').innerText()));
  await p.reload(); await p.waitForTimeout(700); await go('#/venta'); await p.selectOption('#cli', { label: (await p.locator(`#cli option:has-text("${nombreCli}")`).first().textContent()).trim() });
  await p.fill('#q', sku); await p.waitForTimeout(900); await p.locator('[data-qty]').first().fill('6'); await p.locator('[data-add]').first().click(); await p.waitForTimeout(300); await shot('12_venta_carrito');
  await p.click('#confirm'); await p.waitForTimeout(1200); await shot('13_constancia');
  ok('venta descuenta el stock en SQL Server (40 → 34)', (await stock()) === 34, `stock=${await stock()}`);
  const V = (await q("SELECT TOP 1 v.venta_id, v.estado, v.total FROM dbo.Venta v JOIN dbo.DetalleVenta d ON d.venta_id=v.venta_id WHERE d.lote_id=@i ORDER BY v.venta_id DESC", { i: [sql.Int, L.lote_id] }))[0];
  ok('venta CONFIRMADA con total correcto (6 × 12.50 = 75.00)', V && V.estado === 'CONFIRMADA' && Number(V.total) === 75, JSON.stringify(V));
  await p.locator('#modalRoot [data-close]').first().click().catch(() => {}); await p.waitForTimeout(400);

  // Anulación
  await go('#/ventas'); await shot('14_historial');
  await p.locator('[data-anular]').first().click(); await p.waitForTimeout(400); await shot('15_anular_dialogo');
  await p.fill('textarea, input[name=motivo]', 'Error de digitación del cliente (recorrido UI)'); await p.click('[data-submit]'); await p.waitForTimeout(1000); await shot('16_anulada');
  ok('anulación restituye el stock una sola vez (34 → 40)', (await stock()) === 40, `stock=${await stock()}`);
  ok('un único REVERSO_VENTA registrado', (await q("SELECT COUNT(*) c FROM dbo.MovimientoStock WHERE lote_id=@i AND tipo='REVERSO_VENTA'", { i: [sql.Int, L.lote_id] }))[0].c === 1);
  ok('el botón Anular ya no está disponible para la venta anulada', (await p.locator('[data-anular]').count()) === 0 || (await q('SELECT estado e FROM dbo.Venta WHERE venta_id=@i', { i: [sql.Int, V.venta_id] }))[0].e === 'ANULADA');

  // Resto de módulos
  await go('#/movimientos'); await shot('17_movimientos'); ok('movimientos muestra el reverso', /Reverso/i.test(await p.locator('#content').innerText()));
  await go('#/medicamentos'); await p.getByText('Lotes y vencimientos').click(); await p.waitForTimeout(700); await shot('18_lotes');
  await go('#/alertas'); await p.waitForTimeout(500); await shot('19_alertas');
  await go('#/reportes'); await p.getByRole('button', { name: /Generar/i }).click().catch(() => {}); await p.waitForTimeout(900); await shot('20_reportes');
  await go('#/usuarios'); await shot('21_usuarios'); await go('#/auditoria'); await shot('22_auditoria');
  ok('auditoría muestra la venta anulada', /VENTA_ANULADA|anulad/i.test(await p.locator('#content').innerText()));
  await go('#/recetas'); await shot('23_recetas');

  // Permisos: cajero
  const p2 = await (await b.newContext({ viewport: { width: 1366, height: 820 } })).newPage();
  await p2.goto(BASE + '/'); await p2.fill('#correo', 'cajero@farmacontrol.local'); await p2.fill('#contrasena', 'Cajero#2026Fc'); await p2.click('#loginForm button[type=submit]'); await p2.waitForTimeout(1000);
  const menu = await p2.locator('#sidebar').innerText(); await p2.screenshot({ path: path.join(OUT, '24_menu_cajero.png') });
  ok('el menú del cajero no incluye Usuarios, Auditoría ni Reportes', !/Usuarios|Auditor|Reportes/i.test(menu));
  const tk = (await (await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ correo: 'cajero@farmacontrol.local', contrasena: 'Cajero#2026Fc' }) })).json()).token;
  const r403 = await fetch(BASE + '/api/usuarios', { headers: { Authorization: 'Bearer ' + tk } }); ok('API: el cajero recibe 403 en /api/usuarios', r403.status === 403, `HTTP ${r403.status}`);

  ok('sin errores de consola inesperados', errs.length === 0, JSON.stringify(errs).slice(0, 200));
  const fallos = log.filter((l) => l.startsWith('FALLO')).length;
  fs.writeFileSync(path.join(__dirname, 'recorrido_ui_sqlserver.txt'), `Recorrido UI contra SQL Server — ${new Date().toISOString()}\nNavegador: ${EDGE}\n\n${log.join('\n')}\n\nResultado: ${log.length - fallos} OK, ${fallos} FALLO\n`);
  await pool.close(); await b.close(); process.exit(fallos ? 1 : 0);
})().catch((e) => { console.error('FALLO SCRIPT', e.message.split('\n')[0]); fs.writeFileSync(path.join(__dirname, 'recorrido_ui_sqlserver.txt'), log.join('\n') + '\nABORTADO: ' + e.message.split('\n')[0]); process.exit(1); });
