// Servicio de gestión de alertas para asistencia de meseros y pedidos listos
const pool = require('../db/pool');

/**
 * Registra una alerta y la retorna enriquecida con el número de mesa.
 * Acepta un dbClient opcional para integrarse dentro de transacciones SQL existentes.
 */
async function crearAlerta({ mesaId, tipo, mensaje }, dbClient = pool) {
  const mensajeLimpio = String(mensaje || '').trim().slice(0, 255);

  const { rows } = await dbClient.query(
    `WITH nueva_alerta AS (
       INSERT INTO alertas (mesa_id, tipo, mensaje, atendida)
       VALUES ($1, $2, $3, FALSE)
       RETURNING id, mesa_id, tipo, mensaje, atendida, creada_en
     )
     SELECT a.id, a.mesa_id, m.numero AS mesa_numero, a.tipo, a.mensaje, a.atendida, a.creada_en
     FROM nueva_alerta a
     JOIN mesas m ON m.id = a.mesa_id;`,
    [mesaId, tipo, mensajeLimpio]
  );

  return rows[0];
}

/**
 * Lista las alertas pendientes (atendida = FALSE) ordenadas de más reciente a más antigua.
 */
async function listarAlertasPendientes() {
  const { rows } = await pool.query(
    `SELECT a.id, a.mesa_id, m.numero AS mesa_numero, a.tipo, a.mensaje, a.atendida, a.creada_en
     FROM alertas a
     JOIN mesas m ON m.id = a.mesa_id
     WHERE a.atendida = FALSE
     ORDER BY a.creada_en DESC, a.id DESC;`
  );

  return rows;
}

/**
 * Marca una alerta como atendida y retorna el registro actualizado con mesa_numero.
 */
async function marcarAlertaAtendida(id) {
  const { rows } = await pool.query(
    `WITH actualizada AS (
       UPDATE alertas
       SET atendida = TRUE
       WHERE id = $1
       RETURNING id, mesa_id, tipo, mensaje, atendida, creada_en
     )
     SELECT a.id, a.mesa_id, m.numero AS mesa_numero, a.tipo, a.mensaje, a.atendida, a.creada_en
     FROM actualizada a
     JOIN mesas m ON m.id = a.mesa_id;`,
    [id]
  );

  if (rows.length === 0) {
    const error = new Error('Alerta no encontrada');
    error.status = 404;
    throw error;
  }

  return rows[0];
}

module.exports = {
  crearAlerta,
  listarAlertasPendientes,
  marcarAlertaAtendida
};
