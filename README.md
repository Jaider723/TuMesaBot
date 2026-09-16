# Tu Mesa Bot: Asistente Web para Atención en Mesa

## Descripción del Proyecto
* **Contexto:** Pequeños y medianos restaurantes con alta demanda que presentan cuellos de botella en el servicio a la mesa.
* **Problema:** La sobrecarga del personal de servicio genera retrasos observables en la atención y una experiencia negativa.
* **Justificación:** Agilizar el servicio beneficia a los dueños aumentando la rotación de mesas y reduce la sobrecarga del personal. También mejora la experiencia de servicio del cliente.

## Objetivos
**Objetivo General:** Desarrollar un bot de asistencia web para agilizar los tiempos de atención en mesa en restaurantes pymes.

**Objetivos Específicos:**
1. Diseñar la interfaz web del bot.
2. Integrar las notificaciones con la cocina.
3. Medir tiempos de respuesta.

## Alcance
* **Incluye:** Aplicación web accesible mediante código QR para iniciar un chat con el bot de asistencia que tendrá la capacidad de dar información del menú, tomar pedido, calcular costo de pedido, calcular tiempo estimado de pedido.
* **Fuera de Alcance:** Pasarelas de pago electrónico, facturación e integración con otros servicios contables de la mesa.

---

## Mapa de Ciclo de Vida del Desarrollo

### 1. Contextualización
* **Pregunta:** ¿Qué problema existe y quién lo vive?
* **Evidencias:** Diagnóstico de la demora y congestión en la atención de mesas durante horas pico. Listado de stakeholders: Propietarios, meseros, comensales y el equipo de desarrollo.

### 2. Requisitos
* **Pregunta:** ¿Qué debe hacer y bajo qué condiciones?
* **Requisitos Funcionales (RF):** El bot debe dar información del menú, tomar pedido, calcular costo y calcular el tiempo estimado del pedido.
* **Requisitos No Funcionales (RNF):** El sistema debe funcionar fluidamente en navegadores móviles estándar (HTML5) sin instalar aplicaciones nativas.
* **Evidencias:** Documentación de RF, RNF e historias de usuario.

### 3. Diseño
* **Pregunta:** ¿Cómo se organizará la solución?
* **Evidencias:** Diseño de la interfaz web del bot y la arquitectura para integrar las notificaciones con la cocina.

### 4. Construcción
* **Pregunta:** ¿Cómo se implementa?
* **Evidencias:** Código fuente de la aplicación web en HTML5, junto con el registro de ramas y commits del desarrollo.

### 5. Pruebas
* **Pregunta:** ¿Cumple lo esperado?
* **Evidencias:** Casos de prueba para medir tiempos de respuesta y evaluar la latencia del servidor. Resultados y reporte de defectos.

### 6. Entrega
* **Pregunta:** ¿Qué versión se libera?
* **Evidencias:** Aplicación web accesible mediante código QR. Manuales de usuario y notas de la versión.

---

## Enfoques de Trabajo
* **Predictivo:** Planificación más detallada al inicio.
* **Iterativo:** La solución se refina mediante ciclos.
* **Incremental:** Se entregan capacidades progresivamente.
* **Ágil (Recomendado):** Prioriza valor, retroalimentación frecuente y adaptación. Ideal para mitigar la resistencia al uso por clientes tradicionales y la falta de adopción del personal.

## Roles
* **Stakeholder/cliente:** Propietarios de los restaurantes.
* **Usuario:** Comensales del restaurante y personal de servicio (meseros y equipo de cocina).
* **Equipo de desarrollo:** Encargados de la construcción de la aplicación.
* **Responsable del producto / Líder:** Coordina el proyecto y define el valor a entregar.
* **Responsable de pruebas/calidad:** Encargado de verificar los tiempos de respuesta y probar la latencia del servidor.
