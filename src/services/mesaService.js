// Servicio de gestión de mesas y asignación de tokens QR
const pool = require('../db/pool');
const qrService = require('./qrService');

/**
 * Lista todas las mesas activas del restaurante ordenadas por su número.
 */
async function listarMesas() {
  const { rows } = await pool.query(
    'SELECT id, numero, token_secreto, activa, creada_en FROM mesas WHERE activa = TRUE ORDER BY numero ASC;'
  );
  return rows;
}

/**
 * Obtiene una mesa activa por su identificador único.
 */
async function obtenerMesaPorId(id) {
  const { rows } = await pool.query(
    'SELECT id, numero, token_secreto, activa, creada_en FROM mesas WHERE id = $1 AND activa = TRUE;',
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
 * Si existía desactivada, rota su token secreto para anular QRs antiguos.
 */
async function crearMesa(numero) {
  const { rows: existentes } = await pool.query(
    'SELECT id, numero, token_secreto, activa FROM mesas WHERE numero = $1;',
    [numero]
  );

  if (existentes.length > 0) {
    const mesaExistente = existentes[0];
    if (mesaExistente.activa) {
      const error = new Error('Ya existe una mesa activa con ese número');
      error.status = 409;
      throw error;
    }

    // Reactivación con rotación de token secreto para invalidar QRs anteriores
    const nuevoToken = qrService.generarTokenSeguro();
    const { rows: reactivada } = await pool.query(
      'UPDATE mesas SET activa = TRUE, token_secreto = $1 WHERE id = $2 RETURNING id, numero, token_secreto, activa, creada_en;',
      [nuevoToken, mesaExistente.id]
    );

    return reactivada[0];
  }

  // Creación de mesa nueva
  const tokenSecreto = qrService.generarTokenSeguro();
  const { rows: nuevaMesa } = await pool.query(
    'INSERT INTO mesas (numero, token_secreto, activa) VALUES ($1, $2, TRUE) RETURNING id, numero, token_secreto, activa, creada_en;',
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
    'UPDATE mesas SET activa = FALSE WHERE id = $1 RETURNING id, numero, token_secreto, activa, creada_en;',
    [id]
  );

  if (rows.length === 0) {
    const error = new Error('Mesa no encontrada');
    error.status = 404;
    throw error;
  }

  return rows[0];
}

module.exports = {
  listarMesas,
  obtenerMesaPorId,
  crearMesa,
  desactivarMesa
};
