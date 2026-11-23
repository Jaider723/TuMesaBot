// Servicio de gestión del menú y catálogo de productos
const pool = require('../db/pool');

/**
 * Lista los productos de la base de datos ordenados por categoría y nombre.
 * @param {Object} options
 * @param {boolean} options.soloActivos - Si es true, retorna solo productos con activo = TRUE.
 */
async function listarProductos({ soloActivos = false } = {}) {
  const query = soloActivos
    ? 'SELECT id, nombre, categoria, descripcion, precio, tiempo_preparacion, activo, creado_en FROM productos WHERE activo = TRUE ORDER BY categoria ASC, nombre ASC;'
    : 'SELECT id, nombre, categoria, descripcion, precio, tiempo_preparacion, activo, creado_en FROM productos ORDER BY categoria ASC, nombre ASC;';

  const { rows } = await pool.query(query);
  return rows;
}

/**
 * Obtiene un producto por su identificador único.
 */
async function obtenerProductoPorId(id) {
  const { rows } = await pool.query(
    'SELECT id, nombre, categoria, descripcion, precio, tiempo_preparacion, activo, creado_en FROM productos WHERE id = $1;',
    [id]
  );

  if (rows.length === 0) {
    const error = new Error('Producto no encontrado');
    error.status = 404;
    throw error;
  }

  return rows[0];
}

/**
 * Inserta un nuevo producto en el catálogo.
 */
async function crearProducto({ nombre, categoria, descripcion = '', precio, tiempo_preparacion }) {
  const { rows } = await pool.query(
    `INSERT INTO productos (nombre, categoria, descripcion, precio, tiempo_preparacion, activo)
     VALUES ($1, $2, $3, $4, $5, TRUE)
     RETURNING id, nombre, categoria, descripcion, precio, tiempo_preparacion, activo, creado_en;`,
    [nombre.trim(), categoria, descripcion.trim(), precio, tiempo_preparacion]
  );

  return rows[0];
}

/**
 * Actualiza los datos de un producto existente.
 */
async function actualizarProducto(id, datos) {
  // Verificamos primero si existe el producto
  await obtenerProductoPorId(id);

  const { nombre, categoria, descripcion, precio, tiempo_preparacion, activo } = datos;

  const { rows } = await pool.query(
    `UPDATE productos
     SET nombre = COALESCE($1, nombre),
         categoria = COALESCE($2, categoria),
         descripcion = COALESCE($3, descripcion),
         precio = COALESCE($4, precio),
         tiempo_preparacion = COALESCE($5, tiempo_preparacion),
         activo = COALESCE($6, activo)
     WHERE id = $7
     RETURNING id, nombre, categoria, descripcion, precio, tiempo_preparacion, activo, creado_en;`,
    [
      nombre !== undefined ? nombre.trim() : null,
      categoria !== undefined ? categoria : null,
      descripcion !== undefined ? descripcion.trim() : null,
      precio !== undefined ? precio : null,
      tiempo_preparacion !== undefined ? tiempo_preparacion : null,
      activo !== undefined ? activo : null,
      id
    ]
  );

  return rows[0];
}

/**
 * Realiza el borrado lógico de un producto (activo = FALSE).
 * Cumple con la regla de negocio innegociable de no borrar físicamente registros.
 */
async function desactivarProducto(id) {
  const { rows } = await pool.query(
    'UPDATE productos SET activo = FALSE WHERE id = $1 RETURNING id, nombre, categoria, descripcion, precio, tiempo_preparacion, activo, creado_en;',
    [id]
  );

  if (rows.length === 0) {
    const error = new Error('Producto no encontrado');
    error.status = 404;
    throw error;
  }

  return rows[0];
}

module.exports = {
  listarProductos,
  obtenerProductoPorId,
  crearProducto,
  actualizarProducto,
  desactivarProducto
};
