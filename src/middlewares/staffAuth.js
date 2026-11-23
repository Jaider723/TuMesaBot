// Middleware de autenticación y manejo de sesiones para Staff (Admin y Cocina)
const crypto = require('crypto');
const env = require('../config/env');

const ADMIN_COOKIE_NAME = 'admin_session';
const COCINA_COOKIE_NAME = 'cocina_session';

// Opciones base para cookies seguras en Express / Render
const COOKIE_BASE_OPTIONS = {
  signed: true,
  httpOnly: true,
  sameSite: 'lax',
  secure: env.NODE_ENV === 'production'
};

// Opciones con expiración (24 horas)
const COOKIE_SESSION_OPTIONS = {
  ...COOKIE_BASE_OPTIONS,
  maxAge: 24 * 60 * 60 * 1000
};

/**
 * Comparación segura contra ataques de temporización (timing attacks).
 * Se calcula el hash SHA-256 de ambas cadenas para garantizar buffers de longitud idéntica
 * y prevenir excepciones por discrepancia de tamaño en crypto.timingSafeEqual.
 */
function compararCadenasSeguro(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') {
    return false;
  }
  const hashA = crypto.createHash('sha256').update(a).digest();
  const hashB = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

// Helpers de validación de credenciales
function verificarPasswordAdmin(password) {
  return compararCadenasSeguro(password, env.ADMIN_PASSWORD);
}

function verificarPinCocina(pin) {
  return compararCadenasSeguro(String(pin), String(env.COCINA_PIN));
}

// Helpers para emisión de cookies de sesión
function setAdminCookie(res) {
  res.cookie(ADMIN_COOKIE_NAME, 'authenticated', COOKIE_SESSION_OPTIONS);
}

function clearAdminCookie(res) {
  res.clearCookie(ADMIN_COOKIE_NAME, COOKIE_BASE_OPTIONS);
}

function setCocinaCookie(res) {
  res.cookie(COCINA_COOKIE_NAME, 'authenticated', COOKIE_SESSION_OPTIONS);
}

function clearCocinaCookie(res) {
  res.clearCookie(COCINA_COOKIE_NAME, COOKIE_BASE_OPTIONS);
}

// Middleware para proteger rutas de administración
function requireAdminAuth(req, res, next) {
  if (req.signedCookies && req.signedCookies[ADMIN_COOKIE_NAME] === 'authenticated') {
    return next();
  }
  return res.status(401).json({
    status: 'error',
    error: 'No autorizado. Se requiere sesión de administrador.'
  });
}

// Middleware para proteger rutas de cocina
function requireCocinaAuth(req, res, next) {
  if (req.signedCookies && req.signedCookies[COCINA_COOKIE_NAME] === 'authenticated') {
    return next();
  }
  return res.status(401).json({
    status: 'error',
    error: 'No autorizado. Se requiere sesión de cocina/meseros.'
  });
}

module.exports = {
  ADMIN_COOKIE_NAME,
  COCINA_COOKIE_NAME,
  verificarPasswordAdmin,
  verificarPinCocina,
  setAdminCookie,
  clearAdminCookie,
  setCocinaCookie,
  clearCocinaCookie,
  requireAdminAuth,
  requireCocinaAuth
};
