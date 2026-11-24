// Rutas públicas de cliente protegidas mediante cookie firmada de mesa (requireMesaSession)
const express = require('express');
const { z } = require('zod');

const { requireMesaSession } = require('../middlewares/mesaAuth');
const menuService = require('../services/menuService');
const pedidoService = require('../services/pedidoService');
const botService = require('../services/botService');

const router = express.Router();

// Todas las rutas /api/cliente/* requieren sesión válida de mesa verificada en BD
router.use(requireMesaSession);

/**
 * Formatea errores de validación de Zod 4 usando exclusivamente error.issues.
 */
function formatearErrorZod(error) {
  const issues = error.issues || [];
  return issues
    .map((issue) => `${issue.path.join('.') || 'campo'}: ${issue.message}`)
    .join('; ');
}

// Esquemas de validación Zod 4
const itemCarritoSchema = z.object({
  productoId: z.coerce
    .number({ error: 'productoId debe ser un número' })
    .int({ error: 'productoId debe ser un número entero' })
    .positive({ error: 'productoId debe ser mayor a 0' }),
  cantidad: z.coerce
    .number({ error: 'cantidad debe ser un número' })
    .int({ error: 'cantidad debe ser un número entero' })
    .min(1, { error: 'La cantidad mínima es 1' })
    .max(50, { error: 'La cantidad máxima por línea es 50' }),
  notas: z
    .string({ error: 'notas debe ser una cadena de texto' })
    .max(255, { error: 'Las notas no pueden superar 255 caracteres' })
    .optional()
    .default('')
});

const botMensajeSchema = z.object({
  mensaje: z
    .string({ error: 'El mensaje es requerido' })
    .trim()
    .min(1, { error: 'El mensaje no puede estar vacío' })
    .max(400, { error: 'El mensaje no puede superar 400 caracteres' }),
  carritoActual: z
    .array(itemCarritoSchema, { error: 'carritoActual debe ser un arreglo de ítems' })
    .max(50, { error: 'El carrito no puede superar 50 líneas' })
    .optional()
    .default([])
});

const crearPedidoSchema = z.object({
  items: z
    .array(itemCarritoSchema, { error: 'items debe ser un arreglo de productos' })
    .min(1, { error: 'El pedido debe contener al menos 1 producto' })
    .max(50, { error: 'El pedido no puede superar 50 líneas' })
});

// ==========================================
// ENDPOINTS DE CLIENTE (/api/cliente/*)
// ==========================================

// GET /api/cliente/sesion: retorna mesa autenticada, saludo y catálogo activo
router.get('/sesion', async (req, res, next) => {
  try {
    const productosRaw = await menuService.listarProductos({ soloActivos: true });
    const productos = productosRaw.map((p) => ({
      id: p.id,
      nombre: p.nombre,
      categoria: p.categoria,
      descripcion: p.descripcion,
      precio: Number(p.precio),
      tiempo_preparacion: p.tiempo_preparacion,
      activo: p.activo
    }));

    return res.status(200).json({
      mesa: {
        id: req.mesa.id,
        numero: req.mesa.numero
      },
      bienvenida: `¡Bienvenido a la Mesa ${req.mesa.numero}! Dime qué deseas pedir o consulta nuestro menú.`,
      productos
    });
  } catch (error) {
    return next(error);
  }
});

// POST /api/cliente/bot/mensaje: procesa lenguaje natural en español sobre el carrito actual
router.post('/bot/mensaje', async (req, res, next) => {
  try {
    const parsed = botMensajeSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        status: 'error',
        error: formatearErrorZod(parsed.error)
      });
    }

    const resultado = await botService.procesarMensaje({
      mensaje: parsed.data.mensaje,
      carritoActual: parsed.data.carritoActual,
      mesaNumero: req.mesa.numero
    });

    return res.status(200).json(resultado);
  } catch (error) {
    return next(error);
  }
});

// POST /api/cliente/pedidos: crea pedido real en PostgreSQL dentro de una transacción
router.post('/pedidos', async (req, res, next) => {
  try {
    const parsed = crearPedidoSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        status: 'error',
        error: formatearErrorZod(parsed.error)
      });
    }

    const pedido = await pedidoService.crearPedido({
      mesaId: req.mesa.id,
      mesaNumero: req.mesa.numero,
      items: parsed.data.items
    });

    return res.status(201).json({
      status: 'ok',
      mensaje: 'Pedido registrado exitosamente',
      pedido
    });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
