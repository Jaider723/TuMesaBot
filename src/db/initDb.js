// Script de inicialización de Base de Datos e inserción idempotente de datos semilla
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const pool = require('./pool');

async function initDb() {
  console.log('🚀 Iniciando proceso de verificación e inicialización de la base de datos...');

  try {
    // 1. Leer y ejecutar el archivo schema.sql sin modificar su contenido original
    const schemaPath = path.join(__dirname, 'schema.sql');
    const schemaSql = fs.readFileSync(schemaPath, 'utf8');

    console.log('📄 Ejecutando DDL de schema.sql en PostgreSQL...');
    await pool.query(schemaSql);
    console.log('✅ Esquema y tablas verificadas/creadas exitosamente.');

    // 2. Verificar e inicializar mesas de forma idempotente
    const { rows: mesasCount } = await pool.query('SELECT COUNT(*) AS total FROM mesas;');
    const totalMesas = parseInt(mesasCount[0].total, 10);

    if (totalMesas === 0) {
      console.log('🌱 Tabla "mesas" vacía. Insertando 3 mesas iniciales con tokens criptográficos...');
      const mesasIniciales = [1, 2, 3];

      for (const numero of mesasIniciales) {
        // Generamos un token secreto criptográficamente seguro de 32 bytes (64 caracteres hex)
        const tokenSecreto = crypto.randomBytes(32).toString('hex');
        await pool.query(
          'INSERT INTO mesas (numero, token_secreto, activa) VALUES ($1, $2, TRUE);',
          [numero, tokenSecreto]
        );
      }
      console.log('✅ 3 mesas creadas correctamente con sus respectivos tokens secretos.');
    } else {
      console.log(`ℹ️ La tabla "mesas" ya cuenta con ${totalMesas} registro(s). No se insertaron duplicados.`);
    }

    // 3. Verificar e inicializar catálogo de productos de forma idempotente
    const { rows: productosCount } = await pool.query('SELECT COUNT(*) AS total FROM productos;');
    const totalProductos = parseInt(productosCount[0].total, 10);

    if (totalProductos === 0) {
      console.log('🌱 Tabla "productos" vacía. Insertando 6 productos del menú (platos y bebidas)...');
      const productosIniciales = [
        {
          nombre: 'Bandeja Paisa Tradicional',
          categoria: 'plato',
          descripcion: 'Frijoles con garra, arroz blanco, carne molida, chicharrón crocante, huevo frito, tajada de plátano maduro y arepa antioqueña.',
          precio: 28000.00,
          tiempo_preparacion: 20
        },
        {
          nombre: 'Hamburguesa Artesanal Especial',
          categoria: 'plato',
          descripcion: 'Carne de res 180g a la parrilla, tocineta ahumada, queso cheddar fundido, lechuga, tomate y salsa de la casa en pan brioche.',
          precio: 22000.00,
          tiempo_preparacion: 15
        },
        {
          nombre: 'Ajiaco Santafereño',
          categoria: 'plato',
          descripcion: 'Sopa típica con tres variedades de papa, pechuga de pollo desmechada, mazorca tierna, guascas, servida con alcaparras y crema de leche.',
          precio: 25000.00,
          tiempo_preparacion: 18
        },
        {
          nombre: 'Porción de Empanadas Colombianas (5 und)',
          categoria: 'plato',
          descripcion: 'Crujientes empanadas de maíz rellenas de carne y papa criolla, acompañadas de ají casero y limón.',
          precio: 12000.00,
          tiempo_preparacion: 10
        },
        {
          nombre: 'Limonada de Coco Frappé',
          categoria: 'bebida',
          descripcion: 'Refrescante bebida cremosa preparada al momento con jugo de limón natural, leche condensada y crema de coco.',
          precio: 9000.00,
          tiempo_preparacion: 5
        },
        {
          nombre: 'Cerveza Club Colombia Dorada',
          categoria: 'bebida',
          descripcion: 'Cerveza lager premium servida bien fría (botella 330ml).',
          precio: 8000.00,
          tiempo_preparacion: 2
        }
      ];

      for (const prod of productosIniciales) {
        await pool.query(
          `INSERT INTO productos (nombre, categoria, descripcion, precio, tiempo_preparacion, activo)
           VALUES ($1, $2, $3, $4, $5, TRUE);`,
          [prod.nombre, prod.categoria, prod.descripcion, prod.precio, prod.tiempo_preparacion]
        );
      }
      console.log('✅ 6 productos del menú insertados exitosamente.');
    } else {
      console.log(`ℹ️ La tabla "productos" ya cuenta con ${totalProductos} registro(s). No se insertaron duplicados.`);
    }

    console.log('🎉 Inicialización de la base de datos completada con éxito.');
  } catch (error) {
    console.error('❌ Error durante la inicialización de la base de datos:', error);
    process.exitCode = 1;
  } finally {
    // Cerramos el pool de conexiones para permitir que el script finalice limpiamente
    console.log('🔌 Cerrando conexión del pool PostgreSQL...');
    await pool.end();
    console.log('👋 Conexión cerrada.');
  }
}

// Ejecutar si se invoca directamente desde terminal o script npm
if (require.main === module) {
  initDb();
}

module.exports = initDb;
