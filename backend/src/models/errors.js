'use strict';
// Errores de dominio compartidos por los controladores de datos (SQL Server y memoria).
class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'AppError';
    this.status = status;   // código HTTP
    this.code = code;       // VALIDATION | UNIQUE | FK | CHECK | BUSINESS | NOT_FOUND | AUTH | FORBIDDEN | RATE_LIMIT
    this.details = details;
  }
}
const validation = (msg, details) => new AppError(400, 'VALIDATION', msg, details);
const business = (msg, number) => Object.assign(new AppError(422, 'BUSINESS', msg), { number });
const notFound = (msg = 'Recurso no encontrado.') => new AppError(404, 'NOT_FOUND', msg);
const unique = (msg) => new AppError(409, 'UNIQUE', msg);
const fk = (msg) => new AppError(409, 'FK', msg);
module.exports = { AppError, validation, business, notFound, unique, fk };
