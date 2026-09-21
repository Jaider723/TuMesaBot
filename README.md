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

## Requisitos Preliminares y Backlog Inicial

### Requisitos Funcionales (RF)
* **RF01:** El sistema debe permitir al usuario acceder al chat con el bot que le proporcionará el menú al escanear el código QR.
* **RF02:** El sistema debe permitir al usuario seleccionar productos, especificar cantidades y añadir notas personalizadas (ej. "sin cebolla").
* **RF03:** El sistema debe calcular y mostrar automáticamente el costo total del pedido antes de que el usuario lo confirme.
* **RF04:** El sistema debe proporcionar un tiempo estimado de preparación del pedido basándose en los productos seleccionados.
* **RF05:** El sistema debe notificar y visualizar en tiempo real la orden confirmada en la interfaz del equipo de cocina, incluyendo el número de mesa correspondiente.

### Requisitos No Funcionales (RNF)
* **RNF01:** La aplicación debe funcionar de manera responsiva y fluida en navegadores móviles estándar (HTML5) sin requerir instalación nativa[cite: 15].
* **RNF02:** El backend (desarrollado en Python y Django) debe procesar el envío del pedido a la cocina con una latencia no mayor a 2 segundos en condiciones normales de red[cite: 15].
* **RNF03:** El sistema debe asignar automáticamente el número de mesa a la sesión del usuario con base en el código QR único escaneado, sin pedirle al usuario que lo ingrese manualmente[cite: 15].

### Historias de Usuario
* **HU01:** Como comensal, quiero escanear un código QR para acceder al menú interactivo, para decidir qué ordenar de forma autónoma y rápida[cite: 15].
* **HU02:** Como comensal, quiero armar mi pedido y ver el tiempo/costo estimado, para confirmar mi orden con seguridad y saber cuánto esperaré[cite: 15].
* **HU03:** Como personal de cocina, quiero recibir las comandas digitales automáticamente, para comenzar a preparar los platos sin necesidad de que el mesero venga físicamente[cite: 15].

**Flujo de Interacción:**
```mermaid
sequenceDiagram
    autonumber
    actor C as Comensal
    participant S as Tu Mesa Bot (Sistema)
    actor P as Personal de Cocina

    Note over C, S: HU01: Acceso al menú interactivo
    C->>S: Escanea código QR de la mesa
    S-->>C: Despliega menú digital (categorías y precios)

    Note over C, S: HU02: Armado y confirmación del pedido
    C->>S: Selecciona platos, cantidades y añade notas
    S-->>C: Calcula y muestra costo total y tiempo estimado
    C->>S: Confirma el pedido

    Note over S, P: HU03: Recepción de comandas en cocina
    S->>P: Envía orden digital (N° de mesa, ítems, notas)
    Note right of P: Visualiza la orden en pantalla<br/>y comienza la preparación
