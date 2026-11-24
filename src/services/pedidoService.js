// Servicio de cálculo y creación transaccional de pedidos
const pool = require('../db/pool');

/**
 * Calcula costo_total, tiempo_estimado (MÁXIMO entre ítems) y total_items
 * usando los datos vigentes del catálogo de productos.
 * @param {Array<{productoId: number, cantidad: number}>} items
 * @param {Map<number, Object>|Object} mapaProductos
 */
function calcularResumenDesdeProductos(items, mapaProductos) {
  if (!Array.isArray(items) || items.length === 0) {
    return {
      costo_total: 0,
      tiempo_estimado: 0,
      total_items: 0
    };
  }

  let totalCentavos = 0;
  let tiempoMaximo = 0;
  let totalItems = 0;

  for (const item of items) {
    const producto = mapaProductos instanceof Map
      ? mapaProductos.get(item.productoId)
      : mapaProductos[item.productoId];

    if (!producto) {
      const error = new Error(`Producto con ID ${item.productoId} no encontrado o inactivo`);
      error.status = 400;
      throw error;
    }

    const cantidad = Number(item.cantidad);
    const precioCentavos = Math.round(Number(producto.precio) * 100);
    const tiempoPrep = Number(producto.tiempo_preparacion);

    totalCentavos += precioCentavos * cantidad;
    totalItems += cantidad;

    // Regla de negocio: el tiempo estimado es el MÁXIMO de preparación entre los ítems, nunca la suma
    if (tiempoPrep > tiempoMaximo) {
      tiempoMaximo = tiempoPrep;
    }
  }

  return {
    costo_total: Number((totalCentavos / 100).toFixed(2)),
    tiempo_estimado: tiempoMaximo,
    total_items: totalItems
  };
}

/**
 * Registra un nuevo pedido en PostgreSQL dentro de una transacción atómica,
 * recalculando costos y tiempos exclusivamente desde precios vigentes en BD.
 */
async function crearPedido({ mesaId, mesaNumero, items }) {
  if (!Array.isArray(items) || items.length === 0) {
    const error = new Error('El pedido debe contener al menos un producto');
    error.status = 400;
    throw error;
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Consultar productos activos involucrados en una sola consulta parametrizada
    const productoIds = [...new Set(items.map((item) => Number(item.productoId)))];
    const { rows: productosActivos } = await client.query(
      'SELECT id, nombre, categoria, precio, tiempo_preparacion FROM productos WHERE id = ANY($1::int[]) AND activo = TRUE;',
      [productoIds]
    );

    const mapaProductos = new Map(productosActivos.map((prod) => [prod.id, prod]));

    const noDisponibles = productoIds.filter((id) => !mapaProductos.has(id));
    if (noDisponibles.length > 0) {
      const error = new Error(
        `Los siguientes productos no existen o no están disponibles actualmente: ${noDisponibles.join(', ')}`
      );
      error.status = 400;
      throw error;
    }

    // Cálculo seguro en backend usando precios y tiempos actuales de PostgreSQL
    const { costo_total, tiempo_estimado } = calcularResumenDesdeProductos(items, mapaProductos);

    // Insertar cabecera del pedido en estado 'pendiente'
    const { rows: pedidosRows } = await client.query(
      `INSERT INTO pedidos (mesa_id, estado, costo_total, tiempo_estimado)
       VALUES ($1, 'pendiente', $2, $3)
       RETURNING id, mesa_id, estado, costo_total, tiempo_estimado, creado_en;`,
      [mesaId, costo_total, tiempo_estimado]
    );

    const pedido = pedidosRows[0];
    const itemsDetalle = [];

    // Insertar cada línea conservando notas distintas para un mismo producto
    for (const item of items) {
      const producto = mapaProductos.get(Number(item.productoId));
      const cantidad = Number(item.cantidad);
      const precioUnitario = Number(producto.precio);
      const notasLimpias = String(item.notas || '').trim().slice(0, 255);

      const { rows: detalleRows } = await client.query(
        `INSERT INTO detalle_pedido (pedido_id, producto_id, cantidad, precio_unitario, notas)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, producto_id, cantidad, precio_unitario, notas;`,
        [pedido.id, producto.id, cantidad, precioUnitario, notasLimpias]
      );

      const detalle = detalleRows[0];
      itemsDetalle.push({
        id: detalle.id,
        producto_id: detalle.producto_id,
        nombre: producto.nombre,
        cantidad: detalle.cantidad,
        precio_unitario: Number(detalle.precio_unitario),
        notas: detalle.notas
      });
    }

    await client.query('COMMIT');

    return {
      id: pedido.id,
      mesa_id: pedido.mesa_id,
      mesa_numero: mesaNumero,
      estado: pedido.estado,
      costo_total: Number(pedido.costo_total),
      tiempo_estimado: pedido.tiempo_estimado,
      creado_en: pedido.creado_en,
      items: itemsDetalle
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  calcularResumenDesdeProductos,
  crearPedido
};
