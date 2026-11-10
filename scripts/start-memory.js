'use strict';
// Vista previa SIN base de datos (datos volátiles). Uso explícito; "npm start" nunca cae a este modo.
process.env.DB_DRIVER = 'memory';
process.env.JWT_SECRET = process.env.JWT_SECRET || require('node:crypto').randomBytes(32).toString('hex');
require('../server').start().catch((e) => { console.error(e.message); process.exit(1); });
