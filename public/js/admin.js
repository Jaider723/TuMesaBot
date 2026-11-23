/**
 * Tu Mesa Bot - Panel de Administración
 * Frontend en JavaScript Vanilla (Mobile-First, DOM Seguro sin XSS)
 */

// ==========================================
// ESTADO GLOBAL DE LA APLICACIÓN
// ==========================================
const state = {
  isAuthenticated: false,
  activeTab: 'menu',
  editingProductId: null,
  products: [],
  tables: []
};

// Formateador de moneda para Pesos Colombianos (COP)
const copFormatter = new Intl.NumberFormat('es-CO', {
  style: 'currency',
  currency: 'COP',
  maximumFractionDigits: 0
});

function formatCOP(amount) {
  return copFormatter.format(Number(amount) || 0);
}

// ==========================================
// REFERENCIAS A ELEMENTOS DEL DOM
// ==========================================
const elements = {
  // Toasts
  toastContainer: document.getElementById('toast-container'),

  // Vista Login
  loginView: document.getElementById('login-view'),
  loginForm: document.getElementById('login-form'),
  adminPassword: document.getElementById('admin-password'),
  loginBtn: document.getElementById('login-btn'),
  loginError: document.getElementById('login-error'),

  // Vista Admin
  adminView: document.getElementById('admin-view'),
  logoutBtn: document.getElementById('logout-btn'),

  // Pestañas
  tabBtnMenu: document.getElementById('tab-btn-menu'),
  tabBtnMesas: document.getElementById('tab-btn-mesas'),
  tabMenu: document.getElementById('tab-menu'),
  tabMesas: document.getElementById('tab-mesas'),

  // Menú y Productos
  productForm: document.getElementById('product-form'),
  productFormTitle: document.getElementById('product-form-title'),
  productFormBadge: document.getElementById('product-form-badge'),
  productId: document.getElementById('product-id'),
  productNombre: document.getElementById('product-nombre'),
  productCategoria: document.getElementById('product-categoria'),
  productPrecio: document.getElementById('product-precio'),
  productTiempo: document.getElementById('product-tiempo'),
  productDescripcion: document.getElementById('product-descripcion'),
  productSubmitBtn: document.getElementById('product-submit-btn'),
  productCancelBtn: document.getElementById('product-cancel-btn'),
  productsTableBody: document.getElementById('products-table-body'),
  productsEmpty: document.getElementById('products-empty'),
  refreshProductsBtn: document.getElementById('refresh-products-btn'),

  // Mesas y QRs
  mesaForm: document.getElementById('mesa-form'),
  mesaNumero: document.getElementById('mesa-numero'),
  mesaSubmitBtn: document.getElementById('mesa-submit-btn'),
  mesasGrid: document.getElementById('mesas-grid'),
  mesasEmpty: document.getElementById('mesas-empty'),
  refreshMesasBtn: document.getElementById('refresh-mesas-btn')
};

// ==========================================
// UTILIDADES: TOASTS Y BOTONES DE CARGA
// ==========================================

/**
 * Muestra una notificación visual accesible y segura contra XSS.
 * @param {string} message - Texto del mensaje a mostrar.
 * @param {'success'|'error'|'info'} type - Tipo de notificación.
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
  closeBtn.onclick = () => toast.remove();

  toast.appendChild(icon);
  toast.appendChild(text);
  toast.appendChild(closeBtn);

  elements.toastContainer.appendChild(toast);

  // Animación de entrada
  requestAnimationFrame(() => {
    toast.classList.remove('translate-y-2');
  });

  // Auto-cierre a los 4 segundos
  setTimeout(() => {
    toast.classList.add('opacity-0', '-translate-y-2');
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

/**
 * Controla el estado visual y habilitado de un botón durante peticiones fetch.
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

// ==========================================
// CLIENTE HTTP CON INTERCEPTOR SEGURO
// ==========================================

/**
 * Cliente HTTP base para la API de administración.
 * Excluye '/api/admin/login' del interceptor automático de 401 para permitir
 * mostrar errores de contraseña incorrecta sin disparar el reseteo de la sesión.
 * Solo incluye la cabecera 'Content-Type: application/json' cuando se envía un body.
 */
async function apiFetch(endpoint, options = {}) {
  const config = {
    credentials: 'same-origin',
    ...options,
    headers: {
      ...(options.headers || {})
    }
  };

  // Añadir Content-Type únicamente si hay un cuerpo en la petición
  if (options.body && !config.headers['Content-Type']) {
    config.headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(endpoint, config);

  // Interceptor de 401: Excluir específicamente la ruta de login
  if (response.status === 401 && endpoint !== '/api/admin/login') {
    handleUnauthorized();
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || 'Sesión no autorizada o expirada.');
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
 * Manejador global cuando una petición devuelve 401 Unauthorized.
 */
function handleUnauthorized() {
  state.isAuthenticated = false;
  elements.adminView.classList.add('hidden');
  elements.loginView.classList.remove('hidden');
  elements.loginError.classList.add('hidden');
  elements.loginError.textContent = '';
  elements.adminPassword.value = '';
}

// ==========================================
// CONTROL DE SESIÓN Y VISTAS
// ==========================================

/**
 * Verifica el estado de la sesión activa al cargar la página.
 */
async function checkSession() {
  try {
    const data = await apiFetch('/api/admin/sesion');
    if (data.autenticado) {
      showAdminView();
    } else {
      showLoginView();
    }
  } catch (error) {
    // Si falla o devuelve 401, se muestra la vista de login
    showLoginView();
  }
}

function showAdminView() {
  state.isAuthenticated = true;
  elements.loginView.classList.add('hidden');
  elements.adminView.classList.remove('hidden');
  elements.adminPassword.value = '';
  elements.loginError.classList.add('hidden');

  // Cargar datos iniciales
  loadProducts();
  loadTables();
}

function showLoginView() {
  state.isAuthenticated = false;
  elements.adminView.classList.add('hidden');
  elements.loginView.classList.remove('hidden');
  elements.adminPassword.value = '';
}

/**
 * Iniciar sesión con contraseña de administrador.
 */
async function handleLogin(event) {
  event.preventDefault();
  const password = elements.adminPassword.value.trim();

  if (!password) {
    elements.loginError.textContent = 'Por favor ingresa la contraseña.';
    elements.loginError.classList.remove('hidden');
    return;
  }

  elements.loginError.classList.add('hidden');
  setButtonLoading(elements.loginBtn, true, 'Iniciar Sesión', 'Verificando...');

  try {
    const data = await apiFetch('/api/admin/login', {
      method: 'POST',
      body: JSON.stringify({ password })
    });

    showToast(data.mensaje || 'Autenticación exitosa', 'success');
    showAdminView();
  } catch (error) {
    elements.loginError.textContent = error.message || 'Error al iniciar sesión.';
    elements.loginError.classList.remove('hidden');
  } finally {
    setButtonLoading(elements.loginBtn, false, 'Iniciar Sesión');
  }
}

/**
 * Cerrar sesión de administrador.
 */
async function handleLogout() {
  try {
    await apiFetch('/api/admin/logout', { method: 'POST' });
    showToast('Sesión cerrada correctamente', 'info');
  } catch (error) {
    console.warn('Aviso al cerrar sesión:', error.message);
  } finally {
    showLoginView();
  }
}

// ==========================================
// NAVEGACIÓN ENTRE PESTAÑAS
// ==========================================

function switchTab(tabName) {
  state.activeTab = tabName;

  if (tabName === 'menu') {
    elements.tabMenu.classList.remove('hidden');
    elements.tabMesas.classList.add('hidden');

    elements.tabBtnMenu.className = 'py-3 px-4 border-b-2 font-semibold text-sm border-indigo-600 text-indigo-600 flex items-center gap-2 transition';
    elements.tabBtnMesas.className = 'py-3 px-4 border-b-2 font-semibold text-sm border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300 flex items-center gap-2 transition';
  } else if (tabName === 'mesas') {
    elements.tabMenu.classList.add('hidden');
    elements.tabMesas.classList.remove('hidden');

    elements.tabBtnMesas.className = 'py-3 px-4 border-b-2 font-semibold text-sm border-indigo-600 text-indigo-600 flex items-center gap-2 transition';
    elements.tabBtnMenu.className = 'py-3 px-4 border-b-2 font-semibold text-sm border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300 flex items-center gap-2 transition';
  }
}

// ==========================================
// GESTIÓN DEL MENÚ (PLATOS Y BEBIDAS)
// ==========================================

/**
 * Carga la lista completa de productos desde el backend.
 */
async function loadProducts() {
  try {
    const productos = await apiFetch('/api/admin/productos');
    state.products = productos;
    renderProducts(productos);
  } catch (error) {
    showToast(error.message || 'No se pudieron cargar los productos.', 'error');
  }
}

/**
 * Renderiza los productos en la tabla usando DOM seguro (sin innerHTML para datos).
 */
function renderProducts(productos) {
  elements.productsTableBody.replaceChildren();

  if (!productos || productos.length === 0) {
    elements.productsEmpty.classList.remove('hidden');
    return;
  }

  elements.productsEmpty.classList.add('hidden');

  productos.forEach((prod) => {
    const tr = document.createElement('tr');
    tr.className = 'hover:bg-slate-50 transition border-b border-slate-100';

    // Columna 1: Nombre y descripción
    const tdNombre = document.createElement('td');
    tdNombre.className = 'py-3.5 px-4';

    const divNombre = document.createElement('div');
    divNombre.className = 'font-semibold text-slate-900';
    divNombre.textContent = prod.nombre;

    tdNombre.appendChild(divNombre);

    if (prod.descripcion) {
      const divDesc = document.createElement('div');
      divDesc.className = 'text-xs text-slate-500 truncate max-w-xs sm:max-w-md';
      divDesc.textContent = prod.descripcion;
      tdNombre.appendChild(divDesc);
    }

    // Columna 2: Categoría
    const tdCategoria = document.createElement('td');
    tdCategoria.className = 'py-3.5 px-4';

    const spanCat = document.createElement('span');
    if (prod.categoria === 'plato') {
      spanCat.className = 'inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-indigo-50 text-indigo-700';
      spanCat.textContent = '🍽️ Plato';
    } else {
      spanCat.className = 'inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-emerald-50 text-emerald-700';
      spanCat.textContent = '🥤 Bebida';
    }
    tdCategoria.appendChild(spanCat);

    // Columna 3: Precio formateado en COP (convirtiendo string de PG con Number())
    const tdPrecio = document.createElement('td');
    tdPrecio.className = 'py-3.5 px-4 font-semibold text-slate-900';
    tdPrecio.textContent = formatCOP(Number(prod.precio));

    // Columna 4: Tiempo de preparación
    const tdTiempo = document.createElement('td');
    tdTiempo.className = 'py-3.5 px-4 text-slate-600 text-xs sm:text-sm';
    tdTiempo.textContent = `${prod.tiempo_preparacion} min`;

    // Columna 5: Estado (Activo / Inactivo)
    const tdEstado = document.createElement('td');
    tdEstado.className = 'py-3.5 px-4';

    const spanEstado = document.createElement('span');
    if (prod.activo) {
      spanEstado.className = 'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800';
      spanEstado.textContent = 'Activo';
    } else {
      spanEstado.className = 'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-slate-200 text-slate-700';
      spanEstado.textContent = 'Inactivo';
    }
    tdEstado.appendChild(spanEstado);

    // Columna 6: Acciones
    const tdAcciones = document.createElement('td');
    tdAcciones.className = 'py-3.5 px-4 text-right space-x-2 whitespace-nowrap';

    // Botón Editar
    const btnEditar = document.createElement('button');
    btnEditar.type = 'button';
    btnEditar.className = 'text-xs font-semibold text-indigo-600 hover:text-indigo-900 px-2 py-1 rounded bg-indigo-50 hover:bg-indigo-100 transition';
    btnEditar.textContent = 'Editar';
    btnEditar.onclick = () => startEditProduct(prod);
    tdAcciones.appendChild(btnEditar);

    // Botón Desactivar / Reactivar
    if (prod.activo) {
      const btnDesactivar = document.createElement('button');
      btnDesactivar.type = 'button';
      btnDesactivar.className = 'text-xs font-semibold text-rose-600 hover:text-rose-900 px-2 py-1 rounded bg-rose-50 hover:bg-rose-100 transition';
      btnDesactivar.textContent = 'Desactivar';
      btnDesactivar.onclick = () => deactivateProduct(prod.id, prod.nombre);
      tdAcciones.appendChild(btnDesactivar);
    } else {
      const btnReactivar = document.createElement('button');
      btnReactivar.type = 'button';
      btnReactivar.className = 'text-xs font-semibold text-emerald-600 hover:text-emerald-900 px-2 py-1 rounded bg-emerald-50 hover:bg-emerald-100 transition';
      btnReactivar.textContent = 'Reactivar';
      btnReactivar.onclick = () => reactivateProduct(prod.id, prod.nombre);
      tdAcciones.appendChild(btnReactivar);
    }

    tr.appendChild(tdNombre);
    tr.appendChild(tdCategoria);
    tr.appendChild(tdPrecio);
    tr.appendChild(tdTiempo);
    tr.appendChild(tdEstado);
    tr.appendChild(tdAcciones);

    elements.productsTableBody.appendChild(tr);
  });
}

/**
 * Pone el formulario de productos en modo edición.
 * Asigna Number(producto.precio) para evitar bloqueos por valores decimales.
 */
function startEditProduct(product) {
  state.editingProductId = product.id;

  elements.productId.value = product.id;
  elements.productNombre.value = product.nombre || '';
  elements.productCategoria.value = product.categoria || 'plato';
  // Ajuste 2: Asignar Number(producto.precio) con step="any"
  elements.productPrecio.value = Number(product.precio);
  elements.productTiempo.value = product.tiempo_preparacion || '';
  elements.productDescripcion.value = product.descripcion || '';

  elements.productFormTitle.replaceChildren();
  const iconSpan = document.createElement('span');
  iconSpan.textContent = '✏️ ';
  const textSpan = document.createElement('span');
  textSpan.textContent = `Editar Producto #${product.id}`;
  elements.productFormTitle.appendChild(iconSpan);
  elements.productFormTitle.appendChild(textSpan);

  elements.productFormBadge.classList.remove('hidden');
  elements.productCancelBtn.classList.remove('hidden');
  elements.productSubmitBtn.querySelector('span').textContent = 'Guardar Cambios';

  elements.productForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/**
 * Cancela la edición y devuelve el formulario a su estado original de creación.
 */
function cancelEditProduct() {
  state.editingProductId = null;
  elements.productForm.reset();
  elements.productId.value = '';

  elements.productFormTitle.replaceChildren();
  const iconSpan = document.createElement('span');
  iconSpan.textContent = '➕ ';
  const textSpan = document.createElement('span');
  textSpan.textContent = 'Agregar Nuevo Producto';
  elements.productFormTitle.appendChild(iconSpan);
  elements.productFormTitle.appendChild(textSpan);

  elements.productFormBadge.classList.add('hidden');
  elements.productCancelBtn.classList.add('hidden');
  elements.productSubmitBtn.querySelector('span').textContent = 'Guardar Producto';
}

/**
 * Envío del formulario de producto (creación o actualización).
 */
async function handleProductSubmit(event) {
  event.preventDefault();

  const nombre = elements.productNombre.value.trim();
  const categoria = elements.productCategoria.value;
  const precioStr = elements.productPrecio.value.trim();
  const tiempoStr = elements.productTiempo.value.trim();
  const descripcion = elements.productDescripcion.value.trim();

  // Validaciones del lado del cliente
  if (!nombre) {
    showToast('El nombre del producto es obligatorio.', 'error');
    elements.productNombre.focus();
    return;
  }

  if (nombre.length > 120) {
    showToast('El nombre no puede superar 120 caracteres.', 'error');
    elements.productNombre.focus();
    return;
  }

  if (categoria !== 'plato' && categoria !== 'bebida') {
    showToast("La categoría debe ser 'plato' o 'bebida'.", 'error');
    return;
  }

  if (precioStr === '' || isNaN(Number(precioStr)) || Number(precioStr) < 0) {
    showToast('El precio debe ser un número válido mayor o igual a 0.', 'error');
    elements.productPrecio.focus();
    return;
  }

  const tiempoNum = Number(tiempoStr);
  if (tiempoStr === '' || isNaN(tiempoNum) || !Number.isInteger(tiempoNum) || tiempoNum <= 0) {
    showToast('El tiempo de preparación debe ser un entero mayor a 0 minutos.', 'error');
    elements.productTiempo.focus();
    return;
  }

  const isEditing = state.editingProductId !== null;
  const defaultBtnText = isEditing ? 'Guardar Cambios' : 'Guardar Producto';
  setButtonLoading(elements.productSubmitBtn, true, defaultBtnText, 'Guardando...');

  const payload = {
    nombre,
    categoria,
    precio: Number(precioStr),
    tiempo_preparacion: tiempoNum,
    descripcion
  };

  try {
    if (isEditing) {
      await apiFetch(`/api/admin/productos/${state.editingProductId}`, {
        method: 'PUT',
        body: JSON.stringify(payload)
      });
      showToast('Producto actualizado correctamente.', 'success');
    } else {
      await apiFetch('/api/admin/productos', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      showToast('Producto creado exitosamente.', 'success');
    }

    cancelEditProduct();
    await loadProducts();
  } catch (error) {
    showToast(error.message || 'Error al guardar el producto.', 'error');
  } finally {
    setButtonLoading(elements.productSubmitBtn, false, defaultBtnText);
  }
}

/**
 * Desactiva un producto del catálogo (borrado lógico).
 */
async function deactivateProduct(id, nombre) {
  const confirmacion = window.confirm(`¿Estás seguro de que deseas desactivar el producto "${nombre}"?`);
  if (!confirmacion) return;

  try {
    const res = await apiFetch(`/api/admin/productos/${id}`, { method: 'DELETE' });
    showToast(res.mensaje || 'Producto desactivado.', 'success');
    if (state.editingProductId === id) {
      cancelEditProduct();
    }
    await loadProducts();
  } catch (error) {
    showToast(error.message || 'Error al desactivar el producto.', 'error');
  }
}

/**
 * Reactiva un producto previamente desactivado.
 */
async function reactivateProduct(id, nombre) {
  try {
    await apiFetch(`/api/admin/productos/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ activo: true })
    });
    showToast(`Producto "${nombre}" reactivado con éxito.`, 'success');
    await loadProducts();
  } catch (error) {
    showToast(error.message || 'Error al reactivar el producto.', 'error');
  }
}

// ==========================================
// GESTIÓN DE MESAS Y CÓDIGOS QR
// ==========================================

/**
 * Carga la lista de mesas activas y sus códigos QR asociados.
 */
async function loadTables() {
  try {
    const mesas = await apiFetch('/api/admin/mesas');
    state.tables = mesas;
    renderTables(mesas);
  } catch (error) {
    showToast(error.message || 'No se pudieron cargar las mesas.', 'error');
  }
}

/**
 * Renderiza la cuadrícula de tarjetas de mesas.
 */
function renderTables(mesas) {
  elements.mesasGrid.replaceChildren();

  if (!mesas || mesas.length === 0) {
    elements.mesasEmpty.classList.remove('hidden');
    return;
  }

  elements.mesasEmpty.classList.add('hidden');

  mesas.forEach((mesa) => {
    const card = document.createElement('article');
    card.className = 'bg-slate-50 border border-slate-200 rounded-xl p-5 flex flex-col justify-between shadow-sm hover:shadow transition';

    // Cabecera de la tarjeta
    const cardHeader = document.createElement('div');
    cardHeader.className = 'flex items-center justify-between mb-4';

    const title = document.createElement('h4');
    title.className = 'font-bold text-slate-900 text-lg flex items-center gap-2';
    title.textContent = `Mesa #${mesa.numero}`;

    const badge = document.createElement('span');
    badge.className = 'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800';
    badge.textContent = 'Activa';

    cardHeader.appendChild(title);
    cardHeader.appendChild(badge);
    card.appendChild(cardHeader);

    // Contenedor visual del QR
    const qrContainer = document.createElement('div');
    qrContainer.className = 'flex flex-col items-center justify-center p-3 bg-white rounded-lg border border-slate-200 mb-4 min-h-[180px]';

    const loadingText = document.createElement('p');
    loadingText.className = 'text-xs text-slate-400 animate-pulse';
    loadingText.textContent = 'Generando código QR...';
    qrContainer.appendChild(loadingText);
    card.appendChild(qrContainer);

    // Contenedor de Botones de Acción
    const actionsContainer = document.createElement('div');
    actionsContainer.className = 'flex flex-col gap-2 mt-auto';

    // Botón Desactivar Mesa
    const btnDesactivar = document.createElement('button');
    btnDesactivar.type = 'button';
    btnDesactivar.className = 'w-full py-2 px-3 text-xs font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 rounded-lg transition text-center';
    btnDesactivar.textContent = 'Desactivar mesa';
    btnDesactivar.onclick = () => deactivateTable(mesa.id, mesa.numero);

    actionsContainer.appendChild(btnDesactivar);
    card.appendChild(actionsContainer);

    elements.mesasGrid.appendChild(card);

    // Cargar QR y URL para esta mesa en específico
    apiFetch(`/api/admin/mesas/${mesa.id}/qr`)
      .then((qrData) => {
        qrContainer.replaceChildren();

        const img = document.createElement('img');
        img.src = qrData.qrDataUrl;
        img.alt = `Código QR para Mesa ${mesa.numero}`;
        img.className = 'w-40 h-40 object-contain rounded';
        qrContainer.appendChild(img);

        // Botón Descargar PNG
        const btnDescargar = document.createElement('a');
        btnDescargar.href = qrData.qrDataUrl;
        btnDescargar.download = `mesa-${mesa.numero}-qr.png`;
        btnDescargar.className = 'w-full py-2 px-3 text-xs font-semibold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 rounded-lg transition text-center block';
        btnDescargar.textContent = 'Descargar PNG';

        // Botón Probar Enlace
        const btnProbar = document.createElement('a');
        btnProbar.href = qrData.url;
        btnProbar.target = '_blank';
        btnProbar.rel = 'noopener noreferrer';
        btnProbar.className = 'w-full py-2 px-3 text-xs font-semibold text-slate-700 bg-slate-200 hover:bg-slate-300 rounded-lg transition text-center block';
        btnProbar.textContent = 'Probar enlace ↗';

        // Insertar botones antes del botón de desactivación
        actionsContainer.insertBefore(btnProbar, btnDesactivar);
        actionsContainer.insertBefore(btnDescargar, btnProbar);
      })
      .catch((err) => {
        qrContainer.replaceChildren();
        const errText = document.createElement('p');
        errText.className = 'text-xs text-rose-500 font-medium text-center';
        errText.textContent = 'Error al cargar QR';
        qrContainer.appendChild(errText);
      });
  });
}

/**
 * Creación de nueva mesa.
 */
async function handleMesaSubmit(event) {
  event.preventDefault();
  const numeroStr = elements.mesaNumero.value.trim();
  const numeroNum = Number(numeroStr);

  if (numeroStr === '' || isNaN(numeroNum) || !Number.isInteger(numeroNum) || numeroNum <= 0) {
    showToast('El número de mesa debe ser un entero positivo.', 'error');
    elements.mesaNumero.focus();
    return;
  }

  setButtonLoading(elements.mesaSubmitBtn, true, 'Crear Mesa', 'Creando...');

  try {
    const nuevaMesa = await apiFetch('/api/admin/mesas', {
      method: 'POST',
      body: JSON.stringify({ numero: numeroNum })
    });

    showToast(`Mesa #${nuevaMesa.numero} creada exitosamente.`, 'success');
    elements.mesaForm.reset();
    await loadTables();
  } catch (error) {
    // Si responde 409 Conflict o error de validación, se muestra el mensaje exacto
    showToast(error.message || 'Error al crear la mesa.', 'error');
  } finally {
    setButtonLoading(elements.mesaSubmitBtn, false, 'Crear Mesa');
  }
}

/**
 * Desactiva una mesa activa previa confirmación.
 */
async function deactivateTable(id, numero) {
  const confirmacion = window.confirm(`¿Estás seguro de que deseas desactivar la Mesa #${numero}?`);
  if (!confirmacion) return;

  try {
    const res = await apiFetch(`/api/admin/mesas/${id}`, { method: 'DELETE' });
    showToast(res.mensaje || `Mesa #${numero} desactivada correctamente.`, 'success');
    await loadTables();
  } catch (error) {
    showToast(error.message || 'Error al desactivar la mesa.', 'error');
  }
}

// ==========================================
// REGISTRO DE EVENTOS Y ARRANQUE
// ==========================================

function initApp() {
  // Eventos de sesión
  elements.loginForm.addEventListener('submit', handleLogin);
  elements.logoutBtn.addEventListener('click', handleLogout);

  // Eventos de pestañas
  elements.tabBtnMenu.addEventListener('click', () => switchTab('menu'));
  elements.tabBtnMesas.addEventListener('click', () => switchTab('mesas'));

  // Eventos de menú y productos
  elements.productForm.addEventListener('submit', handleProductSubmit);
  elements.productCancelBtn.addEventListener('click', cancelEditProduct);
  elements.refreshProductsBtn.addEventListener('click', loadProducts);

  // Eventos de mesas y QRs
  elements.mesaForm.addEventListener('submit', handleMesaSubmit);
  elements.refreshMesasBtn.addEventListener('click', loadTables);

  // Comprobar sesión al inicio
  checkSession();
}

// Iniciar aplicación una vez que el DOM esté listo
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}
