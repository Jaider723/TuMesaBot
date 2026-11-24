/**
 * Tu Mesa Bot - Panel de Cocina y Meseros en Tiempo Real (Fase 4)
 * Frontend en JavaScript Vanilla (Socket.IO, Web Audio API, Cero innerHTML con datos dinámicos)
 */

// ==========================================
// ESTADO GLOBAL DE LA APLICACIÓN
// ==========================================
const state = {
  isAuthenticated: false,
  socket: null,
  socketStatus: 'disconnected', // 'connected' | 'reconnecting' | 'disconnected'
  hasConnectedOnce: false,
  lastEstadoSyncAt: 0,
  estadoSyncPromise: null,
  soundEnabled: false,
  audioCtx: null,
  pedidos: [],
  alertas: [],
  inFlightPedidos: new Set(),
  inFlightAlertas: new Set()
};

// ==========================================
// REFERENCIAS A ELEMENTOS DEL DOM
// ==========================================
const elements = {
  toastContainer: document.getElementById('toast-container'),

  // Vista Login
  loginView: document.getElementById('login-view'),
  loginError: document.getElementById('login-error'),
  loginForm: document.getElementById('login-form'),
  cocinaPin: document.getElementById('cocina-pin'),
  loginBtn: document.getElementById('login-btn'),

  // Vista Tablero Cocina
  cocinaView: document.getElementById('cocina-view'),
  socketStatusBadge: document.getElementById('socket-status-badge'),
  socketStatusDot: document.getElementById('socket-status-dot'),
  socketStatusText: document.getElementById('socket-status-text'),
  countPedidos: document.getElementById('count-pedidos'),
  countAlertas: document.getElementById('count-alertas'),
  soundToggleBtn: document.getElementById('sound-toggle-btn'),
  soundIcon: document.getElementById('sound-icon'),
  soundLabel: document.getElementById('sound-label'),
  refreshBtn: document.getElementById('refresh-btn'),
  logoutBtn: document.getElementById('logout-btn'),

  // Secciones del tablero
  sectionCountAlertas: document.getElementById('section-count-alertas'),
  alertasEmpty: document.getElementById('alertas-empty'),
  alertasList: document.getElementById('alertas-list'),
  sectionCountPedidos: document.getElementById('section-count-pedidos'),
  pedidosEmpty: document.getElementById('pedidos-empty'),
  pedidosList: document.getElementById('pedidos-list')
};

// ==========================================
// UTILIDADES: FORMATO, TOASTS Y WEB AUDIO API
// ==========================================

/**
 * Formatea una fecha ISO/Date a hora corta HH:mm en español colombiano.
 */
function formatHoraCorta(fechaInput) {
  const fecha = fechaInput ? new Date(fechaInput) : new Date();
  if (Number.isNaN(fecha.getTime())) return '--:--';
  return fecha.toLocaleTimeString('es-CO', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
}

/**
 * Muestra una notificación visual segura contra XSS.
 */
function showToast(message, type = 'info') {
  if (!elements.toastContainer) return;

  const toast = document.createElement('div');
  toast.className = 'flex items-center gap-3 px-4 py-3 rounded-xl shadow-lg border text-sm font-medium transition-all duration-300 transform translate-y-2 pointer-events-auto';

  if (type === 'success') {
    toast.className += ' bg-emerald-50 border-emerald-200 text-emerald-800';
  } else if (type === 'error') {
    toast.className += ' bg-rose-50 border-rose-200 text-rose-800';
  } else {
    toast.className += ' bg-slate-800 border-slate-700 text-white';
  }

  const icon = document.createElement('span');
  icon.className = 'text-lg';
  icon.textContent = type === 'success' ? '✅' : type === 'error' ? '⚠️' : 'ℹ️';

  const text = document.createElement('span');
  text.className = 'flex-1';
  text.textContent = message;

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'text-slate-400 hover:text-slate-600 font-bold ml-2 text-base leading-none';
  closeBtn.textContent = '×';
  closeBtn.addEventListener('click', () => toast.remove());

  toast.appendChild(icon);
  toast.appendChild(text);
  toast.appendChild(closeBtn);
  elements.toastContainer.appendChild(toast);

  requestAnimationFrame(() => {
    toast.classList.remove('translate-y-2');
  });

  setTimeout(() => {
    toast.classList.add('opacity-0', '-translate-y-2');
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

/**
 * Controla el estado de carga de un botón.
 */
function setButtonLoading(button, isLoading, normalText, loadingText = 'Cargando...') {
  if (!button) return;
  button.disabled = isLoading;
  const labelSpan = button.querySelector('span');
  if (labelSpan) {
    labelSpan.textContent = isLoading ? loadingText : normalText;
  } else {
    button.textContent = isLoading ? loadingText : normalText;
  }
}

/**
 * Inicializa o reanuda Web Audio API tras interacción del usuario.
 */
function asegurarAudioContext() {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return null;

  if (!state.audioCtx) {
    state.audioCtx = new AudioCtx();
  }
  if (state.audioCtx.state === 'suspended') {
    state.audioCtx.resume().catch(() => {});
  }
  return state.audioCtx;
}

/**
 * Reproduce un tono corto sintetizado nativamente (cero archivos .mp3 externos).
 */
function reproducirAvisoSonoro(tipo = 'pedido') {
  if (!state.soundEnabled) return;
  const ctx = asegurarAudioContext();
  if (!ctx) return;

  try {
    const ahora = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    if (tipo === 'alerta') {
      osc.frequency.setValueAtTime(660, ahora);
      osc.frequency.setValueAtTime(880, ahora + 0.11);
    } else {
      osc.frequency.setValueAtTime(523.25, ahora);
      osc.frequency.setValueAtTime(659.25, ahora + 0.1);
    }

    gain.gain.setValueAtTime(0.001, ahora);
    gain.gain.exponentialRampToValueAtTime(0.12, ahora + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ahora + 0.32);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(ahora);
    osc.stop(ahora + 0.34);
  } catch (err) {
    // Evitar errores ruidosos si el navegador restringe el audio
  }
}

function actualizarBotonSonido() {
  if (state.soundEnabled) {
    elements.soundIcon.textContent = '🔊';
    elements.soundLabel.textContent = 'Sonido ON';
    elements.soundToggleBtn.className = 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-indigo-300 bg-indigo-50 hover:bg-indigo-100 text-indigo-800 text-xs sm:text-sm font-semibold transition';
  } else {
    elements.soundIcon.textContent = '🔇';
    elements.soundLabel.textContent = 'Sonido OFF';
    elements.soundToggleBtn.className = 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs sm:text-sm font-semibold transition';
  }
}

function toggleSound() {
  state.soundEnabled = !state.soundEnabled;
  actualizarBotonSonido();

  if (state.soundEnabled) {
    asegurarAudioContext();
    reproducirAvisoSonoro('pedido');
    showToast('Avisos sonoros activados', 'success');
  } else {
    showToast('Avisos sonoros silenciados', 'info');
  }
}

// ==========================================
// CLIENTE HTTP Y CONTROL DE SESIÓN POR PIN
// ==========================================

/**
 * Cliente HTTP seguro para /api/cocina/*.
 * Excluye '/api/cocina/login' del interceptor automático de 401 para mostrar errores en el formulario.
 * Solo envía 'Content-Type: application/json' cuando existe body.
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

  // Interceptor global de 401 (excluyendo login)
  if (response.status === 401 && endpoint !== '/api/cocina/login') {
    const data = await response.json().catch(() => ({}));
    handleUnauthorized(data.error || 'Sesión expirada o no autorizada.');
    const error = new Error(data.error || 'Sesión no autorizada.');
    error.status = 401;
    throw error;
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
 * Limpia el estado en memoria, desconecta Socket.IO y vuelve a #login-view.
 */
function limpiarEstadoYSalir({ mensajeError = '' } = {}) {
  state.isAuthenticated = false;
  desconectarSocket();

  state.hasConnectedOnce = false;
  state.lastEstadoSyncAt = 0;
  state.estadoSyncPromise = null;
  state.pedidos = [];
  state.alertas = [];
  state.inFlightPedidos.clear();
  state.inFlightAlertas.clear();

  renderPedidos();
  renderAlertas();

  elements.cocinaView.classList.add('hidden');
  elements.loginView.classList.remove('hidden');
  elements.cocinaPin.value = '';

  if (mensajeError) {
    elements.loginError.textContent = mensajeError;
    elements.loginError.classList.remove('hidden');
  } else {
    elements.loginError.textContent = '';
    elements.loginError.classList.add('hidden');
  }
}

/**
 * Maneja expiración o rechazo de sesión (401 o connect_error 'No autorizado').
 */
function handleUnauthorized(mensaje = 'Sesión expirada. Ingresa el PIN nuevamente.') {
  // Evitar múltiples ejecuciones si ya se salió a login
  const estabaAutenticado = state.isAuthenticated;
  limpiarEstadoYSalir({ mensajeError: mensaje });
  if (estabaAutenticado) {
    showToast(mensaje, 'error');
  }
}

/**
 * Comprueba la sesión al cargar la página mediante GET /api/cocina/sesion.
 */
async function checkSession() {
  try {
    const data = await apiFetch('/api/cocina/sesion');
    if (data.autenticado) {
      enterCocinaView();
    } else {
      limpiarEstadoYSalir();
    }
  } catch (error) {
    limpiarEstadoYSalir();
  }
}

/**
 * Ingreso al tablero usando POST /api/cocina/login con { pin }.
 */
async function handleLogin(event) {
  event.preventDefault();
  const pin = elements.cocinaPin.value.trim();

  if (!pin) {
    elements.loginError.textContent = 'Por favor ingresa el PIN de cocina.';
    elements.loginError.classList.remove('hidden');
    return;
  }

  elements.loginError.classList.add('hidden');
  setButtonLoading(elements.loginBtn, true, 'Ingresar al Tablero', 'Verificando...');

  try {
    const data = await apiFetch('/api/cocina/login', {
      method: 'POST',
      body: JSON.stringify({ pin })
    });

    showToast(data.mensaje || 'Autenticación exitosa', 'success');
    enterCocinaView();
  } catch (error) {
    elements.loginError.textContent = error.message || 'PIN incorrecto.';
    elements.loginError.classList.remove('hidden');
  } finally {
    setButtonLoading(elements.loginBtn, false, 'Ingresar al Tablero');
  }
}

/**
 * Cierra sesión explícitamente, desconecta el socket y limpia el estado.
 */
async function handleLogout() {
  try {
    await apiFetch('/api/cocina/logout', { method: 'POST' });
    showToast('Sesión cerrada correctamente', 'info');
  } catch (error) {
    // Continuar con limpieza local aunque falle la red
  } finally {
    limpiarEstadoYSalir();
  }
}

/**
 * Activa el tablero autenticado, carga estado inicial e inicia Socket.IO.
 */
function enterCocinaView() {
  state.isAuthenticated = true;
  state.hasConnectedOnce = false;
  state.lastEstadoSyncAt = 0;

  elements.loginView.classList.add('hidden');
  elements.cocinaView.classList.remove('hidden');
  elements.cocinaPin.value = '';
  elements.loginError.classList.add('hidden');

  cargarEstadoInicial();
  conectarSocket();
}

// ==========================================
// GESTIÓN DE ESTADO, ORDENAMIENTO Y SOCKET.IO
// ==========================================

function ordenarPedidosFIFO(lista) {
  return [...lista].sort((a, b) => {
    const tA = new Date(a.creado_en).getTime() || 0;
    const tB = new Date(b.creado_en).getTime() || 0;
    if (tA !== tB) return tA - tB;
    return Number(a.id) - Number(b.id);
  });
}

function ordenarAlertasRecientes(lista) {
  return [...lista].sort((a, b) => {
    const tA = new Date(a.creada_en).getTime() || 0;
    const tB = new Date(b.creada_en).getTime() || 0;
    if (tB !== tA) return tB - tA;
    return Number(b.id) - Number(a.id);
  });
}

/**
 * Consulta GET /api/cocina/estado evitando llamadas simultáneas duplicadas.
 */
async function cargarEstadoInicial({ mostrarErrorToast = true } = {}) {
  if (!state.isAuthenticated) return;

  // Ajuste 3: coalescer peticiones simultáneas en curso
  if (state.estadoSyncPromise) {
    return state.estadoSyncPromise;
  }

  elements.refreshBtn.disabled = true;

  state.estadoSyncPromise = (async () => {
    try {
      const data = await apiFetch('/api/cocina/estado');
      if (!state.isAuthenticated) return;

      state.pedidos = ordenarPedidosFIFO(Array.isArray(data.pedidos) ? data.pedidos : []);
      state.alertas = ordenarAlertasRecientes(Array.isArray(data.alertas) ? data.alertas : []);
      state.lastEstadoSyncAt = Date.now();

      renderPedidos();
      renderAlertas();
    } catch (error) {
      if (mostrarErrorToast && error.status !== 401) {
        showToast(error.message || 'Error al cargar pedidos y alertas.', 'error');
      }
    } finally {
      state.estadoSyncPromise = null;
      elements.refreshBtn.disabled = false;
    }
  })();

  return state.estadoSyncPromise;
}

/**
 * Actualiza el indicador visual de conexión en tiempo real.
 */
function actualizarEstadoConexion(status) {
  state.socketStatus = status;

  if (status === 'connected') {
    elements.socketStatusBadge.className = 'inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 border border-emerald-200';
    elements.socketStatusDot.className = 'w-2 h-2 rounded-full bg-emerald-500 animate-pulse';
    elements.socketStatusText.textContent = 'Conectado en vivo';
  } else if (status === 'reconnecting') {
    elements.socketStatusBadge.className = 'inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-800 border border-amber-200';
    elements.socketStatusDot.className = 'w-2 h-2 rounded-full bg-amber-500 animate-pulse';
    elements.socketStatusText.textContent = 'Reconectando...';
  } else {
    elements.socketStatusBadge.className = 'inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-100 text-rose-800 border border-rose-200';
    elements.socketStatusDot.className = 'w-2 h-2 rounded-full bg-rose-500';
    elements.socketStatusText.textContent = 'Desconectado';
  }
}

/**
 * Desconecta Socket.IO de manera voluntaria dejando el indicador en "Desconectado".
 */
function desconectarSocket() {
  if (state.socket) {
    // Ajuste 2: remover listeners antes de desconectar para no mostrar "Reconectando..."
    state.socket.off('connect');
    state.socket.off('disconnect');
    state.socket.off('connect_error');
    state.socket.off('nuevo_pedido');
    state.socket.off('pedido_listo');
    state.socket.off('nueva_alerta');
    state.socket.off('alerta_atendida');
    state.socket.disconnect();
    state.socket = null;
  }
  actualizarEstadoConexion('disconnected');
}

/**
 * Inicia la conexión Socket.IO únicamente después de autenticar la sesión.
 */
function conectarSocket() {
  if (!state.isAuthenticated || typeof window.io !== 'function') return;

  desconectarSocket();
  actualizarEstadoConexion('reconnecting');

  const socket = window.io({ withCredentials: true });
  state.socket = socket;

  socket.on('connect', () => {
    if (!state.isAuthenticated) return;
    actualizarEstadoConexion('connected');

    // Ajuste 3: evitar doble petición simultánea en el primer 'connect' tras el arranque,
    // pero sincronizar siempre en reconexiones o si el arranque inicial aún no completó con éxito
    const esReconexion = state.hasConnectedOnce;
    state.hasConnectedOnce = true;

    const tiempoDesdeUltimoSync = Date.now() - state.lastEstadoSyncAt;
    if (esReconexion || (!state.estadoSyncPromise && tiempoDesdeUltimoSync > 1500)) {
      cargarEstadoInicial({ mostrarErrorToast: false });
    }
  });

  socket.on('disconnect', (reason) => {
    // Ajuste 2: desconexión voluntaria queda en "Desconectado"
    if (!state.isAuthenticated || reason === 'io client disconnect') {
      actualizarEstadoConexion('disconnected');
      return;
    }
    actualizarEstadoConexion('reconnecting');
  });

  socket.on('connect_error', (err) => {
    if (err && err.message === 'No autorizado') {
      handleUnauthorized('Sesión no autorizada en tiempo real. Ingresa el PIN nuevamente.');
      return;
    }
    if (state.isAuthenticated) {
      actualizarEstadoConexion('reconnecting');
    }
  });

  // 1. Nuevo pedido recibido
  socket.on('nuevo_pedido', (pedido) => {
    if (!state.isAuthenticated || !pedido || !pedido.id) return;
    const agregado = agregarPedidoLocal(pedido);
    if (agregado) {
      reproducirAvisoSonoro('pedido');
    }
  });

  // 2. Pedido marcado como listo en este u otro panel
  socket.on('pedido_listo', (payload) => {
    if (!state.isAuthenticated || !payload) return;
    const pedidoId = Number(payload.pedidoId ?? payload.id);
    if (pedidoId) {
      removerPedidoLocal(pedidoId);
    }
  });

  // 3. Nueva alerta para meseros
  socket.on('nueva_alerta', (alerta) => {
    if (!state.isAuthenticated || !alerta || !alerta.id) return;
    const agregada = agregarAlertaLocal(alerta, { animar: true });
    if (agregada) {
      reproducirAvisoSonoro('alerta');
    }
  });

  // 4. Alerta atendida en este u otro panel
  socket.on('alerta_atendida', (payload) => {
    if (!state.isAuthenticated || !payload) return;
    const alertaId = Number(payload.alertaId ?? payload.id);
    if (alertaId) {
      removerAlertaLocal(alertaId);
    }
  });
}

// ==========================================
// MUTACIONES LOCALES CON DEDUPLICACIÓN POR ID
// ==========================================

function agregarPedidoLocal(pedido) {
  const id = Number(pedido.id);
  if (state.pedidos.some((p) => Number(p.id) === id)) {
    return false;
  }
  state.pedidos = ordenarPedidosFIFO([...state.pedidos, pedido]);
  renderPedidos(id);
  return true;
}

function removerPedidoLocal(pedidoId) {
  const id = Number(pedidoId);
  const existe = state.pedidos.some((p) => Number(p.id) === id);
  if (!existe) return false;
  state.pedidos = state.pedidos.filter((p) => Number(p.id) !== id);
  renderPedidos();
  return true;
}

function agregarAlertaLocal(alerta, { animar = true } = {}) {
  const id = Number(alerta.id);
  if (state.alertas.some((a) => Number(a.id) === id)) {
    return false;
  }
  state.alertas = ordenarAlertasRecientes([alerta, ...state.alertas]);
  renderAlertas(animar ? id : null);
  return true;
}

function removerAlertaLocal(alertaId) {
  const id = Number(alertaId);
  const existe = state.alertas.some((a) => Number(a.id) === id);
  if (!existe) return false;
  state.alertas = state.alertas.filter((a) => Number(a.id) !== id);
  renderAlertas();
  return true;
}

// ==========================================
// RENDERIZADO SEGURO DEL TABLERO (CERO XSS)
// ==========================================

function actualizarContadores() {
  const nPedidos = state.pedidos.length;
  const nAlertas = state.alertas.length;

  elements.countPedidos.textContent = `${nPedidos} ${nPedidos === 1 ? 'pendiente' : 'pendientes'}`;
  elements.countAlertas.textContent = `${nAlertas} ${nAlertas === 1 ? 'alerta' : 'alertas'}`;
  elements.sectionCountPedidos.textContent = String(nPedidos);
  elements.sectionCountAlertas.textContent = String(nAlertas);
}

/**
 * Renderiza las comandas pendientes en orden FIFO usando DOM seguro.
 */
function renderPedidos(highlightId = null) {
  actualizarContadores();
  elements.pedidosList.replaceChildren();

  if (state.pedidos.length === 0) {
    elements.pedidosEmpty.classList.remove('hidden');
    return;
  }

  elements.pedidosEmpty.classList.add('hidden');

  state.pedidos.forEach((pedido) => {
    const esNuevo = highlightId !== null && Number(pedido.id) === Number(highlightId);
    const card = document.createElement('article');
    card.className = 'bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-between overflow-hidden transition-all duration-300';
    if (esNuevo) {
      card.classList.add('opacity-0', 'translate-y-2', 'ring-2', 'ring-indigo-400');
    }

    // Cabecera de la comanda con Mesa #X destacada
    const header = document.createElement('div');
    header.className = 'bg-slate-50 border-b border-slate-200 px-4 py-3 flex items-center justify-between gap-2';

    const leftHead = document.createElement('div');
    leftHead.className = 'flex items-center gap-2.5 flex-wrap';

    const mesaBadge = document.createElement('span');
    mesaBadge.className = 'inline-flex items-center px-3 py-1 rounded-xl bg-indigo-600 text-white text-base sm:text-lg font-extrabold tracking-tight shadow-sm';
    mesaBadge.textContent = `Mesa #${pedido.mesa_numero}`;

    const ordenSpan = document.createElement('span');
    ordenSpan.className = 'text-xs sm:text-sm font-bold text-slate-600';
    ordenSpan.textContent = `Orden #${pedido.id}`;

    leftHead.appendChild(mesaBadge);
    leftHead.appendChild(ordenSpan);

    const rightHead = document.createElement('div');
    rightHead.className = 'text-right shrink-0';

    const horaEl = document.createElement('p');
    horaEl.className = 'text-xs font-bold text-slate-700';
    horaEl.textContent = formatHoraCorta(pedido.creado_en);

    const tiempoEl = document.createElement('p');
    tiempoEl.className = 'text-[11px] font-semibold text-indigo-700';
    tiempoEl.textContent = `⏱️ ${pedido.tiempo_estimado} min`;

    rightHead.appendChild(horaEl);
    rightHead.appendChild(tiempoEl);

    header.appendChild(leftHead);
    header.appendChild(rightHead);
    card.appendChild(header);

    // Listado de ítems con notas resaltadas
    const body = document.createElement('div');
    body.className = 'p-4 flex-1 divide-y divide-slate-100';

    (pedido.items || []).forEach((item) => {
      const itemRow = document.createElement('div');
      itemRow.className = 'py-2 first:pt-0 last:pb-0';

      const mainLine = document.createElement('div');
      mainLine.className = 'flex items-baseline gap-2';

      const qtyBadge = document.createElement('span');
      qtyBadge.className = 'inline-flex items-center justify-center min-w-[28px] px-1.5 py-0.5 rounded-md bg-slate-200 text-slate-900 text-xs sm:text-sm font-extrabold shrink-0';
      qtyBadge.textContent = `${item.cantidad}x`;

      const nameEl = document.createElement('p');
      nameEl.className = 'text-sm sm:text-base font-bold text-slate-900 break-words';
      nameEl.textContent = item.nombre;

      mainLine.appendChild(qtyBadge);
      mainLine.appendChild(nameEl);
      itemRow.appendChild(mainLine);

      // Resaltado llamativo para notas especiales de preparación
      if (item.notas) {
        const notaBox = document.createElement('div');
        notaBox.className = 'mt-1.5 ml-8 px-2.5 py-1.5 rounded-r-lg border-l-4 border-amber-500 bg-amber-100 text-amber-950 text-xs font-bold break-words';
        notaBox.textContent = `⚠️ ${item.notas}`;
        itemRow.appendChild(notaBox);
      }

      body.appendChild(itemRow);
    });

    card.appendChild(body);

    // Pie con botón grande para marcar como listo
    const footer = document.createElement('div');
    footer.className = 'p-3 bg-slate-50 border-t border-slate-100';

    const btnListo = document.createElement('button');
    btnListo.type = 'button';
    btnListo.className = 'w-full py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white font-bold text-sm shadow-sm transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2';
    btnListo.disabled = state.inFlightPedidos.has(Number(pedido.id));
    btnListo.textContent = state.inFlightPedidos.has(Number(pedido.id))
      ? 'Procesando...'
      : '✅ Marcar Listo';

    btnListo.addEventListener('click', () => {
      marcarPedidoListo(pedido.id, btnListo);
    });

    footer.appendChild(btnListo);
    card.appendChild(footer);
    elements.pedidosList.appendChild(card);

    if (esNuevo) {
      requestAnimationFrame(() => {
        card.classList.remove('opacity-0', 'translate-y-2');
      });
      setTimeout(() => {
        card.classList.remove('ring-2', 'ring-indigo-400');
      }, 2000);
    }
  });
}

/**
 * Renderiza las alertas para meseros (más recientes primero) diferenciando visualmente su tipo.
 */
function renderAlertas(highlightId = null) {
  actualizarContadores();
  elements.alertasList.replaceChildren();

  if (state.alertas.length === 0) {
    elements.alertasEmpty.classList.remove('hidden');
    return;
  }

  elements.alertasEmpty.classList.add('hidden');

  state.alertas.forEach((alerta) => {
    const esAsistencia = alerta.tipo === 'asistencia_mesero';
    const esNueva = highlightId !== null && Number(alerta.id) === Number(highlightId);

    const card = document.createElement('article');
    card.className = esAsistencia
      ? 'rounded-xl border border-amber-300 border-l-4 border-l-rose-500 bg-amber-50 p-3.5 shadow-sm space-y-2.5 transition-all duration-300'
      : 'rounded-xl border border-emerald-300 border-l-4 border-l-emerald-600 bg-emerald-50 p-3.5 shadow-sm space-y-2.5 transition-all duration-300';

    if (esNueva) {
      card.classList.add('opacity-0', '-translate-y-2');
    }

    const topRow = document.createElement('div');
    topRow.className = 'flex items-center justify-between gap-2';

    const typeBadge = document.createElement('span');
    typeBadge.className = esAsistencia
      ? 'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-rose-100 text-rose-800'
      : 'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-200 text-emerald-900';
    typeBadge.textContent = esAsistencia ? '🙋‍♂️ Asistencia' : '🍽️ Pedido Listo';

    const timeSpan = document.createElement('span');
    timeSpan.className = 'text-xs font-semibold text-slate-600';
    timeSpan.textContent = formatHoraCorta(alerta.creada_en);

    topRow.appendChild(typeBadge);
    topRow.appendChild(timeSpan);

    const msgEl = document.createElement('p');
    msgEl.className = 'text-sm font-bold text-slate-900 leading-snug break-words';
    msgEl.textContent = alerta.mensaje;

    const btnAtender = document.createElement('button');
    btnAtender.type = 'button';
    btnAtender.className = esAsistencia
      ? 'w-full py-2 px-3 rounded-lg bg-white hover:bg-rose-50 text-rose-800 border border-rose-200 font-bold text-xs transition disabled:opacity-50 disabled:cursor-not-allowed'
      : 'w-full py-2 px-3 rounded-lg bg-white hover:bg-emerald-100 text-emerald-900 border border-emerald-300 font-bold text-xs transition disabled:opacity-50 disabled:cursor-not-allowed';

    const enCurso = state.inFlightAlertas.has(Number(alerta.id));
    btnAtender.disabled = enCurso;
    btnAtender.textContent = enCurso ? 'Atendiendo...' : 'Atendida';

    btnAtender.addEventListener('click', () => {
      marcarAlertaAtendida(alerta.id, btnAtender);
    });

    card.appendChild(topRow);
    card.appendChild(msgEl);
    card.appendChild(btnAtender);

    elements.alertasList.appendChild(card);

    if (esNueva) {
      requestAnimationFrame(() => {
        card.classList.remove('opacity-0', '-translate-y-2');
      });
    }
  });
}

// ==========================================
// ACCIONES OPERATIVAS (PATCH CON DEDUPLICACIÓN)
// ==========================================

/**
 * Marca un pedido pendiente como listo (PATCH /api/cocina/pedidos/:id/listo).
 */
async function marcarPedidoListo(pedidoId, btn) {
  const id = Number(pedidoId);
  if (state.inFlightPedidos.has(id)) return;

  state.inFlightPedidos.add(id);
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Procesando...';
  }

  try {
    const res = await apiFetch(`/api/cocina/pedidos/${id}/listo`, {
      method: 'PATCH'
    });

    // Ajuste 3: reflejar el cambio de inmediato y deduplicar cuando llegue por Socket.IO
    removerPedidoLocal(id);
    if (res.alerta && res.alerta.id) {
      agregarAlertaLocal(res.alerta, { animar: true });
    }

    showToast(res.mensaje || `Pedido #${id} marcado como listo.`, 'success');
  } catch (error) {
    if (error.status !== 401) {
      showToast(error.message || 'No se pudo marcar el pedido como listo.', 'error');
      // Resincronizar tablero ante 404/409 (ej. ya fue procesado en otra pantalla)
      if (error.status === 404 || error.status === 409) {
        await cargarEstadoInicial({ mostrarErrorToast: false });
      } else if (btn) {
        btn.disabled = false;
        btn.textContent = '✅ Marcar Listo';
      }
    }
  } finally {
    state.inFlightPedidos.delete(id);
  }
}

/**
 * Marca una alerta como atendida (PATCH /api/cocina/alertas/:id/atender).
 */
async function marcarAlertaAtendida(alertaId, btn) {
  const id = Number(alertaId);
  if (state.inFlightAlertas.has(id)) return;

  state.inFlightAlertas.add(id);
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Atendiendo...';
  }

  try {
    const res = await apiFetch(`/api/cocina/alertas/${id}/atender`, {
      method: 'PATCH'
    });

    // Ajuste 3: reflejar inmediatamente en la lista local y deduplicar en evento socket
    removerAlertaLocal(id);
    showToast(res.mensaje || 'Alerta atendida.', 'success');
  } catch (error) {
    if (error.status !== 401) {
      showToast(error.message || 'No se pudo marcar la alerta como atendida.', 'error');
      if (error.status === 404) {
        await cargarEstadoInicial({ mostrarErrorToast: false });
      } else if (btn) {
        btn.disabled = false;
        btn.textContent = 'Atendida';
      }
    }
  } finally {
    state.inFlightAlertas.delete(id);
  }
}

// ==========================================
// REGISTRO DE EVENTOS Y ARRANQUE
// ==========================================

function initApp() {
  elements.loginForm.addEventListener('submit', handleLogin);
  elements.logoutBtn.addEventListener('click', handleLogout);
  elements.soundToggleBtn.addEventListener('click', toggleSound);
  elements.refreshBtn.addEventListener('click', () => {
    cargarEstadoInicial({ mostrarErrorToast: true });
  });

  actualizarBotonSonido();
  checkSession();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}
