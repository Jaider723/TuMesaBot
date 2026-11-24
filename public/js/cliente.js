/**
 * Tu Mesa Bot - Interfaz Móvil de Chatbot del Cliente (Fase 3)
 * Frontend en JavaScript Vanilla (Mobile-First, Cero innerHTML con datos dinámicos)
 */

// ==========================================
// CONSTANTES Y ESTADO DE LA APLICACIÓN
// ==========================================
const MAX_CANTIDAD_POR_LINEA = 50;
const MAX_LINEAS_CARRITO = 50;
const MAX_MENSAJE_LEN = 400;
const COOLDOWN_MESERO_MS = 15000;

const state = {
  mesa: null,
  productos: [],
  mapaProductos: new Map(),
  carritoActual: [],
  isSending: false,
  isRequestingMesero: false,
  meseroCooldownUntil: 0,
  meseroTimerId: null,
  activeSummaryCard: null,
  activeDisambiguationGroups: []
};

// Formateador de moneda para Pesos Colombianos (COP)
const copFormatter = new Intl.NumberFormat('es-CO', {
  style: 'currency',
  currency: 'COP',
  maximumFractionDigits: 0
});

function formatCOP(valor) {
  return copFormatter.format(Number(valor) || 0);
}

/**
 * Normaliza cadenas igual que el backend (minúsculas y sin tildes) para comparar notas.
 */
function normalizarTexto(texto) {
  return String(texto || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

/**
 * Devuelve la hora corta actual (ej. "16:45") para mostrar en las burbujas del chat.
 */
function obtenerHoraCorta(fecha = new Date()) {
  return fecha.toLocaleTimeString('es-CO', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
}

// ==========================================
// REFERENCIAS A ELEMENTOS DEL DOM
// ==========================================
const elements = {
  mesaBadge: document.getElementById('mesa-badge'),
  btnSolicitarMesero: document.getElementById('btn-solicitar-mesero'),
  chatScrollArea: document.getElementById('chat-scroll-area'),
  chatMessages: document.getElementById('chat-messages'),
  typingIndicator: document.getElementById('typing-indicator'),
  quickMenuBtn: document.getElementById('quick-menu-btn'),
  quickResumenBtn: document.getElementById('quick-resumen-btn'),
  quickCartCount: document.getElementById('quick-cart-count'),
  quickVaciarBtn: document.getElementById('quick-vaciar-btn'),
  chatForm: document.getElementById('chat-form'),
  chatInput: document.getElementById('chat-input'),
  chatSubmitBtn: document.getElementById('chat-submit-btn')
};

// ==========================================
// CLIENTE HTTP Y CONTROL DE SESIÓN / ENVÍO
// ==========================================

/**
 * Cliente HTTP seguro para las rutas /api/cliente/*.
 * Envía 'Content-Type: application/json' únicamente cuando la petición tiene body.
 * Si el backend responde 403, redirige inmediatamente a /error-sesion.
 */
async function apiFetch(endpoint, options = {}) {
  const config = {
    credentials: 'same-origin',
    ...options,
    headers: {
      ...(options.headers || {})
    }
  };

  if (options.body && !config.headers['Content-Type']) {
    config.headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(endpoint, config);

  // Cualquier rechazo 403 invalida la sesión de mesa y redirige a la vista de error
  if (response.status === 403) {
    window.location.replace('/error-sesion');
    throw new Error('Sesión de mesa inválida o expirada.');
  }

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const errorMsg = data.error || data.mensaje || `Error en la solicitud (${response.status})`;
    const error = new Error(errorMsg);
    error.status = response.status;
    error.data = data;
    throw error;
  }

  return data;
}

/**
 * Controla el estado de envío en curso para bloquear peticiones concurrentes y duplicados.
 */
function setSendingState(isSending) {
  state.isSending = isSending;
  elements.chatSubmitBtn.disabled = isSending;
  elements.quickMenuBtn.disabled = isSending;
  elements.quickResumenBtn.disabled = isSending;
  elements.quickVaciarBtn.disabled = isSending;
  elements.btnSolicitarMesero.disabled =
    isSending || state.isRequestingMesero || obtenerSegundosRestantesMesero() > 0;

  if (isSending) {
    elements.typingIndicator.classList.remove('hidden');
  } else {
    elements.typingIndicator.classList.add('hidden');
  }

  scrollToBottom();
}

/**
 * Calcula los segundos restantes del enfriamiento de 15s para solicitar mesero.
 */
function obtenerSegundosRestantesMesero() {
  return Math.max(0, Math.ceil((state.meseroCooldownUntil - Date.now()) / 1000));
}

/**
 * Actualiza visualmente el botón de "Solicitar Mesero" según el enfriamiento activo.
 */
function actualizarBotonMesero() {
  const btn = elements.btnSolicitarMesero;
  if (!btn) return;
  const labelSpan = btn.querySelector('span:last-child');
  const restantes = obtenerSegundosRestantesMesero();

  if (restantes > 0) {
    btn.disabled = true;
    if (labelSpan) labelSpan.textContent = `Espera ${restantes}s...`;
  } else {
    if (state.meseroTimerId) {
      clearInterval(state.meseroTimerId);
      state.meseroTimerId = null;
    }
    btn.disabled = state.isSending || state.isRequestingMesero;
    if (labelSpan) labelSpan.textContent = 'Solicitar Mesero';
  }
}

/**
 * Activa el enfriamiento de 15 segundos tras enviar una solicitud de asistencia.
 */
function iniciarCooldownMesero() {
  state.meseroCooldownUntil = Date.now() + COOLDOWN_MESERO_MS;
  if (state.meseroTimerId) {
    clearInterval(state.meseroTimerId);
  }
  actualizarBotonMesero();
  state.meseroTimerId = setInterval(actualizarBotonMesero, 1000);
}

/**
 * Desplaza automáticamente el área de mensajes hasta el final.
 */
function scrollToBottom() {
  requestAnimationFrame(() => {
    elements.chatScrollArea.scrollTop = elements.chatScrollArea.scrollHeight;
  });
}

// ==========================================
// GESTIÓN DEL BORRADOR DE CARRITO Y CÁLCULOS
// ==========================================

/**
 * Calcula costo total, tiempo estimado (MÁXIMO entre ítems) y total de unidades.
 */
function calcularResumenLocal(carrito = state.carritoActual) {
  if (!Array.isArray(carrito) || carrito.length === 0) {
    return { costo_total: 0, tiempo_estimado: 0, total_items: 0 };
  }

  let totalCentavos = 0;
  let tiempoMaximo = 0;
  let totalItems = 0;

  for (const item of carrito) {
    const cantidad = Number(item.cantidad) || 0;
    const precioCentavos = Math.round(Number(item.precioUnitario) * 100);
    const tiempoPrep = Number(item.tiempoPreparacion) || 0;

    totalCentavos += precioCentavos * cantidad;
    totalItems += cantidad;

    // Regla de negocio: el tiempo estimado es el MAYOR entre los productos del pedido
    if (tiempoPrep > tiempoMaximo) {
      tiempoMaximo = tiempoPrep;
    }
  }

  return {
    costo_total: Number((totalCentavos / 100).toFixed(2)),
    tiempo_estimado: tiempoMaximo,
    total_items: totalItems
  };
}

/**
 * Actualiza el contador numérico en el botón rápido "Mi pedido".
 */
function actualizarBadgeCarrito() {
  const { total_items } = calcularResumenLocal();
  if (total_items > 0) {
    elements.quickCartCount.textContent = String(total_items);
    elements.quickCartCount.classList.remove('hidden');
  } else {
    elements.quickCartCount.textContent = '0';
    elements.quickCartCount.classList.add('hidden');
  }
}

/**
 * Agrega o fusiona un producto al borrador local respetando nota normalizada y límite de 50 unidades.
 */
function agregarItemAlBorrador({
  productoId,
  nombre,
  precioUnitario,
  tiempoPreparacion,
  cantidad = 1,
  notas = ''
}) {
  const prodCatalogo = state.mapaProductos.get(Number(productoId));
  const nombreFinal = prodCatalogo ? prodCatalogo.nombre : nombre;
  const precioFinal = prodCatalogo ? Number(prodCatalogo.precio) : Number(precioUnitario);
  const tiempoFinal = prodCatalogo
    ? Number(prodCatalogo.tiempo_preparacion)
    : Number(tiempoPreparacion);

  const notaLimpia = String(notas || '').trim().slice(0, 255);
  const claveNota = normalizarTexto(notaLimpia);
  const cantidadSolicitada = Math.max(1, Math.trunc(Number(cantidad) || 1));

  const existente = state.carritoActual.find(
    (item) => item.productoId === Number(productoId) && normalizarTexto(item.notas) === claveNota
  );

  let fueLimitado = false;

  if (existente) {
    const suma = existente.cantidad + cantidadSolicitada;
    if (suma > MAX_CANTIDAD_POR_LINEA) {
      existente.cantidad = MAX_CANTIDAD_POR_LINEA;
      fueLimitado = true;
    } else {
      existente.cantidad = suma;
    }
    existente.subtotal = Number((existente.precioUnitario * existente.cantidad).toFixed(2));
  } else {
    if (state.carritoActual.length >= MAX_LINEAS_CARRITO) {
      agregarBurbujaBotTexto(
        `Has alcanzado el límite de ${MAX_LINEAS_CARRITO} líneas diferentes en un mismo pedido. Puedes confirmarlo primero y luego hacer otro pedido adicional.`
      );
      return { agregado: false, fueLimitado: false };
    }

    const cantidadFinal = Math.min(MAX_CANTIDAD_POR_LINEA, cantidadSolicitada);
    if (cantidadSolicitada > MAX_CANTIDAD_POR_LINEA) {
      fueLimitado = true;
    }

    state.carritoActual.push({
      productoId: Number(productoId),
      nombre: nombreFinal,
      precioUnitario: precioFinal,
      tiempoPreparacion: tiempoFinal,
      cantidad: cantidadFinal,
      notas: notaLimpia,
      subtotal: Number((precioFinal * cantidadFinal).toFixed(2))
    });
  }

  actualizarBadgeCarrito();
  return { agregado: true, fueLimitado };
}

/**
 * Serializa el borrador en el formato mínimo esperado por /api/cliente/bot/mensaje y /api/cliente/pedidos.
 */
function serializarCarrito() {
  return state.carritoActual.map(({ productoId, cantidad, notas }) => ({
    productoId,
    cantidad,
    notas: notas || ''
  }));
}

// ==========================================
// RENDERIZADO SEGURO DE BURBUJAS (CERO XSS)
// ==========================================

/**
 * Inserta una burbuja genérica del bot en el área de mensajes.
 */
function agregarBurbujaBot(contenidoNode, { anchoCompleto = false } = {}) {
  const row = document.createElement('div');
  row.className = 'flex items-end gap-2';

  const avatar = document.createElement('div');
  avatar.className = 'w-7 h-7 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center text-xs font-bold shrink-0';
  avatar.setAttribute('aria-hidden', 'true');
  avatar.textContent = '🤖';

  const bubbleWrap = document.createElement('div');
  bubbleWrap.className = anchoCompleto
    ? 'flex-1 min-w-0 max-w-[94%] sm:max-w-[90%]'
    : 'min-w-0 max-w-[85%]';

  const card = document.createElement('div');
  card.className = 'bg-white border border-slate-200 text-slate-800 rounded-2xl rounded-bl-sm px-3.5 py-2.5 shadow-sm space-y-2';

  card.appendChild(contenidoNode);

  const meta = document.createElement('p');
  meta.className = 'text-[10px] text-slate-400 mt-1 pl-1';
  meta.textContent = `Tu Mesa Bot · ${obtenerHoraCorta()}`;

  bubbleWrap.appendChild(card);
  bubbleWrap.appendChild(meta);

  row.appendChild(avatar);
  row.appendChild(bubbleWrap);

  elements.chatMessages.appendChild(row);
  scrollToBottom();

  return row;
}

/**
 * Inserta una burbuja de texto del bot respetando saltos de línea (\n) con whitespace-pre-line.
 */
function agregarBurbujaBotTexto(texto, opciones = {}) {
  const container = document.createElement('div');
  container.className = 'space-y-2.5';

  const p = document.createElement('p');
  // Ajuste 1: whitespace-pre-line para respetar saltos de línea \n del backend
  p.className = 'text-sm text-slate-800 leading-relaxed whitespace-pre-line break-words';
  p.textContent = texto;
  container.appendChild(p);

  if (opciones.extraNode) {
    container.appendChild(opciones.extraNode);
  }

  return agregarBurbujaBot(container, { anchoCompleto: Boolean(opciones.anchoCompleto) });
}

/**
 * Inserta una burbuja del cliente alineada a la derecha.
 */
function agregarBurbujaCliente(texto) {
  const row = document.createElement('div');
  row.className = 'flex justify-end';

  const bubbleWrap = document.createElement('div');
  bubbleWrap.className = 'min-w-0 max-w-[82%] flex flex-col items-end';

  const bubble = document.createElement('div');
  bubble.className = 'bg-indigo-600 text-white rounded-2xl rounded-br-sm px-3.5 py-2.5 shadow-sm';

  const p = document.createElement('p');
  p.className = 'text-sm leading-relaxed whitespace-pre-line break-words';
  p.textContent = texto;

  bubble.appendChild(p);

  const meta = document.createElement('p');
  meta.className = 'text-[10px] text-slate-400 mt-1 pr-1';
  meta.textContent = obtenerHoraCorta();

  bubbleWrap.appendChild(bubble);
  bubbleWrap.appendChild(meta);
  row.appendChild(bubbleWrap);

  elements.chatMessages.appendChild(row);
  scrollToBottom();

  return row;
}

/**
 * Deshabilita los grupos de desambiguación anteriores para prevenir selecciones duplicadas.
 */
function deshabilitarGruposDesambiguacion() {
  state.activeDisambiguationGroups.forEach((groupEl) => {
    const buttons = groupEl.querySelectorAll('button');
    buttons.forEach((btn) => {
      btn.disabled = true;
    });
  });
  state.activeDisambiguationGroups = [];
}

/**
 * Deshabilita la tarjeta de resumen interactivo previa para dejar activa solo la más reciente.
 */
function deshabilitarTarjetaResumenAnterior() {
  if (!state.activeSummaryCard) return;

  state.activeSummaryCard.disabled = true;
  state.activeSummaryCard.wrapper.classList.add('opacity-75');
  const buttons = state.activeSummaryCard.wrapper.querySelectorAll('button');
  buttons.forEach((btn) => {
    btn.disabled = true;
  });
  state.activeSummaryCard = null;
}

// ==========================================
// COMPONENTES INTERACTIVOS DEL CHAT
// ==========================================

/**
 * Renderiza la burbuja interactiva del menú agrupado en Platos y Bebidas.
 */
function mostrarBurbujaMenu() {
  if (state.isSending) return;

  const wrapper = document.createElement('div');
  wrapper.className = 'space-y-3';

  const header = document.createElement('div');
  header.className = 'border-b border-slate-100 pb-2';

  const title = document.createElement('h2');
  title.className = 'text-sm font-bold text-slate-900 flex items-center gap-1.5';
  title.textContent = '📋 Nuestro Menú';

  const subtitle = document.createElement('p');
  subtitle.className = 'text-xs text-slate-500 mt-0.5';
  subtitle.textContent = 'Toca "+ Agregar" o escríbeme tu pedido con cantidades y notas.';

  header.appendChild(title);
  header.appendChild(subtitle);
  wrapper.appendChild(header);

  if (!state.productos || state.productos.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'text-xs text-slate-500 py-2';
    empty.textContent = 'Por el momento no hay productos disponibles en el menú.';
    wrapper.appendChild(empty);
    agregarBurbujaBot(wrapper, { anchoCompleto: true });
    return;
  }

  const platos = state.productos.filter((p) => p.categoria === 'plato');
  const bebidas = state.productos.filter((p) => p.categoria === 'bebida');

  const renderCategoria = (tituloCategoria, lista) => {
    if (lista.length === 0) return;

    const section = document.createElement('section');
    section.className = 'space-y-2';

    const catTitle = document.createElement('h3');
    catTitle.className = 'text-xs font-bold uppercase tracking-wider text-indigo-700 bg-indigo-50 px-2.5 py-1 rounded-lg inline-block';
    catTitle.textContent = tituloCategoria;
    section.appendChild(catTitle);

    const listContainer = document.createElement('div');
    listContainer.className = 'divide-y divide-slate-100 border border-slate-100 rounded-xl bg-slate-50/70';

    lista.forEach((producto) => {
      const itemRow = document.createElement('div');
      itemRow.className = 'p-2.5 flex items-start justify-between gap-2.5';

      const info = document.createElement('div');
      info.className = 'min-w-0 flex-1';

      const nombreEl = document.createElement('p');
      nombreEl.className = 'text-xs sm:text-sm font-semibold text-slate-900 break-words';
      nombreEl.textContent = producto.nombre;
      info.appendChild(nombreEl);

      if (producto.descripcion) {
        const descEl = document.createElement('p');
        descEl.className = 'text-[11px] text-slate-500 mt-0.5 leading-snug break-words';
        descEl.textContent = producto.descripcion;
        info.appendChild(descEl);
      }

      const metaEl = document.createElement('div');
      metaEl.className = 'flex items-center gap-2 mt-1 text-xs';

      const precioEl = document.createElement('span');
      precioEl.className = 'font-bold text-indigo-700';
      precioEl.textContent = formatCOP(producto.precio);

      const dot = document.createElement('span');
      dot.className = 'text-slate-300';
      dot.textContent = '•';

      const tiempoEl = document.createElement('span');
      tiempoEl.className = 'text-[11px] text-slate-500 font-medium';
      tiempoEl.textContent = `⏱️ ${producto.tiempo_preparacion} min`;

      metaEl.appendChild(precioEl);
      metaEl.appendChild(dot);
      metaEl.appendChild(tiempoEl);
      info.appendChild(metaEl);

      const addBtn = document.createElement('button');
      addBtn.type = 'button';
      addBtn.className = 'shrink-0 px-2.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white text-xs font-semibold transition whitespace-nowrap shadow-sm disabled:opacity-50';
      addBtn.textContent = '+ Agregar';
      addBtn.addEventListener('click', () => {
        // Ajuste 3: protección contra condiciones de carrera si hay fetch en curso
        if (state.isSending) return;

        const res = agregarItemAlBorrador({
          productoId: producto.id,
          nombre: producto.nombre,
          precioUnitario: producto.precio,
          tiempoPreparacion: producto.tiempo_preparacion,
          cantidad: 1,
          notas: ''
        });

        if (!res.agregado) return;

        if (res.fueLimitado) {
          agregarBurbujaBotTexto(
            `Se alcanzó el límite máximo de ${MAX_CANTIDAD_POR_LINEA} unidades para "${producto.nombre}".`
          );
        }

        mostrarOActualizarResumenEnChat();
      });

      itemRow.appendChild(info);
      itemRow.appendChild(addBtn);
      listContainer.appendChild(itemRow);
    });

    section.appendChild(listContainer);
    wrapper.appendChild(section);
  };

  renderCategoria('🍽️ Platos', platos);
  renderCategoria('🥤 Bebidas', bebidas);

  agregarBurbujaBot(wrapper, { anchoCompleto: true });
}

/**
 * Si la tarjeta de resumen activa es el último elemento del chat, la actualiza en vivo;
 * de lo contrario, genera una nueva tarjeta de resumen al final.
 */
function mostrarOActualizarResumenEnChat() {
  if (
    state.activeSummaryCard &&
    !state.activeSummaryCard.disabled &&
    elements.chatMessages.lastElementChild === state.activeSummaryCard.bubbleRow
  ) {
    renderizarContenidoResumen(state.activeSummaryCard);
    scrollToBottom();
    return;
  }

  renderizarTarjetaResumen();
}

/**
 * Actualiza internamente las líneas y totales de una tarjeta de resumen interactivo.
 */
function renderizarContenidoResumen(cardObj) {
  cardObj.linesContainer.replaceChildren();

  if (state.carritoActual.length === 0) {
    const vacioEl = document.createElement('p');
    vacioEl.className = 'text-xs text-slate-400 py-2 text-center';
    vacioEl.textContent = 'Sin productos en este borrador.';
    cardObj.linesContainer.appendChild(vacioEl);
    cardObj.totalEl.textContent = formatCOP(0);
    cardObj.tiempoEl.textContent = '0 min';
    return;
  }

  state.carritoActual.forEach((item, index) => {
    const lineEl = document.createElement('div');
    lineEl.className = 'py-2.5 border-b border-slate-100 last:border-b-0 space-y-2';

    const topRow = document.createElement('div');
    topRow.className = 'flex items-start justify-between gap-2';

    const leftInfo = document.createElement('div');
    leftInfo.className = 'min-w-0 flex-1';

    const titleEl = document.createElement('p');
    titleEl.className = 'text-xs sm:text-sm font-semibold text-slate-900 break-words';
    titleEl.textContent = item.nombre;
    leftInfo.appendChild(titleEl);

    if (item.notas) {
      const noteEl = document.createElement('span');
      noteEl.className = 'inline-block mt-1 px-2 py-0.5 rounded-md bg-amber-50 border border-amber-200 text-amber-800 text-[11px] font-medium break-words max-w-full';
      noteEl.textContent = `Nota: ${item.notas}`;
      leftInfo.appendChild(noteEl);
    }

    const subtotalEl = document.createElement('span');
    subtotalEl.className = 'shrink-0 text-xs sm:text-sm font-bold text-slate-900 whitespace-nowrap';
    subtotalEl.textContent = formatCOP(Number(item.precioUnitario) * Number(item.cantidad));

    topRow.appendChild(leftInfo);
    topRow.appendChild(subtotalEl);

    const controlsRow = document.createElement('div');
    controlsRow.className = 'flex items-center justify-between gap-2';

    // Controles - / cantidad / +
    const stepper = document.createElement('div');
    stepper.className = 'inline-flex items-center rounded-lg border border-slate-200 bg-slate-50';

    const btnMinus = document.createElement('button');
    btnMinus.type = 'button';
    btnMinus.className = 'w-7 h-7 flex items-center justify-center text-sm font-bold text-slate-700 hover:bg-slate-200 rounded-l-lg transition disabled:opacity-40 disabled:cursor-not-allowed';
    btnMinus.setAttribute('aria-label', `Disminuir cantidad de ${item.nombre}`);
    btnMinus.textContent = '−';
    // Ajuste 2: deshabilitar '-' cuando la cantidad sea 1 (dejando 'Quitar' para eliminar)
    btnMinus.disabled = cardObj.disabled || item.cantidad <= 1;
    btnMinus.addEventListener('click', () => {
      if (state.isSending || cardObj.disabled || item.cantidad <= 1) return;
      item.cantidad -= 1;
      item.subtotal = Number((item.precioUnitario * item.cantidad).toFixed(2));
      actualizarBadgeCarrito();
      renderizarContenidoResumen(cardObj);
    });

    const qtyText = document.createElement('span');
    qtyText.className = 'px-2.5 text-xs font-bold text-slate-900 min-w-[28px] text-center';
    qtyText.textContent = String(item.cantidad);

    const btnPlus = document.createElement('button');
    btnPlus.type = 'button';
    btnPlus.className = 'w-7 h-7 flex items-center justify-center text-sm font-bold text-slate-700 hover:bg-slate-200 rounded-r-lg transition disabled:opacity-40 disabled:cursor-not-allowed';
    btnPlus.setAttribute('aria-label', `Aumentar cantidad de ${item.nombre}`);
    btnPlus.textContent = '+';
    btnPlus.disabled = cardObj.disabled || item.cantidad >= MAX_CANTIDAD_POR_LINEA;
    btnPlus.addEventListener('click', () => {
      if (state.isSending || cardObj.disabled || item.cantidad >= MAX_CANTIDAD_POR_LINEA) return;
      item.cantidad += 1;
      item.subtotal = Number((item.precioUnitario * item.cantidad).toFixed(2));
      actualizarBadgeCarrito();
      renderizarContenidoResumen(cardObj);
    });

    stepper.appendChild(btnMinus);
    stepper.appendChild(qtyText);
    stepper.appendChild(btnPlus);

    const btnQuitar = document.createElement('button');
    btnQuitar.type = 'button';
    btnQuitar.className = 'px-2.5 py-1 rounded-lg text-[11px] font-semibold text-rose-600 bg-rose-50 hover:bg-rose-100 transition disabled:opacity-40 disabled:cursor-not-allowed';
    btnQuitar.textContent = 'Quitar';
    btnQuitar.disabled = cardObj.disabled;
    btnQuitar.addEventListener('click', () => {
      if (state.isSending || cardObj.disabled) return;
      state.carritoActual.splice(index, 1);
      actualizarBadgeCarrito();
      renderizarContenidoResumen(cardObj);

      // Ajuste 2: si quita el último ítem, deshabilitar la tarjeta y mostrar aviso corto
      if (state.carritoActual.length === 0) {
        deshabilitarTarjetaResumenAnterior();
        agregarBurbujaBotTexto('Tu pedido quedó vacío. Agrega productos desde el menú o escríbeme qué deseas ordenar.');
      }
    });

    controlsRow.appendChild(stepper);
    controlsRow.appendChild(btnQuitar);

    lineEl.appendChild(topRow);
    lineEl.appendChild(controlsRow);
    cardObj.linesContainer.appendChild(lineEl);
  });

  const resumen = calcularResumenLocal();
  cardObj.totalEl.textContent = formatCOP(resumen.costo_total);
  cardObj.tiempoEl.textContent = `${resumen.tiempo_estimado} min`;
}

/**
 * Genera y agrega al chat una nueva tarjeta interactiva de Resumen del Pedido,
 * deshabilitando cualquier tarjeta anterior.
 */
function renderizarTarjetaResumen() {
  deshabilitarTarjetaResumenAnterior();

  if (state.carritoActual.length === 0) {
    agregarBurbujaBotTexto('Tu pedido está vacío. Toca "Ver menú" o escríbeme lo que te gustaría ordenar.');
    return;
  }

  const wrapper = document.createElement('div');
  wrapper.className = 'space-y-3';

  const header = document.createElement('div');
  header.className = 'flex items-center justify-between border-b border-slate-100 pb-2';

  const title = document.createElement('h3');
  title.className = 'text-sm font-bold text-slate-900 flex items-center gap-1.5';
  title.textContent = '🧾 Resumen de tu Pedido';

  const badgeDraft = document.createElement('span');
  badgeDraft.className = 'text-[10px] font-semibold px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700';
  badgeDraft.textContent = 'Borrador';

  header.appendChild(title);
  header.appendChild(badgeDraft);

  const linesContainer = document.createElement('div');
  linesContainer.className = 'divide-y divide-slate-100';

  // Totales en vivo (Costo total y tiempo MÁXIMO)
  const totalsBox = document.createElement('div');
  totalsBox.className = 'bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-1.5';

  const totalRow = document.createElement('div');
  totalRow.className = 'flex items-center justify-between text-sm';
  const totalLabel = document.createElement('span');
  totalLabel.className = 'font-semibold text-slate-700';
  totalLabel.textContent = 'Total a pagar';
  const totalEl = document.createElement('span');
  totalEl.className = 'font-bold text-slate-900 text-base';
  totalRow.appendChild(totalLabel);
  totalRow.appendChild(totalEl);

  const timeRow = document.createElement('div');
  timeRow.className = 'flex items-center justify-between text-xs text-slate-600';
  const timeLabel = document.createElement('span');
  timeLabel.textContent = 'Tiempo estimado de preparación';
  const tiempoEl = document.createElement('span');
  tiempoEl.className = 'font-semibold text-indigo-700';
  timeRow.appendChild(timeLabel);
  timeRow.appendChild(tiempoEl);

  totalsBox.appendChild(totalRow);
  totalsBox.appendChild(timeRow);

  // Botones al pie del resumen
  const actionsBox = document.createElement('div');
  actionsBox.className = 'space-y-2 pt-1';

  const btnConfirmar = document.createElement('button');
  btnConfirmar.type = 'button';
  btnConfirmar.className = 'w-full py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white font-semibold text-sm shadow-sm transition disabled:opacity-50 disabled:cursor-not-allowed';
  btnConfirmar.textContent = '✅ Confirmar pedido';

  const secondaryRow = document.createElement('div');
  secondaryRow.className = 'grid grid-cols-2 gap-2';

  const btnVerMenu = document.createElement('button');
  btnVerMenu.type = 'button';
  btnVerMenu.className = 'py-2 px-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs transition disabled:opacity-50 disabled:cursor-not-allowed';
  btnVerMenu.textContent = '📋 Ver menú';

  const btnVaciar = document.createElement('button');
  btnVaciar.type = 'button';
  btnVaciar.className = 'py-2 px-3 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 font-semibold text-xs transition disabled:opacity-50 disabled:cursor-not-allowed';
  btnVaciar.textContent = '🗑️ Vaciar pedido';

  secondaryRow.appendChild(btnVerMenu);
  secondaryRow.appendChild(btnVaciar);

  actionsBox.appendChild(btnConfirmar);
  actionsBox.appendChild(secondaryRow);

  wrapper.appendChild(header);
  wrapper.appendChild(linesContainer);
  wrapper.appendChild(totalsBox);
  wrapper.appendChild(actionsBox);

  const bubbleRow = agregarBurbujaBot(wrapper, { anchoCompleto: true });

  const cardObj = {
    wrapper,
    bubbleRow,
    linesContainer,
    totalEl,
    tiempoEl,
    btnConfirmar,
    btnVerMenu,
    btnVaciar,
    disabled: false
  };

  btnConfirmar.addEventListener('click', () => {
    if (state.isSending || cardObj.disabled) return;
    confirmarPedido(btnConfirmar);
  });

  btnVerMenu.addEventListener('click', () => {
    if (state.isSending || cardObj.disabled) return;
    mostrarBurbujaMenu();
  });

  btnVaciar.addEventListener('click', () => {
    if (state.isSending || cardObj.disabled) return;
    vaciarCarrito();
  });

  state.activeSummaryCard = cardObj;
  renderizarContenidoResumen(cardObj);
  scrollToBottom();
}

/**
 * Renderiza botones de acción rápida inteligentes evitando reenvíos en bucle al bot.
 */
function crearNodosBotonesRapidos(botones = []) {
  if (!Array.isArray(botones) || botones.length === 0) return null;

  const container = document.createElement('div');
  container.className = 'flex flex-wrap gap-1.5 pt-1';

  botones.forEach((etiqueta) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'px-3 py-1.5 rounded-full border border-indigo-200 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed';
    btn.textContent = etiqueta;

    btn.addEventListener('click', () => {
      despacharBotonRapido(etiqueta);
    });

    container.appendChild(btn);
  });

  return container;
}

/**
 * Ejecuta directamente la acción asociada a cada botón rápido según su etiqueta.
 */
function despacharBotonRapido(etiqueta) {
  // Ajuste 3: protección contra condiciones de carrera
  if (state.isSending) return;

  const labelNorm = normalizarTexto(etiqueta);

  if (labelNorm === 'confirmar pedido') {
    confirmarPedido();
    return;
  }

  if (labelNorm === 'solicitar mesero' || labelNorm === 'llamar mesero') {
    solicitarMesero();
    return;
  }

  if (labelNorm === 'ver menu') {
    mostrarBurbujaMenu();
    return;
  }

  if (labelNorm === 'vaciar pedido') {
    vaciarCarrito();
    return;
  }

  enviarMensajeAlBot(etiqueta);
}

/**
 * Construye los botones interactivos para desambiguar productos coincidentes.
 */
function crearNodosDesambiguacion(opciones = []) {
  if (!Array.isArray(opciones) || opciones.length === 0) return null;

  const container = document.createElement('div');
  container.className = 'space-y-2 pt-1';

  opciones.forEach((op) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'w-full text-left p-2.5 rounded-xl border border-indigo-200 bg-indigo-50/70 hover:bg-indigo-100 active:bg-indigo-200 transition flex items-center justify-between gap-2 disabled:opacity-55 disabled:cursor-not-allowed';

    const left = document.createElement('div');
    left.className = 'min-w-0 flex-1';

    const nameEl = document.createElement('p');
    nameEl.className = 'text-xs sm:text-sm font-semibold text-slate-900 break-words';
    nameEl.textContent = op.nombre;
    left.appendChild(nameEl);

    const detailParts = [`⏱️ ${op.tiempo_preparacion} min`];
    if (op.cantidadDetectada && op.cantidadDetectada > 1) {
      detailParts.push(`Cantidad: ${op.cantidadDetectada}`);
    }
    if (op.notasDetectadas) {
      detailParts.push(`Nota: ${op.notasDetectadas}`);
    }

    const metaEl = document.createElement('p');
    metaEl.className = 'text-[11px] text-slate-600 mt-0.5 break-words';
    metaEl.textContent = detailParts.join(' · ');
    left.appendChild(metaEl);

    const right = document.createElement('span');
    right.className = 'shrink-0 text-xs font-bold text-indigo-700 whitespace-nowrap';
    right.textContent = formatCOP(op.precio);

    btn.appendChild(left);
    btn.appendChild(right);

    btn.addEventListener('click', () => {
      // Ajuste 3: protección contra condiciones de carrera
      if (state.isSending) return;

      // Deshabilitar el grupo para evitar doble selección accidental
      const groupButtons = container.querySelectorAll('button');
      groupButtons.forEach((b) => {
        b.disabled = true;
      });
      btn.classList.remove('bg-indigo-50/70');
      btn.classList.add('bg-indigo-200', 'border-indigo-400');

      const res = agregarItemAlBorrador({
        productoId: op.productoId,
        nombre: op.nombre,
        precioUnitario: Number(op.precio),
        tiempoPreparacion: Number(op.tiempo_preparacion),
        cantidad: Number(op.cantidadDetectada) || 1,
        notas: op.notasDetectadas || ''
      });

      if (!res.agregado) return;

      if (res.fueLimitado) {
        agregarBurbujaBotTexto(
          `Se aplicó el límite máximo de ${MAX_CANTIDAD_POR_LINEA} unidades para "${op.nombre}".`
        );
      }

      renderizarTarjetaResumen();
    });

    container.appendChild(btn);
  });

  state.activeDisambiguationGroups.push(container);
  return container;
}

/**
 * Renderiza la burbuja destacada de Pedido Confirmado con los datos definitivos de PostgreSQL.
 */
function renderizarBurbujaPedidoConfirmado(pedido) {
  const wrapper = document.createElement('div');
  wrapper.className = 'space-y-3';

  const header = document.createElement('div');
  header.className = 'bg-emerald-50 border border-emerald-200 rounded-xl p-3 flex items-center justify-between gap-2';

  const leftTitle = document.createElement('div');
  const title = document.createElement('h3');
  title.className = 'text-sm font-bold text-emerald-900 flex items-center gap-1.5';
  title.textContent = '✅ ¡Pedido Confirmado!';

  const sub = document.createElement('p');
  sub.className = 'text-xs text-emerald-700 mt-0.5';
  sub.textContent = `Mesa #${pedido.mesa_numero} · Enviado a cocina`;

  leftTitle.appendChild(title);
  leftTitle.appendChild(sub);

  const ordenBadge = document.createElement('span');
  ordenBadge.className = 'shrink-0 px-2.5 py-1 rounded-lg bg-emerald-600 text-white text-xs font-bold';
  ordenBadge.textContent = `Orden #${pedido.id}`;

  header.appendChild(leftTitle);
  header.appendChild(ordenBadge);
  wrapper.appendChild(header);

  // Lista de ítems confirmados devuelta por el backend
  const itemsList = document.createElement('div');
  itemsList.className = 'divide-y divide-slate-100 border border-slate-100 rounded-xl px-3 bg-slate-50/70';

  (pedido.items || []).forEach((item) => {
    const row = document.createElement('div');
    row.className = 'py-2 flex items-start justify-between gap-2';

    const info = document.createElement('div');
    info.className = 'min-w-0 flex-1';

    const name = document.createElement('p');
    name.className = 'text-xs sm:text-sm font-semibold text-slate-900 break-words';
    name.textContent = `${item.cantidad}x ${item.nombre}`;
    info.appendChild(name);

    if (item.notas) {
      const nota = document.createElement('p');
      nota.className = 'text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5 inline-block mt-1 break-words max-w-full';
      nota.textContent = `Nota: ${item.notas}`;
      info.appendChild(nota);
    }

    const subtotal = document.createElement('span');
    subtotal.className = 'shrink-0 text-xs font-bold text-slate-800 whitespace-nowrap';
    subtotal.textContent = formatCOP(Number(item.precio_unitario) * Number(item.cantidad));

    row.appendChild(info);
    row.appendChild(subtotal);
    itemsList.appendChild(row);
  });

  wrapper.appendChild(itemsList);

  // Resumen oficial del servidor
  const totalsBox = document.createElement('div');
  totalsBox.className = 'bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-1';

  const totalRow = document.createElement('div');
  totalRow.className = 'flex items-center justify-between text-sm';
  const totalLabel = document.createElement('span');
  totalLabel.className = 'font-semibold text-slate-700';
  totalLabel.textContent = 'Total confirmado';
  const totalVal = document.createElement('span');
  totalVal.className = 'font-bold text-slate-900 text-base';
  totalVal.textContent = formatCOP(pedido.costo_total);
  totalRow.appendChild(totalLabel);
  totalRow.appendChild(totalVal);

  const timeRow = document.createElement('div');
  timeRow.className = 'flex items-center justify-between text-xs text-slate-600';
  const timeLabel = document.createElement('span');
  timeLabel.textContent = 'Tiempo estimado';
  const timeVal = document.createElement('span');
  timeVal.className = 'font-bold text-emerald-700';
  timeVal.textContent = `${pedido.tiempo_estimado} min`;
  timeRow.appendChild(timeLabel);
  timeRow.appendChild(timeVal);

  totalsBox.appendChild(totalRow);
  totalsBox.appendChild(timeRow);
  wrapper.appendChild(totalsBox);

  const footerNote = document.createElement('p');
  footerNote.className = 'text-xs text-slate-500';
  footerNote.textContent = 'Si deseas pedir algo adicional más adelante, solo escríbeme aquí mismo.';
  wrapper.appendChild(footerNote);

  agregarBurbujaBot(wrapper, { anchoCompleto: true });
}

// ==========================================
// ACCIONES PRINCIPALES Y COMUNICACIÓN API
// ==========================================

/**
 * Inicializa la sesión del comensal, carga el catálogo y muestra las burbujas de bienvenida.
 */
async function inicializarSesion() {
  setSendingState(true);
  try {
    const data = await apiFetch('/api/cliente/sesion');
    state.mesa = data.mesa;
    state.productos = Array.isArray(data.productos) ? data.productos : [];
    state.mapaProductos = new Map(state.productos.map((p) => [Number(p.id), p]));

    const numeroMesa = state.mesa ? state.mesa.numero : '';
    elements.mesaBadge.textContent = `Mesa #${numeroMesa}`;
    document.title = `Tu Mesa Bot - Mesa #${numeroMesa}`;

    // Burbuja 1: Bienvenida + ejemplo breve con cantidades y notas
    const ejemploTexto = `${data.bienvenida}\n\nPor ejemplo, puedes escribirme:\n"Quiero 2 hamburguesas sin cebolla y 1 limonada de coco con poco hielo".`;
    agregarBurbujaBotTexto(ejemploTexto);

    // Burbuja 2: Menú completo interactivo
    setSendingState(false);
    mostrarBurbujaMenu();
  } catch (error) {
    // Si no fue 403 (que ya redirigió), mostrar error amigable de red/servidor
    if (error.message !== 'Sesión de mesa inválida o expirada.') {
      agregarBurbujaBotTexto(
        'No pude cargar el menú en este momento. Verifica tu conexión e intenta recargar la página.'
      );
    }
  } finally {
    if (state.isSending) {
      setSendingState(false);
    }
  }
}

/**
 * Envía el mensaje de texto del cliente al motor conversacional del bot.
 */
async function enviarMensajeAlBot(textoMensaje) {
  const mensaje = String(textoMensaje || '').trim();
  if (!mensaje || state.isSending) return;

  if (mensaje.length > MAX_MENSAJE_LEN) {
    agregarBurbujaBotTexto(`El mensaje no puede superar los ${MAX_MENSAJE_LEN} caracteres.`);
    return;
  }

  agregarBurbujaCliente(mensaje);
  setSendingState(true);

  try {
    const res = await apiFetch('/api/cliente/bot/mensaje', {
      method: 'POST',
      body: JSON.stringify({
        mensaje,
        carritoActual: serializarCarrito()
      })
    });

    state.carritoActual = Array.isArray(res.carritoActualizado) ? res.carritoActualizado : [];
    actualizarBadgeCarrito();

    // Manejo específico según la acción devuelta por el bot
    if (res.accion === 'mostrar_menu') {
      // Ajuste 1: mostrar directamente la burbuja interactiva del menú sin duplicar texto plano
      setSendingState(false);
      mostrarBurbujaMenu();
      return;
    }

    if (res.accion === 'desambiguar') {
      const opcionesNode = crearNodosDesambiguacion(res.opcionesDesambiguacion);
      const quickNode = crearNodosBotonesRapidos(res.botonesRapidos);
      const extraWrap = document.createElement('div');
      extraWrap.className = 'space-y-2';
      if (opcionesNode) extraWrap.appendChild(opcionesNode);
      if (quickNode) extraWrap.appendChild(quickNode);

      agregarBurbujaBotTexto(res.respuestaBot, { extraNode: extraWrap, anchoCompleto: true });
      return;
    }

    if (res.accion === 'confirmar_pedido') {
      if (state.carritoActual.length > 0) {
        agregarBurbujaBotTexto(res.respuestaBot);
        // Liberamos temporalmente para encadenar confirmarPedido sin bloqueo propio
        setSendingState(false);
        await confirmarPedido();
      } else {
        const quickNode = crearNodosBotonesRapidos(res.botonesRapidos);
        agregarBurbujaBotTexto(res.respuestaBot, { extraNode: quickNode });
      }
      return;
    }

    if (res.accion === 'solicitar_mesero') {
      // Ajuste 1: disparar directamente solicitarMesero() sin renderizar texto previo
      setSendingState(false);
      await solicitarMesero();
      return;
    }

    if (res.accion === 'vaciar_carrito') {
      deshabilitarTarjetaResumenAnterior();
      const quickNode = crearNodosBotonesRapidos(res.botonesRapidos);
      agregarBurbujaBotTexto(res.respuestaBot, { extraNode: quickNode });
      return;
    }

    if (
      (res.accion === 'agregar_items' || res.accion === 'ver_resumen' || res.accion === 'quitar_item') &&
      state.carritoActual.length > 0
    ) {
      agregarBurbujaBotTexto(res.respuestaBot);
      renderizarTarjetaResumen();
      return;
    }

    if (res.accion === 'quitar_item' && state.carritoActual.length === 0) {
      deshabilitarTarjetaResumenAnterior();
    }

    // Acciones generales ('ayuda', 'no_entendido', carrito vacío, etc.)
    const quickNode = crearNodosBotonesRapidos(res.botonesRapidos);
    agregarBurbujaBotTexto(res.respuestaBot, { extraNode: quickNode });
  } catch (error) {
    if (error.message !== 'Sesión de mesa inválida o expirada.') {
      agregarBurbujaBotTexto(
        error.message || 'Ocurrió un inconveniente al procesar tu mensaje. Intenta nuevamente.'
      );
    }
  } finally {
    setSendingState(false);
  }
}

/**
 * Confirma el pedido en PostgreSQL mediante POST /api/cliente/pedidos.
 */
async function confirmarPedido(triggerBtn = null) {
  // Ajuste 3: evitar envíos duplicados si hay petición en curso
  if (state.isSending) return;

  if (state.carritoActual.length === 0) {
    agregarBurbujaBotTexto('Tu pedido está vacío. Agrega al menos un producto antes de confirmar.');
    return;
  }

  const textoOriginalBtn = triggerBtn ? triggerBtn.textContent : '';
  if (triggerBtn) {
    triggerBtn.disabled = true;
    triggerBtn.textContent = 'Enviando pedido...';
  }

  setSendingState(true);

  try {
    const res = await apiFetch('/api/cliente/pedidos', {
      method: 'POST',
      body: JSON.stringify({
        items: serializarCarrito()
      })
    });

    // Limpiar borrador y deshabilitar controles anteriores tras 201 Created
    state.carritoActual = [];
    actualizarBadgeCarrito();
    deshabilitarTarjetaResumenAnterior();
    deshabilitarGruposDesambiguacion();

    renderizarBurbujaPedidoConfirmado(res.pedido);
  } catch (error) {
    if (triggerBtn) {
      triggerBtn.disabled = false;
      triggerBtn.textContent = textoOriginalBtn;
    }

    if (error.message !== 'Sesión de mesa inválida o expirada.') {
      agregarBurbujaBotTexto(
        `No se pudo registrar tu pedido: ${error.message || 'Error inesperado'}. Tu borrador sigue guardado para que intentes nuevamente.`
      );
    }
  } finally {
    setSendingState(false);
  }
}

/**
 * Vacía el borrador local del pedido y avisa en el chat.
 */
function vaciarCarrito() {
  if (state.isSending) return;

  if (state.carritoActual.length === 0) {
    agregarBurbujaBotTexto('Tu pedido ya se encuentra vacío.');
    return;
  }

  state.carritoActual = [];
  actualizarBadgeCarrito();
  deshabilitarTarjetaResumenAnterior();
  deshabilitarGruposDesambiguacion();

  agregarBurbujaBotTexto(
    'He vaciado tu pedido actual. Puedes volver a consultar el menú o decirme qué deseas pedir.'
  );
}

/**
 * Muestra el resumen del pedido actual al pulsar "Mi pedido" en el pie fijo.
 */
function mostrarResumenDesdeAccesoRapido() {
  if (state.isSending) return;

  if (state.carritoActual.length === 0) {
    agregarBurbujaBotTexto(
      'Aún no tienes productos en tu pedido. Toca "Ver menú" o escríbeme lo que te gustaría ordenar.'
    );
    return;
  }

  mostrarOActualizarResumenEnChat();
}

/**
 * Solicita asistencia de un mesero en tiempo real mediante POST /api/cliente/solicitar-mesero
 * aplicando un enfriamiento de 15 segundos entre solicitudes para evitar spam.
 */
async function solicitarMesero() {
  if (state.isSending || state.isRequestingMesero) return;

  const restantes = obtenerSegundosRestantesMesero();
  if (restantes > 0) {
    agregarBurbujaBotTexto(
      `⏳ Ya enviamos una solicitud recientemente. Por favor espera ${restantes} segundo${restantes === 1 ? '' : 's'} antes de volver a solicitar un mesero.`
    );
    return;
  }

  state.isRequestingMesero = true;
  setSendingState(true);

  try {
    const res = await apiFetch('/api/cliente/solicitar-mesero', {
      method: 'POST'
    });

    iniciarCooldownMesero();
    agregarBurbujaBotTexto(
      `🙋‍♂️ ${res.mensaje || 'Solicitud enviada. Un mesero se acercará a tu mesa en breve.'}`
    );
  } catch (error) {
    if (error.message !== 'Sesión de mesa inválida o expirada.') {
      agregarBurbujaBotTexto(
        `No se pudo enviar la solicitud al mesero: ${error.message || 'Intenta nuevamente.'}`
      );
    }
  } finally {
    state.isRequestingMesero = false;
    setSendingState(false);
    actualizarBotonMesero();
  }
}

// ==========================================
// MANEJADORES DE EVENTOS Y ARRANQUE
// ==========================================

function handleChatSubmit(event) {
  event.preventDefault();
  if (state.isSending) return;

  const mensaje = elements.chatInput.value.trim();
  if (!mensaje) return;

  elements.chatInput.value = '';
  enviarMensajeAlBot(mensaje);
}

function initApp() {
  elements.chatForm.addEventListener('submit', handleChatSubmit);
  elements.btnSolicitarMesero.addEventListener('click', solicitarMesero);
  elements.quickMenuBtn.addEventListener('click', mostrarBurbujaMenu);
  elements.quickResumenBtn.addEventListener('click', mostrarResumenDesdeAccesoRapido);
  elements.quickVaciarBtn.addEventListener('click', vaciarCarrito);

  inicializarSesion();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}
