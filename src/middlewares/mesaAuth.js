// Middleware de autenticación y aislamiento de sesión para clientes (comensales por QR)
const env = require('../config/env');
const mesaService = require('../services/mesaService');

const MESA_COOKIE_NAME = 'mesa_session';

// Opciones base para cookie segura HttpOnly (compatibles con Render)
const COOKIE_BASE_OPTIONS = {
  signed: true,
  httpOnly: true,
  sameSite: 'lax',
  secure: env.NODE_ENV === 'production'
};

// Opciones con expiración de 12 horas para la sesión del comensal en mesa
const COOKIE_SESSION_OPTIONS = {
  ...COOKIE_BASE_OPTIONS,
  maxAge: 12 * 60 * 60 * 1000
};

/**
 * Emite la cookie firmada HttpOnly con los datos de sesión de la mesa.
 */
function setMesaCookie(res, { mesaId, numero, token }) {
  const payload = JSON.stringify({ mesaId, numero, token });
  res.cookie(MESA_COOKIE_NAME, payload, COOKIE_SESSION_OPTIONS);
}

/**
 * Elimina la cookie de sesión de mesa usando las opciones base sin maxAge
 * para garantizar el borrado correcto en todos los navegadores.
 */
function clearMesaCookie(res) {
  res.clearCookie(MESA_COOKIE_NAME, COOKIE_BASE_OPTIONS);
}

/**
 * Responde 403 Forbidden limpiando cualquier cookie inválida o caducada.
 */
function rechazarSesionMesa(res) {
  clearMesaCookie(res);
  return res.status(403).json({
    status: 'error',
    error: 'Sesión de mesa inválida o expirada. Escanea nuevamente el código QR de tu mesa.'
  });
}

/**
 * Middleware que protege las rutas de cliente verificando exclusivamente
 * la cookie firmada contra la base de datos (nunca datos del req.body).
 */
async function requireMesaSession(req, res, next) {
  const rawCookie = req.signedCookies && req.signedCookies[MESA_COOKIE_NAME];

  if (typeof rawCookie !== 'string' || rawCookie.length === 0) {
    return rechazarSesionMesa(res);
  }

  let datosSesion;
  try {
    datosSesion = JSON.parse(rawCookie);
  } catch (parseError) {
    return rechazarSesionMesa(res);
  }

  // Validación estricta de estructura y tipos en la cookie parseada
  if (
    !datosSesion ||
    typeof datosSesion !== 'object' ||
    !Number.isInteger(datosSesion.mesaId) ||
    datosSesion.mesaId <= 0 ||
    !Number.isInteger(datosSesion.numero) ||
    datosSesion.numero <= 0 ||
    typeof datosSesion.token !== 'string' ||
    datosSesion.token.trim().length === 0
  ) {
    return rechazarSesionMesa(res);
  }

  try {
    // Revalidación obligatoria en BD para detectar mesas desactivadas o tokens rotados
    const mesa = await mesaService.validarSesionMesa(
      datosSesion.mesaId,
      datosSesion.numero,
      datosSesion.token
    );

    if (!mesa) {
      return rechazarSesionMesa(res);
    }

    req.mesa = {
      id: mesa.id,
      numero: mesa.numero
    };

    return next();
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  MESA_COOKIE_NAME,
  setMesaCookie,
  clearMesaCookie,
  requireMesaSession
};
