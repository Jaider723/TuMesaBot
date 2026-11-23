// Rutas de la API de Administración (Protegidas)
const express = require('express');
const { z } = require('zod');

const {
  verificarPasswordAdmin,
  setAdminCookie,
  clearAdminCookie,
  requireAdminAuth
} = require('../middlewares/staffAuth');

const menuService = require('../services/menuService');
const mesaService = require('../services/mesaService');
const qrService = require('../services/qrService');

const router = express.Router();

/**
 * Función auxiliar para formatear errores de Zod 4 usando exclusivamente error.issues.
 */
function formatearErrorZod(error) {
  const issues = error.issues || [];
  return issues.map((issue) => `${issue.path.join('.') || 'campo'}: ${issue.message}`).join('; ');
}

// ==========================================
// AUTENTICACIÓN Y SESIÓN ADMIN
// ==========================================

const loginSchema = z.object({
  password: z.string().min(1, 'La contraseña es requerida')
});

router.post('/login', (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      status: 'error',
      error: formatearErrorZod(parsed.error)
    });
  }

  const { password } = parsed.data;
  if (!verificarPasswordAdmin(password)) {
    return res.status(401).json({
      status: 'error',
      error: 'Contraseña incorrecta'
    });
  }

  setAdminCookie(res);
  return res.status(200).json({
    status: 'ok',
    mensaje: 'Autenticación exitosa',
    rol: 'admin'
  });
});

router.post('/logout', (req, res) => {
  clearAdminCookie(res);
  return res.status(200).json({
    status: 'ok',
    mensaje: 'Sesión cerrada correctamente'
  });
});

router.get('/sesion', requireAdminAuth, (req, res) => {
  return res.status(200).json({
    autenticado: true,
    rol: 'admin'
  });
});

// ==========================================
// GESTIÓN DE PRODUCTOS DEL MENÚ
// ==========================================

const idParamSchema = z.coerce
  .number({ invalid_type_error: 'El ID debe ser un número entero' })
  .int('El ID debe ser un número entero')
  .positive('El ID debe ser positivo');

const productoCrearSchema = z.object({
  nombre: z.string().trim().min(1, 'El nombre es requerido').max(120, 'El nombre no puede superar 120 caracteres'),
  categoria: z.enum(['plato', 'bebida'], {
    errorMap: () => ({ message: "La categoría debe ser 'plato' o 'bebida'" })
  }),
  descripcion: z.string().max(500, 'La descripción no puede superar 500 caracteres').optional().default(''),
  precio: z.coerce.number().min(0, 'El precio debe ser mayor o igual a 0'),
  tiempo_preparacion: z.coerce
    .number()
    .int('El tiempo de preparación debe ser un número entero')
    .positive('El tiempo de preparación debe ser mayor a 0')
});

const productoActualizarSchema = z.object({
  nombre: z.string().trim().min(1, 'El nombre no puede estar vacío').max(120).optional(),
  categoria: z.enum(['plato', 'bebida'], {
    errorMap: () => ({ message: "La categoría debe ser 'plato' o 'bebida'" })
  }).optional(),
  descripcion: z.string().max(500).optional(),
  precio: z.coerce.number().min(0, 'El precio debe ser mayor o igual a 0').optional(),
  tiempo_preparacion: z.coerce
    .number()
    .int('El tiempo de preparación debe ser un número entero')
    .positive('El tiempo de preparación debe ser mayor a 0')
    .optional(),
  activo: z.boolean().optional()
});

router.get('/productos', requireAdminAuth, async (req, res, next) => {
  try {
    const soloActivos = req.query.soloActivos === 'true';
    const productos = await menuService.listarProductos({ soloActivos });
    return res.status(200).json(productos);
  } catch (error) {
    next(error);
  }
});

router.post('/productos', requireAdminAuth, async (req, res, next) => {
  try {
    const parsed = productoCrearSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        status: 'error',
        error: formatearErrorZod(parsed.error)
      });
    }

    const nuevoProducto = await menuService.crearProducto(parsed.data);
    return res.status(201).json(nuevoProducto);
  } catch (error) {
    next(error);
  }
});

router.put('/productos/:id', requireAdminAuth, async (req, res, next) => {
  try {
    const idParsed = idParamSchema.safeParse(req.params.id);
    if (!idParsed.success) {
      return res.status(400).json({
        status: 'error',
        error: formatearErrorZod(idParsed.error)
      });
    }

    const bodyParsed = productoActualizarSchema.safeParse(req.body);
    if (!bodyParsed.success) {
      return res.status(400).json({
        status: 'error',
        error: formatearErrorZod(bodyParsed.error)
      });
    }

    const productoActualizado = await menuService.actualizarProducto(idParsed.data, bodyParsed.data);
    return res.status(200).json(productoActualizado);
  } catch (error) {
    next(error);
  }
});

router.delete('/productos/:id', requireAdminAuth, async (req, res, next) => {
  try {
    const idParsed = idParamSchema.safeParse(req.params.id);
    if (!idParsed.success) {
      return res.status(400).json({
        status: 'error',
        error: formatearErrorZod(idParsed.error)
      });
    }

    const productoDesactivado = await menuService.desactivarProducto(idParsed.data);
    return res.status(200).json({
      status: 'ok',
      mensaje: 'Producto desactivado exitosamente',
      producto: productoDesactivado
    });
  } catch (error) {
    next(error);
  }
});

// ==========================================
// GESTIÓN DE MESAS Y CÓDIGOS QR
// ==========================================

const mesaCrearSchema = z.object({
  numero: z.coerce
    .number()
    .int('El número de mesa debe ser un entero')
    .positive('El número de mesa debe ser mayor a 0')
});

router.get('/mesas', requireAdminAuth, async (req, res, next) => {
  try {
    const mesas = await mesaService.listarMesas();
    return res.status(200).json(mesas);
  } catch (error) {
    next(error);
  }
});

router.post('/mesas', requireAdminAuth, async (req, res, next) => {
  try {
    const parsed = mesaCrearSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        status: 'error',
        error: formatearErrorZod(parsed.error)
      });
    }

    const mesa = await mesaService.crearMesa(parsed.data.numero);
    return res.status(201).json(mesa);
  } catch (error) {
    next(error);
  }
});

router.delete('/mesas/:id', requireAdminAuth, async (req, res, next) => {
  try {
    const idParsed = idParamSchema.safeParse(req.params.id);
    if (!idParsed.success) {
      return res.status(400).json({
        status: 'error',
        error: formatearErrorZod(idParsed.error)
      });
    }

    const mesaDesactivada = await mesaService.desactivarMesa(idParsed.data);
    return res.status(200).json({
      status: 'ok',
      mensaje: 'Mesa desactivada exitosamente',
      mesa: mesaDesactivada
    });
  } catch (error) {
    next(error);
  }
});

router.get('/mesas/:id/qr', requireAdminAuth, async (req, res, next) => {
  try {
    const idParsed = idParamSchema.safeParse(req.params.id);
    if (!idParsed.success) {
      return res.status(400).json({
        status: 'error',
        error: formatearErrorZod(idParsed.error)
      });
    }

    const mesa = await mesaService.obtenerMesaPorId(idParsed.data);
    const url = qrService.construirUrlMesa(mesa.numero, mesa.token_secreto);
    const qrDataUrl = await qrService.generarQrDataUrl(url);

    return res.status(200).json({
      mesa_id: mesa.id,
      numero: mesa.numero,
      url,
      qrDataUrl
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
