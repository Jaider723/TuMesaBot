-- 1. Mesas del restaurante
CREATE TABLE IF NOT EXISTS mesas (
    id SERIAL PRIMARY KEY,
    numero INTEGER UNIQUE NOT NULL,
    token_secreto VARCHAR(64) UNIQUE NOT NULL,
    activa BOOLEAN DEFAULT TRUE,
    creada_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. Catálogo del menú (platos y bebidas)
CREATE TABLE IF NOT EXISTS productos (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(120) NOT NULL,
    categoria VARCHAR(20) NOT NULL CHECK (categoria IN ('plato', 'bebida')),
    descripcion TEXT DEFAULT '',
    precio NUMERIC(10, 2) NOT NULL CHECK (precio >= 0),
    tiempo_preparacion INTEGER NOT NULL CHECK (tiempo_preparacion > 0),
    activo BOOLEAN DEFAULT TRUE,
    creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3. Pedidos realizados por las mesas
CREATE TABLE IF NOT EXISTS pedidos (
    id SERIAL PRIMARY KEY,
    mesa_id INTEGER NOT NULL REFERENCES mesas(id),
    estado VARCHAR(20) NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'listo', 'cancelado')),
    costo_total NUMERIC(10, 2) NOT NULL,
    tiempo_estimado INTEGER NOT NULL,
    creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completado_en TIMESTAMP
);

-- 4. Detalle de ítems y notas por pedido
CREATE TABLE IF NOT EXISTS detalle_pedido (
    id SERIAL PRIMARY KEY,
    pedido_id INTEGER NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
    producto_id INTEGER NOT NULL REFERENCES productos(id),
    cantidad INTEGER NOT NULL CHECK (cantidad > 0),
    precio_unitario NUMERIC(10, 2) NOT NULL,
    notas VARCHAR(255) DEFAULT ''
);

-- 5. Alertas de asistencia de meseros y avisos de platos listos
CREATE TABLE IF NOT EXISTS alertas (
    id SERIAL PRIMARY KEY,
    mesa_id INTEGER NOT NULL REFERENCES mesas(id),
    tipo VARCHAR(30) NOT NULL CHECK (tipo IN ('asistencia_mesero', 'pedido_listo')),
    mensaje VARCHAR(255) NOT NULL,
    atendida BOOLEAN DEFAULT FALSE,
    creada_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Índices para garantizar respuestas rápidas bajo carga (50 usuarios)
CREATE INDEX IF NOT EXISTS idx_pedidos_estado ON pedidos(estado);
CREATE INDEX IF NOT EXISTS idx_productos_activo ON productos(activo);
CREATE INDEX IF NOT EXISTS idx_alertas_atendida ON alertas(atendida);