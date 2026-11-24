const { chromium } = require('playwright');
(async () => {
  const B = process.argv[2], OUT = process.argv[3]; const b = await chromium.launch(); const errs = [];
  const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  p.on('pageerror', e => errs.push(String(e)));
  await p.goto(B); await p.waitForSelector('#loginForm'); await p.fill('#correo', 'admin@farmacontrol.local'); await p.fill('#contrasena', 'Admin#2026Fc'); await p.click('#loginForm button[type=submit]'); await p.waitForSelector('.sidebar .nav');
  await p.screenshot({ path: OUT + '/00_topbar.png', clip: { x: 900, y: 0, width: 540, height: 80 } });
  const shot = async (hash, btnSel, name) => { await p.goto(B + hash); await p.waitForTimeout(700); if (btnSel) { await p.locator(btnSel).first().click(); await p.waitForSelector('.modal'); await p.waitForTimeout(400); } await p.screenshot({ path: OUT + '/' + name + '.png' }); if (btnSel) await p.keyboard.press('Escape'); };
  await shot('#/clientes', 'button:has-text("Nuevo")', '01_cliente');
  await shot('#/medicamentos', 'button:has-text("Nuevo medicamento")', '02_medicamento');
  await shot('#/recetas', '#new, button:has-text("Registrar receta"), button:has-text("+ Receta")', '03_receta');
  await shot('#/proveedores', 'button:has-text("Nuevo")', '04_proveedor');
  await shot('#/perfil', '#adminUsers #new', '05_usuario');
  await shot('#/compras', null, '06_compras');
  await shot('#/venta', null, '07_venta');
  await shot('#/reportes', null, '08_reportes');
  await shot('#/reposicion', null, '09_reposicion');
  console.log('errores:', errs.length ? errs : 'ninguno'); await b.close();
})();
