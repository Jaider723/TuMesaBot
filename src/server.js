// Servidor principal HTTP con Express y Socket.IO
const http = require('http');
const path = require('path');
const express = require('express');
const { Server } = require('socket.io');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');

const env = require('./config/env');
const pool = require('./db/pool');
const socketManager = require('./sockets/socketManager');

const app = express();
const server = http.createServer(app);

// Inicialización de Socket.IO vinculada al servidor HTTP
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// Configurar autenticación por cookie firmada y sala cocina_meseros
socketManager.initSocket(io);

// Configuración para proxies inversos (Render / Nginx)
app.set('trust proxy', 1);

// Seguridad HTTP: deshabilitamos CSP temporalmente para no bloquear scripts y Tailwind CDN
app.use(helmet({
  contentSecurityPolicy: false
}));

// Middlewares estándar de parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Parsing de cookies firmadas con COOKIE_SECRET
app.use(cookieParser(env.COOKIE_SECRET));

// Servir exclusivamente scripts y hojas de estilo estáticas; los archivos HTML se entregan por rutas
app.use('/js', express.static(path.join(__dirname, '../public/js')));
app.use('/css', express.static(path.join(__dirname, '../public/css')));

// ==========================================
// RUTAS DE LA APLICACIÓN
// ==========================================

// Vistas HTML
const viewsRoutes = require('./routes/viewsRoutes');
app.use('/', viewsRoutes);

// API de Administración
const adminApiRoutes = require('./routes/adminApiRoutes');
app.use('/api/admin', adminApiRoutes);

// API de Cliente (protegida por sesión QR de mesa)
const publicApiRoutes = require('./routes/publicApiRoutes');
app.use('/api/cliente', publicApiRoutes);

// API de Cocina y Meseros (protegida por PIN de cocina)
const cocinaApiRoutes = require('./routes/cocinaApiRoutes');
app.use('/api/cocina', cocinaApiRoutes);

// Endpoint de verificación de salud del sistema y base de datos
app.get('/api/health', async (req, res) => {
  try {
    // Consulta ligera de prueba para verificar conectividad con PostgreSQL
    await pool.query('SELECT 1 AS ok');
    return res.status(200).json({
      status: 'ok',
      db: 'connected'
    });
  } catch (error) {
    console.error('❌ Error de conexión con la base de datos en /api/health:', error.message);
    return res.status(500).json({
      status: 'error',
      db: 'disconnected'
    });
  }
});

// Manejador 404 para rutas de la API no coincidentes (Express 5 compatible: uso de app.use('/api', ...))
app.use('/api', (req, res) => {
  res.status(404).json({
    status: 'error',
    error: 'Ruta de API no encontrada'
  });
});

// Middleware global de manejo de excepciones y errores internos
app.use((err, req, res, next) => {
  const status = err.status || 500;
  const message = status < 500 ? err.message : 'Error interno del servidor';

  if (status >= 500) {
    console.error('❌ Error no controlado en la aplicación:', err);
  }

  res.status(status).json({
    status: 'error',
    error: message
  });
});

// Iniciar la escucha del servidor
server.listen(env.PORT, () => {
  console.log(`\n======================================================`);
  console.log(`🤖 Tu Mesa Bot - Servidor Backend`);
  console.log(`🌍 Entorno: ${env.NODE_ENV}`);
  console.log(`🚀 Servidor escuchando en: ${env.BASE_URL || `http://localhost:${env.PORT}`}`);
  console.log(`🩺 Salud de API: http://localhost:${env.PORT}/api/health`);
  console.log(`======================================================\n`);
});

module.exports = { app, server, io };
