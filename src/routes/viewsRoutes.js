// Rutas de entrega de vistas HTML del sistema
const path = require('path');
const express = require('express');
const { z } = require('zod');

const mesaService = require('../services/mesaService');
const {
  setMesaCookie,
  clearMesaCookie,
  verificarCookieMesa
} = require('../middlewares/mesaAuth');

const router = express.Router();

const numeroMesaSchema = z
  .string()
  .regex(/^[1-9]\d*$/, 'El número de mesa debe ser un entero positivo')
  .transform((val) => Number(val))
  .refine((num) => Number.isSafeInteger(num) && num > 0);

const tokenQuerySchema = z.string().trim().min(1);

// Entrega del panel de administración
router.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, '../../public/admin.html'));
});

// Entrega del panel de cocina y meseros
router.get('/cocina', (req, res) => {
  res.sendFile(path.join(__dirname, '../../public/cocina.html'));
});

// Acceso del comensal mediante código QR: /mesa/:numero?token=...
router.get('/mesa/:numero', async (req, res, next) => {
  // Evitamos que el navegador cachee respuestas de validación de acceso QR
  res.set('Cache-Control', 'no-store');

  const numeroParsed = numeroMesaSchema.safeParse(req.params.numero);
  const tokenParsed = tokenQuerySchema.safeParse(req.query.token);

  if (!numeroParsed.success || !tokenParsed.success) {
    clearMesaCookie(res);
    return res.status(403).sendFile(path.join(__dirname, '../../public/error-sesion.html'));
  }

  try {
    const mesa = await mesaService.validarAccesoMesa(numeroParsed.data, tokenParsed.data);

    if (!mesa) {
      clearMesaCookie(res);
      return res.status(403).sendFile(path.join(__dirname, '../../public/error-sesion.html'));
    }

    // Emitimos cookie firmada HttpOnly para aislar la sesión y redirigimos a /chat sin exponer el token en la URL
    setMesaCookie(res, {
      mesaId: mesa.id,
      numero: mesa.numero,
      token: mesa.token_secreto,
      sesionVersion: mesa.sesion_version
    });

    return res.redirect(302, '/chat');
  } catch (error) {
    return next(error);
  }
});

// Vista principal del chat para el comensal (protegida por cookie de sesión verificada en BD)
router.get('/chat', async (req, res, next) => {
  res.set('Cache-Control', 'no-store');

  try {
    const mesa = await verificarCookieMesa(req);

    if (!mesa) {
      clearMesaCookie(res);
      return res.status(403).sendFile(path.join(__dirname, '../../public/error-sesion.html'));
    }

    return res.status(200).sendFile(path.join(__dirname, '../../public/cliente.html'));
  } catch (error) {
    return next(error);
  }
});

// Vista explícita de error de sesión (403 Forbidden)
router.get('/error-sesion', (req, res) => {
  res.set('Cache-Control', 'no-store');
  return res.status(403).sendFile(path.join(__dirname, '../../public/error-sesion.html'));
});

module.exports = router;
