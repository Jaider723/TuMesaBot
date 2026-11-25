// Servicio de gestión de mesas y asignación de tokens QR
const crypto = require('crypto');
const pool = require('../db/pool');
const qrService = require('./qrService');

/**
 * Lista las mesas del restaurante ordenadas por su número.
 * Por defecto retorna únicamente mesas activas (activa = TRUE).
 */
async function listarMesas({ soloActivas = true } = {}) {
  const query = soloActivas
    ? 'SELECT id, numero, token_secreto, sesion_version, activa, creada_en FROM mesas WHERE activa = TRUE ORDER BY numero ASC;'
    : 'SELECT id, numero, token_secreto, sesion_version, activa, creada_en FROM mesas ORDER BY numero ASC;';

  const { rows } = await pool.query(query);
  return rows;
}

/**
 * Obtiene una mesa activa por su identificador único.
 */
async function obtenerMesaPorId(id) {
  const { rows } = await pool.query(
    'SELECT id, numero, token_secreto, sesion_version, activa, creada_en FROM mesas WHERE id = $1 AND activa = TRUE;',
    [id]
  );

  if (rows.length === 0) {
    const error = new Error('Mesa no encontrada o inactiva');
    error.status = 404;
    throw error;
  }

  return rows[0];
}

/**
 * Crea una mesa nueva o reactiva una mesa previamente desactivada.
 * Si ya existe una mesa activa con ese número, responde con conflicto 409.
 * Si existía desactivada, rota su token secreto e incrementa sesion_version.
 */
async function crearMesa(numero) {
  const { rows: existentes } = await pool.query(
    'SELECT id, numero, token_secreto, sesion_version, activa FROM mesas WHERE numero = $1;',
    [numero]
  );

  if (existentes.length > 0) {
    const mesaExistente = existentes[0];
    if (mesaExistente.activa) {
      const error = new Error('Ya existe una mesa activa con ese número');
      error.status = 409;
      throw error;
    }

    // Reactivación con rotación de token secreto e incremento de sesion_version para invalidar sesiones previas
    const nuevoToken = qrService.generarTokenSeguro();
    const { rows: reactivada } = await pool.query(
      'UPDATE mesas SET activa = TRUE, token_secreto = $1, sesion_version = sesion_version + 1 WHERE id = $2 RETURNING id, numero, token_secreto, sesion_version, activa, creada_en;',
      [nuevoToken, mesaExistente.id]
    );

    return reactivada[0];
  }

  // Creación de mesa nueva
  const tokenSecreto = qrService.generarTokenSeguro();
  const { rows: nuevaMesa } = await pool.query(
    'INSERT INTO mesas (numero, token_secreto, activa) VALUES ($1, $2, TRUE) RETURNING id, numero, token_secreto, sesion_version, activa, creada_en;',
    [numero, tokenSecreto]
  );

  return nuevaMesa[0];
}

/**
 * Realiza el borrado lógico de una mesa (activa = FALSE).
 * Evita la eliminación física para mantener la integridad referencial de pedidos pasados.
 */
async function desactivarMesa(id) {
  const { rows } = await pool.query(
    'UPDATE mesas SET activa = FALSE WHERE id = $1 RETURNING id, numero, token_secreto, sesion_version, activa, creada_en;',
    [id]
  );

  if (rows.length === 0) {
    const error = new Error('Mesa no encontrada');
    error.status = 404;
    throw error;
  }

  return rows[0];
}

/**
 * Compara dos tokens de forma segura contra ataques de temporización (timing attacks).
 * Aplica SHA-256 previo a crypto.timingSafeEqual para garantizar buffers de igual longitud.
 */
function compararTokensSeguro(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length === 0 || b.length === 0) {
    return false;
  }
  const hashA = crypto.createHash('sha256').update(a).digest();
  const hashB = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

/**
 * Valida el acceso inicial por QR verificando que la mesa exista, esté activa
 * y el token coincida criptográficamente con el registrado en base de datos.
 */
async function validarAccesoMesa(numero, token) {
  const { rows } = await pool.query(
    'SELECT id, numero, token_secreto, sesion_version, activa FROM mesas WHERE numero = $1 AND activa = TRUE;',
    [numero]
  );

  if (rows.length === 0) {
    return null;
  }

  const mesa = rows[0];
  if (!mesa.activa || !compararTokensSeguro(token, mesa.token_secreto)) {
    return null;
  }

  return {
    id: mesa.id,
    numero: mesa.numero,
    token_secreto: mesa.token_secreto,
    sesion_version: mesa.sesion_version
  };
}

/**
 * Revalida una sesión de mesa existente en base de datos para asegurar que la mesa
 * siga activa, el token esté vigente y sesion_version coincida con la versión actual del turno.
 */
async function validarSesionMesa(mesaId, numero, token, sesionVersion) {
  const { rows } = await pool.query(
    'SELECT id, numero, token_secreto, sesion_version FROM mesas WHERE id = $1 AND numero = $2 AND activa = TRUE;',
    [mesaId, numero]
  );

  if (rows.length === 0) {
    return null;
  }

  const mesa = rows[0];
  if (mesa.sesion_version !== sesionVersion || !compararTokensSeguro(token, mesa.token_secreto)) {
    return null;
  }

  return {
    id: mesa.id,
    numero: mesa.numero,
    sesion_version: mesa.sesion_version
  };
}

/**
 * Incrementa sesion_version de una mesa activa para invalidar inmediatamente
 * todas las cookies de sesiones anteriores sin alterar su código QR físico.
 */
async function liberarMesa(id) {
  const { rows } = await pool.query(
    'UPDATE mesas SET sesion_version = sesion_version + 1 WHERE id = $1 AND activa = TRUE RETURNING id, numero, sesion_version;',
    [id]
  );

  if (rows.length === 0) {
    const error = new Error('Mesa no encontrada o inactiva');
    error.status = 404;
    throw error;
  }

  return rows[0];
}

module.exports = {
  listarMesas,
  obtenerMesaPorId,
  crearMesa,
  desactivarMesa,
  validarAccesoMesa,
  validarSesionMesa,
  liberarMesa
};
