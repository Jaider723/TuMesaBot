// Motor conversacional local sin estado en RAM para el asistente de pedidos
const menuService = require('./menuService');
const pedidoService = require('./pedidoService');

const MAX_CANTIDAD_POR_LINEA = 50;

// Palabras funcionales ignoradas al indexar palabras clave de nombres de productos
const STOPWORDS = new Set([
  'de', 'del', 'la', 'el', 'las', 'los', 'con', 'sin', 'por', 'para',
  'en', 'y', 'e', 'o', 'u', 'a', 'al', 'un', 'una', 'unos', 'unas',
  'porcion', 'porciones', 'und', 'unidad', 'unidades', 'ml', 'gr', 'g'
]);

// Stopwords que pueden omitirse dentro de una misma frase de producto (ej. "limonada de coco")
const STOPWORDS_INTERNOS = new Set(['de', 'del', 'la', 'el', 'las', 'los', 'con', 'a', 'al', 'en']);

// Unidades de medida opcionales entre la cantidad y el nombre del producto
const UNIDADES_OPCIONALES = new Set([
  'porcion', 'porciones', 'plato', 'platos', 'vaso', 'vasos',
  'botella', 'botellas', 'unidad', 'unidades', 'orden', 'ordenes'
]);

// Diccionario de cantidades escritas en español
const PALABRAS_CANTIDAD = {
  un: 1,
  una: 1,
  uno: 1,
  dos: 2,
  tres: 3,
  cuatro: 4,
  cinco: 5,
  seis: 6,
  siete: 7,
  ocho: 8,
  nueve: 9,
  diez: 10
};

// Palabras de cortesía, comandos e intenciones que nunca deben hacer match difuso como producto
const PALABRAS_NO_PRODUCTO = new Set([
  'quiero', 'quisiera', 'regalas', 'regalame', 'dame', 'deme', 'pido', 'pedir',
  'pedido', 'favor', 'gracias', 'hola', 'buenas', 'buenos', 'dias', 'tardes',
  'noches', 'ayuda', 'confirmar', 'confirmo', 'enviar', 'listo', 'vaciar',
  'cancelar', 'borrar', 'quitar', 'quita', 'eliminar', 'elimina', 'sacar',
  'remover', 'mesero', 'camarero', 'asistencia', 'menu', 'carta', 'platos',
  'bebidas', 'resumen', 'carrito', 'cuenta', 'total', 'cebolla', 'tomate',
  'hielo', 'salsa', 'sal', 'azucar', 'limon'
]);

/**
 * Normaliza un texto a minúsculas y elimina tildes/diacríticos (NFD).
 */
function normalizarTexto(texto) {
  return String(texto || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/**
 * Genera variantes singulares básicas en español para mejorar el emparejamiento.
 */
function obtenerVariantesSingulares(palabra) {
  const variantes = [palabra];
  if (palabra.length <= 3) {
    return variantes;
  }

  if (palabra.endsWith('ces') && palabra.length > 4) {
    variantes.push(palabra.slice(0, -3) + 'z');
  }
  if (palabra.endsWith('ones') && palabra.length > 5) {
    variantes.push(palabra.slice(0, -4) + 'on');
  }
  if (palabra.endsWith('es') && palabra.length > 4) {
    variantes.push(palabra.slice(0, -2));
  }
  if (palabra.endsWith('s')) {
    variantes.push(palabra.slice(0, -1));
  }

  return [...new Set(variantes)];
}

/**
 * Calcula la distancia de edición de Levenshtein entre dos cadenas.
 */
function calcularLevenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const costo = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + costo
      );
    }
  }

  return dp[m][n];
}

/**
 * Evalúa si un token del mensaje coincide con una palabra clave del producto.
 * Retorna un puntaje (> 0) o 0 si no hay coincidencia.
 */
function puntuarCoincidenciaPalabra(tokenNorm, kwVariantes) {
  if (!tokenNorm || STOPWORDS.has(tokenNorm) || /^\d+$/.test(tokenNorm)) {
    return 0;
  }

  const tokenVariantes = obtenerVariantesSingulares(tokenNorm);

  // 1. Coincidencia exacta o por singularización
  for (const tv of tokenVariantes) {
    if (kwVariantes.includes(tv)) {
      return tv === tokenNorm ? 1.0 : 0.98;
    }
  }

  // 2. Tolerancia a 1 error tipográfico únicamente en palabras de 5+ letras
  if (!PALABRAS_NO_PRODUCTO.has(tokenNorm) && tokenNorm.length >= 5) {
    for (const tv of tokenVariantes) {
      if (tv.length < 5) continue;
      for (const kv of kwVariantes) {
        if (kv.length < 5) continue;
        if (Math.abs(tv.length - kv.length) <= 1 && calcularLevenshtein(tv, kv) <= 1) {
          return 0.85;
        }
      }
    }
  }

  return 0;
}

/**
 * Indexa las palabras clave relevantes de cada producto activo del catálogo.
 */
function construirIndiceProductos(productosActivos) {
  return productosActivos.map((producto) => {
    const nombreNorm = normalizarTexto(producto.nombre);
    const palabras = nombreNorm.match(/[a-z0-9]+/g) || [];

    const keywords = [];
    for (const palabra of palabras) {
      if (!STOPWORDS.has(palabra) && !/^\d+$/.test(palabra)) {
        keywords.push({
          base: palabra,
          variantes: obtenerVariantesSingulares(palabra)
        });
      }
    }

    return {
      producto,
      keywords
    };
  });
}

/**
 * Tokeniza el mensaje conservando las posiciones exactas de inicio y fin
 * sobre la cadena original para extraer notas legibles.
 */
function tokenizarMensaje(mensaje) {
  const regex = /[a-zA-ZáéíóúÁÉÍÓÚñÑüÜ0-9]+/g;
  const tokens = [];
  let match;

  while ((match = regex.exec(mensaje)) !== null) {
    const raw = match[0];
    const norm = normalizarTexto(raw);
    tokens.push({
      raw,
      norm,
      start: match.index,
      end: match.index + raw.length,
      index: tokens.length
    });
  }

  return tokens;
}

/**
 * Verifica si el contexto inmediato previo al token indica un modificador de nota
 * (por ejemplo "sin queso" o "con poco hielo") y no un nuevo producto.
 */
function esContextoDeNota(tokens, index) {
  if (index <= 0) return false;
  const prev = tokens[index - 1].norm;

  if (prev === 'sin') {
    return true;
  }

  const intensificadores = new Set(['poco', 'poca', 'mucho', 'mucha', 'bastante', 'doble', 'extra', 'mas', 'menos']);
  if (intensificadores.has(prev)) {
    return true;
  }

  if (index >= 2 && tokens[index - 2].norm === 'sin') {
    return true;
  }

  return false;
}

/**
 * Ubica anclas de productos en el mensaje priorizando coincidencias más largas
 * y detectando empates para desambiguación.
 */
function detectarAnclasProductos(tokens, indiceProductos) {
  const gruposPorPosicion = [];

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];

    if (
      STOPWORDS.has(token.norm) ||
      /^\d+$/.test(token.norm) ||
      PALABRAS_CANTIDAD[token.norm] !== undefined ||
      PALABRAS_NO_PRODUCTO.has(token.norm) ||
      esContextoDeNota(tokens, i)
    ) {
      continue;
    }

    const candidatos = [];

    for (const entry of indiceProductos) {
      let mejorPuntajeInicial = 0;
      let idxKeywordInicial = -1;

      for (let k = 0; k < entry.keywords.length; k++) {
        const puntaje = puntuarCoincidenciaPalabra(token.norm, entry.keywords[k].variantes);
        if (puntaje > mejorPuntajeInicial) {
          mejorPuntajeInicial = puntaje;
          idxKeywordInicial = k;
        }
      }

      if (mejorPuntajeInicial === 0) continue;

      // Intentar extender el ancla hacia adelante si las siguientes palabras pertenecen al mismo producto
      const usados = new Set([idxKeywordInicial]);
      let scoreTotal = mejorPuntajeInicial;
      let spanEnd = i;
      let saltosStopwords = 0;

      for (let j = i + 1; j < tokens.length; j++) {
        const sig = tokens[j];

        if (/^\d+$/.test(sig.norm) || PALABRAS_CANTIDAD[sig.norm] !== undefined) {
          break;
        }

        if (STOPWORDS_INTERNOS.has(sig.norm)) {
          saltosStopwords++;
          if (saltosStopwords > 2) break;
          continue;
        }

        if (STOPWORDS.has(sig.norm)) {
          break;
        }

        let mejorSiguiente = 0;
        let idxSigKw = -1;
        for (let k = 0; k < entry.keywords.length; k++) {
          if (usados.has(k)) continue;
          const p = puntuarCoincidenciaPalabra(sig.norm, entry.keywords[k].variantes);
          if (p > mejorSiguiente) {
            mejorSiguiente = p;
            idxSigKw = k;
          }
        }

        if (mejorSiguiente > 0) {
          usados.add(idxSigKw);
          scoreTotal += mejorSiguiente;
          spanEnd = j;
          saltosStopwords = 0;
        } else {
          break;
        }
      }

      candidatos.push({
        producto: entry.producto,
        score: Number(scoreTotal.toFixed(4)),
        matchedCount: usados.size,
        spanStart: i,
        spanEnd
      });
    }

    if (candidatos.length === 0) continue;

    // Obtener el puntaje máximo en esta posición y detectar posibles empates
    const maxScore = Math.max(...candidatos.map((c) => c.score));
    const mejores = candidatos.filter((c) => Math.abs(c.score - maxScore) < 0.0001);
    const maxSpanEnd = Math.max(...mejores.map((c) => c.spanEnd));

    gruposPorPosicion.push({
      spanStart: i,
      spanEnd: maxSpanEnd,
      score: maxScore,
      spanLength: maxSpanEnd - i + 1,
      candidates: mejores.map((m) => m.producto)
    });
  }

  // Seleccionar anclas no solapadas dando prioridad a mayor puntaje y coincidencia más larga
  gruposPorPosicion.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.spanLength !== a.spanLength) return b.spanLength - a.spanLength;
    return a.spanStart - b.spanStart;
  });

  const seleccionadas = [];
  for (const grupo of gruposPorPosicion) {
    const seSolapa = seleccionadas.some(
      (s) => !(grupo.spanEnd < s.spanStart || grupo.spanStart > s.spanEnd)
    );
    if (!seSolapa) {
      seleccionadas.push(grupo);
    }
  }

  // Ordenar de izquierda a derecha según su aparición en la frase
  seleccionadas.sort((a, b) => a.spanStart - b.spanStart);
  return seleccionadas;
}

/**
 * Extrae cantidad (dígito o texto) y límites del segmento de texto que precede al ancla.
 */
function resolverCantidadYSegmento(tokens, anchor, prevAnchorEnd) {
  let unitStart = anchor.spanStart;

  // Omitir palabras opcionales de unidad como "porción de" justo antes del producto
  if (unitStart - 1 > prevAnchorEnd && tokens[unitStart - 1].norm === 'de') {
    if (unitStart - 2 > prevAnchorEnd && UNIDADES_OPCIONALES.has(tokens[unitStart - 2].norm)) {
      unitStart = unitStart - 2;
    }
  } else if (unitStart - 1 > prevAnchorEnd && UNIDADES_OPCIONALES.has(tokens[unitStart - 1].norm)) {
    unitStart = unitStart - 1;
  }

  let cantidad = 1;
  let segmentStart = unitStart;
  let cantidadLimitada = false;

  const idxQty = unitStart - 1;
  if (idxQty > prevAnchorEnd) {
    const tokenQty = tokens[idxQty];
    if (/^\d+$/.test(tokenQty.norm)) {
      const val = parseInt(tokenQty.norm, 10);
      if (val > 0) {
        if (val > MAX_CANTIDAD_POR_LINEA) {
          cantidad = MAX_CANTIDAD_POR_LINEA;
          cantidadLimitada = true;
        } else {
          cantidad = val;
        }
        segmentStart = idxQty;
      }
    } else if (PALABRAS_CANTIDAD[tokenQty.norm] !== undefined) {
      cantidad = PALABRAS_CANTIDAD[tokenQty.norm];
      segmentStart = idxQty;
    }
  }

  return {
    cantidad,
    cantidadLimitada,
    segmentStart
  };
}

/**
 * Limpia conectores sobrantes en los extremos de una nota sin eliminar preposiciones internas
 * ni conectores compuestos como "sin cebolla y sin tomate".
 */
function limpiarNota(textoCrudo) {
  let nota = String(textoCrudo || '').trim();

  let anterior;
  do {
    anterior = nota;
    // Quitar puntuación suelta en extremos
    nota = nota.replace(/^[\s,.;:!?-]+|[\s,.;:!?-]+$/g, '');
    // Quitar conectores sueltos al inicio si precedían a otro producto (ej. ", sin cebolla" o "y sin cebolla")
    nota = nota.replace(/^(?:y|e)\s+/i, '');
    // Quitar conectores sueltos y cortesías al final de la nota (antes del siguiente ítem o fin de frase)
    nota = nota.replace(/(?:\s+|^)(?:y|e|o|con|tambien|también|ademas|además|por\s+favor|porfa|gracias)$/i, '');
    nota = nota.trim();
  } while (nota !== anterior);

  return nota.slice(0, 255);
}

/**
 * Valida, normaliza y recalcula el carrito recibido desde el cliente contra los productos activos de la BD.
 */
function sanitizarYRecalcularCarrito(carritoActual, mapaProductos) {
  const lineas = [];

  if (Array.isArray(carritoActual)) {
    for (const item of carritoActual) {
      if (!item || typeof item !== 'object') continue;
      const prodId = Number(item.productoId);
      const producto = mapaProductos.get(prodId);
      if (!producto) continue;

      const cantidadRaw = Math.trunc(Number(item.cantidad));
      if (!Number.isFinite(cantidadRaw) || cantidadRaw < 1) continue;
      const cantidad = Math.min(MAX_CANTIDAD_POR_LINEA, cantidadRaw);
      const notas = String(item.notas || '').trim().slice(0, 255);

      const claveNota = normalizarTexto(notas);
      const existente = lineas.find(
        (l) => l.productoId === prodId && normalizarTexto(l.notas) === claveNota
      );

      if (existente) {
        existente.cantidad = Math.min(MAX_CANTIDAD_POR_LINEA, existente.cantidad + cantidad);
        existente.subtotal = Number((existente.precioUnitario * existente.cantidad).toFixed(2));
      } else {
        const precioUnitario = Number(producto.precio);
        lineas.push({
          productoId: producto.id,
          nombre: producto.nombre,
          precioUnitario,
          tiempoPreparacion: Number(producto.tiempo_preparacion),
          cantidad,
          notas,
          subtotal: Number((precioUnitario * cantidad).toFixed(2))
        });
      }
    }
  }

  const resumen = pedidoService.calcularResumenDesdeProductos(lineas, mapaProductos);
  return { carrito: lineas, resumen };
}

/**
 * Fusiona un nuevo ítem en el carrito respetando notas diferenciadas y límite máximo por línea (1..50).
 */
function fusionarItemEnCarrito(carrito, producto, cantidad, notas, mapaProductos) {
  const nuevoCarrito = carrito.map((item) => ({ ...item }));
  const notaLimpia = String(notas || '').trim().slice(0, 255);
  const claveNota = normalizarTexto(notaLimpia);

  const existente = nuevoCarrito.find(
    (l) => l.productoId === producto.id && normalizarTexto(l.notas) === claveNota
  );

  let fueLimitado = false;

  if (existente) {
    const suma = existente.cantidad + cantidad;
    if (suma > MAX_CANTIDAD_POR_LINEA) {
      existente.cantidad = MAX_CANTIDAD_POR_LINEA;
      fueLimitado = true;
    } else {
      existente.cantidad = suma;
    }
    existente.subtotal = Number((existente.precioUnitario * existente.cantidad).toFixed(2));
  } else {
    const cantidadFinal = Math.min(MAX_CANTIDAD_POR_LINEA, Math.max(1, cantidad));
    if (cantidad > MAX_CANTIDAD_POR_LINEA) fueLimitado = true;

    const precioUnitario = Number(producto.precio);
    nuevoCarrito.push({
      productoId: producto.id,
      nombre: producto.nombre,
      precioUnitario,
      tiempoPreparacion: Number(producto.tiempo_preparacion),
      cantidad: cantidadFinal,
      notas: notaLimpia,
      subtotal: Number((precioUnitario * cantidadFinal).toFixed(2))
    });
  }

  const resumen = pedidoService.calcularResumenDesdeProductos(nuevoCarrito, mapaProductos);
  return { carrito: nuevoCarrito, resumen, fueLimitado };
}

/**
 * Construye los botones de acción rápida sugeridos para el frontend según el estado del carrito.
 */
function obtenerBotonesRapidos(carrito, accion) {
  if (accion === 'desambiguar') {
    return ['Ver menú', 'Solicitar mesero'];
  }
  if (carrito.length > 0) {
    return ['Confirmar pedido', 'Ver menú', 'Vaciar pedido'];
  }
  return ['Ver menú', 'Solicitar mesero'];
}

/**
 * Formatea valores monetarios en COP de forma legible.
 */
function formatearCOP(valor) {
  return `$${Math.round(Number(valor)).toLocaleString('es-CO')}`;
}

/**
 * Formatea una respuesta estándar garantizando siempre los 6 campos del contrato.
 */
function construirRespuesta({
  accion,
  respuestaBot,
  carritoActualizado,
  resumen,
  opcionesDesambiguacion = [],
  botonesRapidos
}) {
  return {
    accion,
    respuestaBot,
    carritoActualizado,
    resumen,
    opcionesDesambiguacion,
    botonesRapidos: botonesRapidos || obtenerBotonesRapidos(carritoActualizado, accion)
  };
}

/**
 * Función pura de procesamiento conversacional sobre un catálogo en memoria.
 * Facilita pruebas unitarias de desambiguación sin alterar la base de datos.
 */
function procesarMensajeConCatalogo({ mensaje, carritoActual = [], mesaNumero, productosActivos }) {
  const mapaProductos = new Map(productosActivos.map((p) => [p.id, p]));
  let { carrito, resumen } = sanitizarYRecalcularCarrito(carritoActual, mapaProductos);

  const textoOriginal = String(mensaje || '').trim();
  const textoNorm = normalizarTexto(textoOriginal);
  const tokens = tokenizarMensaje(textoOriginal);
  const indiceProductos = construirIndiceProductos(productosActivos);

  // 1. Detección explícita de quitar/eliminar ítems del carrito
  const esComandoQuitar = /\b(quitar|quita|eliminar|elimina|sacar|saca|remover|remueve|borrar|borra|ya\s+no\s+quiero|cancela\s+(?:el|la|los|las))\b/.test(textoNorm) &&
    !/\b(cancelar\s+todo|borrar\s+todo|borrar\s+pedido|vaciar)\b/.test(textoNorm);

  if (esComandoQuitar) {
    const anclas = detectarAnclasProductos(tokens, indiceProductos);
    if (anclas.length > 0) {
      let eliminados = [];
      let prevEnd = -1;

      for (const anchor of anclas) {
        const tieneCantidadExplicita = (() => {
          const prevIdx = anchor.spanStart - 1;
          if (prevIdx > prevEnd) {
            return /^\d+$/.test(tokens[prevIdx].norm) || PALABRAS_CANTIDAD[tokens[prevIdx].norm] !== undefined;
          }
          return false;
        })();

        const { cantidad } = resolverCantidadYSegmento(tokens, anchor, prevEnd);
        prevEnd = anchor.spanEnd;

        const idsCandidatos = new Set(anchor.candidates.map((c) => c.id));
        const indiceEnCarrito = carrito.findIndex((item) => idsCandidatos.has(item.productoId));

        if (indiceEnCarrito !== -1) {
          const itemActual = carrito[indiceEnCarrito];
          if (tieneCantidadExplicita && itemActual.cantidad > cantidad) {
            itemActual.cantidad -= cantidad;
            itemActual.subtotal = Number((itemActual.precioUnitario * itemActual.cantidad).toFixed(2));
            eliminados.push(`${cantidad}x ${itemActual.nombre}`);
          } else {
            carrito = carrito.filter((item) => !idsCandidatos.has(item.productoId));
            eliminados.push(itemActual.nombre);
          }
        }
      }

      resumen = pedidoService.calcularResumenDesdeProductos(carrito, mapaProductos);

      if (eliminados.length > 0) {
        return construirRespuesta({
          accion: 'quitar_item',
          respuestaBot: `Listo, retiré ${eliminados.join(', ')} de tu pedido. ${
            carrito.length > 0
              ? `Tu nuevo total es ${formatearCOP(resumen.costo_total)}.`
              : 'Tu carrito quedó vacío.'
          }`,
          carritoActualizado: carrito,
          resumen
        });
      }

      return construirRespuesta({
        accion: 'quitar_item',
        respuestaBot: 'No encontré ese producto en tu pedido actual. Puedes revisar tu resumen con "Mi pedido".',
        carritoActualizado: carrito,
        resumen
      });
    }
  }

  // 2. Detección de solicitud de asistencia de mesero (cuando no se están pidiendo platos)
  const anclasDetectadas = detectarAnclasProductos(tokens, indiceProductos);

  if (anclasDetectadas.length === 0 && /\b(mesero|camarero|mozo|asistencia|necesito\s+ayuda)\b/.test(textoNorm)) {
    return construirRespuesta({
      accion: 'solicitar_mesero',
      respuestaBot: `Con mucho gusto. Puedes confirmar la solicitud de asistencia para la Mesa ${mesaNumero || ''} usando el botón de Mesero.`,
      carritoActualizado: carrito,
      resumen,
      botonesRapidos: ['Llamar mesero', 'Ver menú', ...(carrito.length > 0 ? ['Confirmar pedido'] : [])]
    });
  }

  // 3. Detección de vaciar carrito
  if (anclasDetectadas.length === 0 && /\b(vaciar|limpiar\s*(?:el\s*)?(?:carrito|pedido)|cancelar\s+todo|borrar\s+(?:todo|el\s+pedido|pedido)|empezar\s+de\s+nuevo)\b/.test(textoNorm)) {
    const carritoVacio = [];
    const resumenVacio = pedidoService.calcularResumenDesdeProductos(carritoVacio, mapaProductos);
    return construirRespuesta({
      accion: 'vaciar_carrito',
      respuestaBot: 'He vaciado tu pedido actual. Cuando quieras, dime qué deseas ordenar del menú.',
      carritoActualizado: carritoVacio,
      resumen: resumenVacio
    });
  }

  // 4. Procesar anclas de productos detectadas en la frase (agregar_items o desambiguar)
  if (anclasDetectadas.length > 0) {
    const resueltos = [];
    let prevAnchorEnd = -1;

    for (let idx = 0; idx < anclasDetectadas.length; idx++) {
      const anchor = anclasDetectadas[idx];
      const { cantidad, cantidadLimitada, segmentStart } = resolverCantidadYSegmento(tokens, anchor, prevAnchorEnd);
      resueltos.push({
        anchor,
        cantidad,
        cantidadLimitada,
        segmentStart
      });
      prevAnchorEnd = anchor.spanEnd;
    }

    // Extraer notas usando los límites entre el fin del ancla actual y el inicio del siguiente segmento
    const itemsConNotas = resueltos.map((item, idx) => {
      const inicioNota = tokens[item.anchor.spanEnd].end;
      const finNota = idx + 1 < resueltos.length
        ? tokens[resueltos[idx + 1].segmentStart].start
        : textoOriginal.length;

      const notas = limpiarNota(textoOriginal.slice(inicioNota, finNota));
      return {
        ...item,
        notas
      };
    });

    const agregadosTexto = [];
    let primerAmbiguo = null;
    let huboLimiteCantidad = false;

    for (const item of itemsConNotas) {
      if (item.cantidadLimitada) huboLimiteCantidad = true;

      if (item.anchor.candidates.length > 1) {
        if (!primerAmbiguo) {
          primerAmbiguo = item;
        }
        continue;
      }

      const prod = item.anchor.candidates[0];
      const resultadoMerge = fusionarItemEnCarrito(carrito, prod, item.cantidad, item.notas, mapaProductos);
      carrito = resultadoMerge.carrito;
      resumen = resultadoMerge.resumen;
      if (resultadoMerge.fueLimitado) huboLimiteCantidad = true;

      const detalleNota = item.notas ? ` (${item.notas})` : '';
      agregadosTexto.push(`${item.cantidad}x ${prod.nombre}${detalleNota}`);
    }

    if (primerAmbiguo) {
      const opcionesDesambiguacion = primerAmbiguo.anchor.candidates.map((prod) => ({
        productoId: prod.id,
        nombre: prod.nombre,
        precio: Number(prod.precio),
        tiempo_preparacion: Number(prod.tiempo_preparacion),
        cantidadDetectada: primerAmbiguo.cantidad,
        notasDetectadas: primerAmbiguo.notas
      }));

      const prefijo = agregadosTexto.length > 0
        ? `Agregué ${agregadosTexto.join(' y ')}. `
        : '';

      return construirRespuesta({
        accion: 'desambiguar',
        respuestaBot: `${prefijo}Encontré varias opciones que coinciden con tu solicitud. ¿Cuál de estas deseas?`,
        carritoActualizado: carrito,
        resumen,
        opcionesDesambiguacion
      });
    }

    const avisoLimite = huboLimiteCantidad
      ? ` (Se aplicó el límite máximo de ${MAX_CANTIDAD_POR_LINEA} unidades por línea).`
      : '';

    return construirRespuesta({
      accion: 'agregar_items',
      respuestaBot: `¡Perfecto! Agregué a tu pedido: ${agregadosTexto.join(', ')}.${avisoLimite} Total actual: ${formatearCOP(resumen.costo_total)} (tiempo estimado: ${resumen.tiempo_estimado} min).`,
      carritoActualizado: carrito,
      resumen
    });
  }

  // 5. Confirmar pedido (solo si no se agregaron nuevos productos)
  if (/\b(confirmar|confirmo|enviar\s+pedido|hacer\s+pedido|pedir\s+ya|finalizar|listo|eso\s+es\s+todo|terminar)\b/.test(textoNorm)) {
    if (carrito.length === 0) {
      return construirRespuesta({
        accion: 'confirmar_pedido',
        respuestaBot: 'Tu pedido aún está vacío. Escríbeme qué deseas ordenar antes de confirmar.',
        carritoActualizado: carrito,
        resumen
      });
    }

    return construirRespuesta({
      accion: 'confirmar_pedido',
      respuestaBot: `Tu pedido de ${resumen.total_items} producto(s) por ${formatearCOP(resumen.costo_total)} (tiempo estimado: ${resumen.tiempo_estimado} min) está listo para enviarse a cocina.`,
      carritoActualizado: carrito,
      resumen
    });
  }

  // 6. Ver resumen del carrito
  if (/\b(mi\s+pedido|ver\s+resumen|resumen|carrito|ver\s+carrito|la\s+cuenta|cuenta|cuanto\s+va|que\s+llevo|total)\b/.test(textoNorm)) {
    if (carrito.length === 0) {
      return construirRespuesta({
        accion: 'ver_resumen',
        respuestaBot: 'Aún no tienes productos en tu pedido. Escríbeme lo que te gustaría pedir o presiona "Ver menú".',
        carritoActualizado: carrito,
        resumen
      });
    }

    const detalle = carrito
      .map((i) => `• ${i.cantidad}x ${i.nombre}${i.notas ? ` (${i.notas})` : ''} - ${formatearCOP(i.subtotal)}`)
      .join('\n');

    return construirRespuesta({
      accion: 'ver_resumen',
      respuestaBot: `Resumen de tu pedido:\n${detalle}\nTotal: ${formatearCOP(resumen.costo_total)} · Tiempo estimado: ${resumen.tiempo_estimado} min.`,
      carritoActualizado: carrito,
      resumen
    });
  }

  // 7. Mostrar menú activo
  if (/\b(menu|carta|ver\s+menu|ver\s+carta|platos|bebidas|que\s+tienen|que\s+hay|opciones)\b/.test(textoNorm)) {
    const platos = productosActivos.filter((p) => p.categoria === 'plato');
    const bebidas = productosActivos.filter((p) => p.categoria === 'bebida');

    const partes = [];
    if (platos.length > 0) {
      partes.push('Platos:\n' + platos.map((p) => `• ${p.nombre} (${formatearCOP(p.precio)})`).join('\n'));
    }
    if (bebidas.length > 0) {
      partes.push('Bebidas:\n' + bebidas.map((p) => `• ${p.nombre} (${formatearCOP(p.precio)})`).join('\n'));
    }

    return construirRespuesta({
      accion: 'mostrar_menu',
      respuestaBot: `Aquí tienes nuestro menú disponible:\n${partes.join('\n\n')}\n\nPuedes pedir escribiendo algo como: "Quiero 2 hamburguesas sin cebolla".`,
      carritoActualizado: carrito,
      resumen
    });
  }

  // 8. Saludos o ayuda
  if (/^(hola|buenas|buenos\s+dias|buenas\s+tardes|buenas\s+noches|hey|saludos)\b/.test(textoNorm) ||
      /\b(ayuda|como\s+funciona|como\s+pido|instrucciones)\b/.test(textoNorm)) {
    return construirRespuesta({
      accion: 'ayuda',
      respuestaBot: `¡Hola! Soy el asistente de la Mesa ${mesaNumero || ''}. Puedes pedirme directamente lo que deseas, por ejemplo: "Quiero 2 hamburguesas sin cebolla y 1 limonada de coco con poco hielo".`,
      carritoActualizado: carrito,
      resumen
    });
  }

  // 9. No entendido (fallback amable)
  return construirRespuesta({
    accion: 'no_entendido',
    respuestaBot: 'No logré identificar el producto o acción que deseas. Prueba escribiendo por ejemplo: "Quiero 2 hamburguesas sin cebolla y 1 limonada de coco", o pulsa "Ver menú".',
    carritoActualizado: carrito,
    resumen
  });
}

/**
 * Procesa el mensaje del cliente consultando los productos activos reales desde PostgreSQL.
 */
async function procesarMensaje({ mensaje, carritoActual = [], mesaNumero }) {
  const productosActivos = await menuService.listarProductos({ soloActivos: true });
  return procesarMensajeConCatalogo({
    mensaje,
    carritoActual,
    mesaNumero,
    productosActivos
  });
}

module.exports = {
  procesarMensaje,
  procesarMensajeConCatalogo
};
