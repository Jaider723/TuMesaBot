// Rutas de la API de Cocina y Meseros (Protegidas con PIN de acceso)
const express = require('express');
const { z } = require('zod');

const {
  verificarPinCocina,
  setCocinaCookie,
  clearCocinaCookie,
  requireCocinaAuth
} = require('../middlewares/staffAuth');

const pedidoService = require('../services/pedidoService');
const alertaService = require('../services/alertaService');
const mesaService = require('../services/mesaService');
const socketManager = require('../sockets/socketManager');

const router = express.Router();

/**
 * Formatea errores de validación de Zod 4 usando exclusivamente error.issues.
 */
function formatearErrorZod(error) {
  const issues = error.issues || [];
  return issues
    .map((issue) => `${issue.path.join('.') || 'campo'}: ${issue.message}`)
    .join('; ');
}

const loginSchema = z.object({
  pin: z
    .union([z.string(), z.number().transform(String)], {
      error: 'El PIN es requerido'
    })
    .pipe(z.string().trim().min(1, { error: 'El PIN es requerido' }))
});

// Validación estricta de ID positivo dentro del rango INTEGER de PostgreSQL (<= 2147483647)
const idParamSchema = z
  .string()
  .regex(/^[1-9]\d*$/, { error: 'El ID debe ser un número entero positivo' })
  .transform(Number)
  .refine((n) => Number.isSafeInteger(n) && n >= 1 && n <= 2147483647, {
    error: 'El ID está fuera de rango válido'
  });

// ==========================================
// AUTENTICACIÓN Y SESIÓN COCINA / MESEROS
// ==========================================

router.post('/login', (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      status: 'error',
      error: formatearErrorZod(parsed.error)
    });
  }

  if (!verificarPinCocina(parsed.data.pin)) {
    return res.status(401).json({
      status: 'error',
      error: 'PIN incorrecto'
    });
  }

  setCocinaCookie(res);
  return res.status(200).json({
    status: 'ok',
    mensaje: 'Autenticación exitosa',
    rol: 'cocina'
  });
});

router.post('/logout', (req, res) => {
  clearCocinaCookie(res);
  return res.status(200).json({
    status: 'ok',
    mensaje: 'Sesión cerrada correctamente'
  });
});

router.get('/sesion', requireCocinaAuth, (req, res) => {
  return res.status(200).json({
    autenticado: true,
    rol: 'cocina'
  });
});

// ==========================================
// OPERACIÓN EN TIEMPO REAL DE COCINA Y MESEROS
// ==========================================

// GET /api/cocina/estado: carga inicial de pedidos pendientes, alertas activas y estado de sesiones por mesa
router.get('/estado', requireCocinaAuth, async (req, res, next) => {
  try {
    const [pedidos, alertas, mesasActivas] = await Promise.all([
      pedidoService.listarPedidosPendientes(),
      alertaService.listarAlertasPendientes(),
      mesaService.listarMesas({ soloActivas: true })
    ]);

    // Exponer únicamente id, numero y sesion_version de mesas activas (nunca token_secreto)
    const mesas = mesasActivas
      .filter((m) => m.activa === true)
      .map((m) => ({
        id: m.id,
        numero: m.numero,
        sesion_version: m.sesion_version
      }));

    return res.status(200).json({
      pedidos,
      alertas,
      mesas
    });
  } catch (error) {
    return next(error);
  }
});

// PATCH /api/cocina/pedidos/:id/listo: finaliza pedido, crea alerta y emite por Socket.IO
router.patch('/pedidos/:id/listo', requireCocinaAuth, async (req, res, next) => {
  try {
    const idParsed = idParamSchema.safeParse(req.params.id);
    if (!idParsed.success) {
      return res.status(400).json({
        status: 'error',
        error: formatearErrorZod(idParsed.error)
      });
    }

    const { pedido, alerta } = await pedidoService.marcarPedidoListo(idParsed.data);

    socketManager.emitPedidoListo({
      pedidoId: pedido.id,
      mesaId: pedido.mesa_id,
      mesaNumero: pedido.mesa_numero,
      estado: 'listo',
      completado_en: pedido.completado_en
    });
    socketManager.emitNuevaAlerta(alerta);

    return res.status(200).json({
      status: 'ok',
      mensaje: 'Pedido marcado como listo',
      pedido,
      alerta
    });
  } catch (error) {
    return next(error);
  }
});

// PATCH /api/cocina/alertas/:id/atender: atiende alerta y emite actualización en tiempo real
router.patch('/alertas/:id/atender', requireCocinaAuth, async (req, res, next) => {
  try {
    const idParsed = idParamSchema.safeParse(req.params.id);
    if (!idParsed.success) {
      return res.status(400).json({
        status: 'error',
        error: formatearErrorZod(idParsed.error)
      });
    }

    const alerta = await alertaService.marcarAlertaAtendida(idParsed.data);

    socketManager.emitAlertaAtendida({
      alertaId: alerta.id,
      atendida: true
    });

    return res.status(200).json({
      status: 'ok',
      mensaje: 'Alerta marcada como atendida',
      alerta
    });
  } catch (error) {
    return next(error);
  }
});

// PATCH /api/cocina/mesas/:id/liberar: invalida sesiones anteriores de la mesa al cambiar de turno
router.patch('/mesas/:id/liberar', requireCocinaAuth, async (req, res, next) => {
  try {
    const idParsed = idParamSchema.safeParse(req.params.id);
    if (!idParsed.success) {
      return res.status(400).json({
        status: 'error',
        error: formatearErrorZod(idParsed.error)
      });
    }

    const mesa = await mesaService.liberarMesa(idParsed.data);

    return res.status(200).json({
      status: 'ok',
      mensaje: `Sesión de la Mesa #${mesa.numero} liberada. Los dispositivos anteriores deberán escanear el QR nuevamente.`,
      mesa
    });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
