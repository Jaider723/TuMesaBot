// Gestor centralizado de Socket.IO para comunicación en tiempo real con Cocina y Meseros
const cookieParser = require('cookie-parser');
const env = require('../config/env');
const { COCINA_COOKIE_NAME } = require('../middlewares/staffAuth');

const SALA_COCINA = 'cocina_meseros';

let ioInstance = null;

/**
 * Inicializa Socket.IO con middleware de autenticación por cookie firmada
 * para proteger el acceso en tiempo real a la sala de cocina y meseros.
 */
function initSocket(io) {
  ioInstance = io;
  const parseCookies = cookieParser(env.COOKIE_SECRET);

  // Autenticar cada handshake Socket.IO reutilizando la cookie firmada HttpOnly de cocina
  io.use((socket, next) => {
    parseCookies(socket.request, {}, (err) => {
      if (err) {
        return next(new Error('No autorizado'));
      }

      const signedCookies = socket.request.signedCookies || {};
      if (signedCookies[COCINA_COOKIE_NAME] === 'authenticated') {
        return next();
      }

      return next(new Error('No autorizado'));
    });
  });

  // Unir automáticamente cada conexión autenticada a la sala compartida de cocina/meseros
  io.on('connection', (socket) => {
    socket.join(SALA_COCINA);
  });
}

/**
 * Emite un nuevo pedido confirmado hacia todos los paneles de cocina conectados.
 */
function emitNuevoPedido(pedido) {
  if (!ioInstance) return;
  ioInstance.to(SALA_COCINA).emit('nuevo_pedido', pedido);
}

/**
 * Emite la notificación de pedido listo para recoger.
 */
function emitPedidoListo({ pedidoId, mesaId, mesaNumero, estado = 'listo', completado_en }) {
  if (!ioInstance) return;
  ioInstance.to(SALA_COCINA).emit('pedido_listo', {
    pedidoId,
    mesaId,
    mesaNumero,
    estado,
    completado_en
  });
}

/**
 * Emite una nueva alerta (asistencia de mesero o pedido listo) a la sala cocina_meseros.
 */
function emitNuevaAlerta(alerta) {
  if (!ioInstance) return;
  ioInstance.to(SALA_COCINA).emit('nueva_alerta', alerta);
}

/**
 * Notifica a todos los paneles conectados que una alerta ya fue atendida.
 */
function emitAlertaAtendida({ alertaId, atendida = true }) {
  if (!ioInstance) return;
  ioInstance.to(SALA_COCINA).emit('alerta_atendida', {
    alertaId,
    atendida
  });
}

module.exports = {
  SALA_COCINA,
  initSocket,
  emitNuevoPedido,
  emitPedidoListo,
  emitNuevaAlerta,
  emitAlertaAtendida
};
