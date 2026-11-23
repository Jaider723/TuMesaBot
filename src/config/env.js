// Carga y validación estricta de variables de entorno del sistema
require('dotenv').config();

const requeridas = [
  'DATABASE_URL',
  'BASE_URL',
  'COOKIE_SECRET',
  'ADMIN_PASSWORD',
  'COCINA_PIN'
];

// Identificamos variables faltantes o vacías
const faltantes = requeridas.filter((clave) => {
  const valor = process.env[clave];
  return !valor || valor.trim() === '';
});

if (faltantes.length > 0) {
  console.error('\n======================================================');
  console.error('❌ ERROR FATAL AL INICIAR: Faltan variables de entorno');
  console.error('======================================================');
  faltantes.forEach((clave) => {
    console.error(` - Variable requerida no definida: ${clave}`);
  });
  console.error('\nPor favor, verifica el archivo .env basándote en .env.example.\n');
  process.exit(1);
}

const env = {
  PORT: parseInt(process.env.PORT, 10) || 3000,
  BASE_URL: process.env.BASE_URL.replace(/\/+$/, ''), // Remover slash final si existe
  DATABASE_URL: process.env.DATABASE_URL,
  COOKIE_SECRET: process.env.COOKIE_SECRET,
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD,
  COCINA_PIN: process.env.COCINA_PIN,
  NODE_ENV: process.env.NODE_ENV || 'development'
};

module.exports = Object.freeze(env);
