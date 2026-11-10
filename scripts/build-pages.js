'use strict';
// Genera el sitio estático de GitHub Pages en _site/ (vista + aplicación del servidor empaquetada para el navegador).
// Uso: node scripts/build-pages.js
const fs = require('node:fs'); const path = require('node:path');
const ROOT = path.join(__dirname, '..'); const OUT = path.join(ROOT, '_site');
fs.rmSync(OUT, { recursive: true, force: true });
fs.cpSync(path.join(ROOT, 'views'), OUT, { recursive: true, filter: (f) => !f.endsWith('serve.js') });

const mods = new Map(); const SHIMS = ['node:crypto', 'node:fs', 'node:path'];
function add(rel) {
  if (mods.has(rel)) return; mods.set(rel, null);
  let src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  src = src.replace(/require\('([^']+)'\)/g, (m, spec) => {
    if (SHIMS.includes(spec)) return `__req('${spec}')`;
    if (!spec.startsWith('.')) throw new Error(`Dependencia no soportada en el navegador: ${spec} (${rel})`);
    let t = path.join(path.dirname(rel), spec).replace(/\\/g, '/');
    if (fs.existsSync(path.join(ROOT, t + '.js'))) t += '.js'; else if (fs.existsSync(path.join(ROOT, t, 'index.js'))) t += '/index.js';
    add(t); return `__req('${t}')`;
  });
  mods.set(rel, src);
}
['app.js', 'models/memory.js', 'models/seed.js'].forEach(add);
if ([...mods.keys()].some((k) => k.includes('mssql'))) throw new Error('El paquete del navegador no debe incluir mssql.js');
let bundle = `/* FarmaControl — demostración para GitHub Pages. Generado por scripts/build-pages.js; no editar. */\n(function(){\n` +
  `const __defs = {}, __cache = {}; window.__req = function (id) { if (window.__FC_SHIMS[id]) return window.__FC_SHIMS[id];\n` +
  `  if (__cache[id]) return __cache[id].exports; const module = { exports: {} }; __cache[id] = module; __defs[id](module, module.exports); return module.exports; };\n`;
for (const [id, src] of mods) bundle += `__defs['${id}'] = function (module, exports) {\n${src}\n};\n`;
bundle += '})();\n';
fs.mkdirSync(path.join(OUT, 'demo'), { recursive: true });
fs.writeFileSync(path.join(OUT, 'demo', 'servidor.js'), bundle);
fs.copyFileSync(path.join(ROOT, 'pages', 'shims.js'), path.join(OUT, 'demo', 'shims.js'));
fs.copyFileSync(path.join(ROOT, 'pages', 'adaptador.js'), path.join(OUT, 'demo', 'adaptador.js'));
const banner = '<div style="position:fixed;bottom:0;left:0;right:0;z-index:9999;background:#fff4dc;color:#5a4300;border-top:1px solid #e8c770;font:13px/1.4 system-ui,sans-serif;padding:6px 12px;text-align:center">' +
  'Demostración en GitHub Pages: la aplicación se ejecuta en su navegador con datos de ejemplo (sin SQL Server); los cambios se pierden al recargar. ' +
  'Usuario: admin@farmacontrol.local · Admin#2026Fc</div>';
let html = fs.readFileSync(path.join(OUT, 'index.html'), 'utf8');
html = html.replace('<script type="module" src="js/main.js"></script>',
  '<script src="demo/shims.js"></script>\n<script src="demo/servidor.js"></script>\n<script src="demo/adaptador.js"></script>\n<script type="module" src="js/main.js"></script>\n' + banner);
fs.writeFileSync(path.join(OUT, 'index.html'), html);
// Mensaje del panel que en la demo no sería cierto (no hay base de datos central).
const ini = path.join(OUT, 'js', 'pages', 'inicio.js');
fs.writeFileSync(ini, fs.readFileSync(ini, 'utf8').replace('Los datos se leen de la base de datos central a través de la API; no dependen del navegador.',
  'Demostración: los datos de ejemplo viven en esta pestaña del navegador. En la instalación real se leen de SQL Server a través de la API.'));
fs.writeFileSync(path.join(OUT, '.nojekyll'), '');
console.log(`Sitio generado en _site/ (${mods.size} módulos): ${[...mods.keys()].join(', ')}`);
