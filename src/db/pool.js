// Configuración del Pool de conexiones a PostgreSQL (Neon)
const { Pool } = require('pg');
const env = require('../config/env');

// Configuramos SSL con rejectUnauthorized: false para compatibilidad directa con Neon
const pool = new Pool({
  connectionString: env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

// Manejo de eventos de error en clientes inactivos para prevenir caídas silenciosas
pool.on('error', (err) => {
  console.error('❌ Error inesperado en cliente inactivo del pool de PostgreSQL:', err.message);
});

module.exports = pool;
