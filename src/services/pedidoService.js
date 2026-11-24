// Servicio de cálculo y creación transaccional de pedidos
const pool = require('../db/pool');
const alertaService = require('./alertaService');

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

/**
 * Lista todos los pedidos pendientes junto con sus ítems en orden FIFO sin consultas N+1.
 */
async function listarPedidosPendientes() {
  const { rows: pedidosRows } = await pool.query(
    `SELECT p.id, p.mesa_id, m.numero AS mesa_numero, p.estado, p.costo_total, p.tiempo_estimado, p.creado_en
     FROM pedidos p
     JOIN mesas m ON m.id = p.mesa_id
     WHERE p.estado = 'pendiente'
     ORDER BY p.creado_en ASC, p.id ASC;`
  );

  if (pedidosRows.length === 0) {
    return [];
  }

  const pedidoIds = pedidosRows.map((p) => p.id);
  const { rows: detalleRows } = await pool.query(
    `SELECT dp.id, dp.pedido_id, dp.producto_id, pr.nombre, dp.cantidad, dp.precio_unitario, dp.notas
     FROM detalle_pedido dp
     JOIN productos pr ON pr.id = dp.producto_id
     WHERE dp.pedido_id = ANY($1::int[])
     ORDER BY dp.id ASC;`,
    [pedidoIds]
  );

  const itemsPorPedido = new Map();
  for (const row of detalleRows) {
    if (!itemsPorPedido.has(row.pedido_id)) {
      itemsPorPedido.set(row.pedido_id, []);
    }
    itemsPorPedido.get(row.pedido_id).push({
      id: row.id,
      producto_id: row.producto_id,
      nombre: row.nombre,
      cantidad: row.cantidad,
      precio_unitario: Number(row.precio_unitario),
      notas: row.notas
    });
  }

  return pedidosRows.map((p) => ({
    id: p.id,
    mesa_id: p.mesa_id,
    mesa_numero: p.mesa_numero,
    estado: p.estado,
    costo_total: Number(p.costo_total),
    tiempo_estimado: p.tiempo_estimado,
    creado_en: p.creado_en,
    items: itemsPorPedido.get(p.id) || []
  }));
}

/**
 * Marca un pedido pendiente como 'listo' dentro de una transacción atómica
 * y genera la alerta correspondiente para los meseros.
 */
async function marcarPedidoListo(pedidoId) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Bloqueamos la fila del pedido para evitar procesamiento duplicado concurrente
    const { rows: pedidoRows } = await client.query(
      `SELECT p.id, p.mesa_id, m.numero AS mesa_numero, p.estado
       FROM pedidos p
       JOIN mesas m ON m.id = p.mesa_id
       WHERE p.id = $1
       FOR UPDATE OF p;`,
      [pedidoId]
    );

    if (pedidoRows.length === 0) {
      const error = new Error('Pedido no encontrado');
      error.status = 404;
      throw error;
    }

    const pedidoActual = pedidoRows[0];
    if (pedidoActual.estado !== 'pendiente') {
      const error = new Error('El pedido ya fue procesado anteriormente');
      error.status = 409;
      throw error;
    }

    const { rows: actualizadoRows } = await client.query(
      `UPDATE pedidos
       SET estado = 'listo', completado_en = NOW()
       WHERE id = $1
       RETURNING id, mesa_id, estado, costo_total, tiempo_estimado, creado_en, completado_en;`,
      [pedidoId]
    );

    const pedidoActualizado = actualizadoRows[0];

    const alerta = await alertaService.crearAlerta(
      {
        mesaId: pedidoActual.mesa_id,
        tipo: 'pedido_listo',
        mensaje: `Pedido #${pedidoActualizado.id} de Mesa #${pedidoActual.mesa_numero} está LISTO para recoger`
      },
      client
    );

    await client.query('COMMIT');

    return {
      pedido: {
        id: pedidoActualizado.id,
        mesa_id: pedidoActualizado.mesa_id,
        mesa_numero: pedidoActual.mesa_numero,
        estado: pedidoActualizado.estado,
        costo_total: Number(pedidoActualizado.costo_total),
        tiempo_estimado: pedidoActualizado.tiempo_estimado,
        creado_en: pedidoActualizado.creado_en,
        completado_en: pedidoActualizado.completado_en
      },
      alerta
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
  crearPedido,
  listarPedidosPendientes,
  marcarPedidoListo
};
