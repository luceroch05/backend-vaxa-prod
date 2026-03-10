# Cómo sería la arquitectura multi-tenant en backend

Solo la idea: qué piezas hay y cómo se relacionan. Sin código.

---

## Decisión para Vaxa

**Por el momento: 2 empresas → usar arquitectura multi-tenant en backend.**

- Una sola API y una sola base de datos.
- Cada request identifica la empresa (tenant) y solo ve/modifica datos de esa empresa.
- Si más adelante sumas una 3.ª empresa, solo agregas su config; la arquitectura ya está lista.

---

## La idea en una frase

**Una sola API para todos los clientes (tenants).** En cada petición el backend sabe “quién es el tenant” y hace dos cosas: (1) solo deja ver/hacer lo que ese tenant tiene permitido (módulos) y (2) solo muestra datos de ese tenant.

---

## Flujo de una petición (de arriba a abajo)

```
  FRONT (ya sabe el tenant, ej: empresa-techpro)
       │
       │  "Dame los pacientes"  +  header: "este request es del tenant X"
       ▼
  ┌─────────────────────────────────────────────────────────┐
  │  BACKEND                                                 │
  │                                                          │
  │  1. ENTRADA                                              │
  │     Lee de la petición: "¿qué tenant es este request?"   │
  │     (por header, subdominio o token)                      │
  │                          ▼                               │
  │  2. CONFIG DEL TENANT                                    │
  │     Busca la config de ese tenant:                       │
  │     - id, nombre                                         │
  │     - qué módulos tiene (dashboard sí, pacientes no, …)   │
  │     Eso queda “pegado” al request para todo el resto.     │
  │                          ▼                               │
  │  3. ¿PUEDE ENTRAR A ESTA RUTA?                           │
  │     La ruta es "pacientes".                              │
  │     ¿Este tenant tiene el módulo pacientes?              │
  │     - Sí → sigue                                         │
  │     - No → responde "no permitido" (403)                 │
  │                          ▼                               │
  │  4. DATOS SOLO DE ESE TENANT                             │
  │     Cualquier consulta a BD usa siempre el tenant_id     │
  │     de este request. Así nunca ve datos de otro cliente.  │
  │                          ▼                               │
  │  5. RESPUESTA                                            │
  │     Devuelve al front solo lo que pidió, ya filtrado.    │
  └─────────────────────────────────────────────────────────┘
       │
       ▼
  FRONT recibe datos solo de su tenant y ya sabe qué módulos mostrar (como ahora).
```

---

## Piezas del backend (solo nombres y rol)

| Pieza | Rol en la arquitectura |
|-------|-------------------------|
| **Identificación del tenant** | En cada request, algo (header, subdominio, token) dice “este request es del tenant X”. |
| **Configuración de tenants** | Donde se guarda, por cada tenant: id, nombre y qué módulos tiene (dashboard, pacientes, citas, terapeutas, facturación, etc.). Puede ser un archivo o la base de datos. |
| **Resolución del tenant** | Paso que toma el “tenant X” del request, busca su config y la deja disponible para el resto del backend (por ejemplo en el “contexto” del request). |
| **Comprobación de módulo** | Antes de ejecutar la lógica de una ruta (ej. pacientes), se mira si ese tenant tiene ese módulo habilitado. Si no, se responde “no permitido”. |
| **Aislamiento de datos** | En base de datos, los datos “por cliente” tienen un campo tenant_id. Todas las consultas filtran por el tenant_id del request. Así un tenant nunca ve datos de otro. |
| **Módulos (rutas)** | Cada “sistema” (dashboard, pacientes, citas, terapeutas, facturación) es un conjunto de rutas. Esas rutas solo se ejecutan si el tenant tiene el módulo activo y siempre usando su tenant_id. |

No hace falta que pienses aún en archivos ni código: son estos **roles** los que definen la arquitectura.

---

## Cómo se ve la separación de datos

- **Una sola base de datos** (o una por tenant, según decidas después).
- Lo importante: **cada fila que sea “de un cliente” tiene un campo que indica a qué tenant pertenece** (tenant_id).
- Cualquier lectura o escritura **siempre** usa el tenant que salió del request. Así:
  - Tenant A solo ve sus pacientes, sus citas, su facturación.
  - Tenant B solo la suya.
  - No hay cruce entre tenants.

La arquitectura es: “cada request lleva su tenant; toda la lógica y toda la BD usan ese tenant”.

---

## Resumen visual de responsabilidades

```
  ┌──────────────────────────────────────────────────────────┐
  │  FRONT (ya lo tienes)                                     │
  │  - Sabe el tenant (subdominio / env / selección)          │
  │  - Envía ese tenant en cada llamada a la API              │
  │  - Muestra/oculta módulos según config                   │
  └──────────────────────────────────────────────────────────┘
                              │
                              │  Request + "soy tenant X"
                              ▼
  ┌──────────────────────────────────────────────────────────┐
  │  BACKEND (arquitectura multi-tenant)                      │
  │                                                          │
  │  • Identificar tenant por request                        │
  │  • Tener config por tenant (módulos encendido/apagado)   │
  │  • Bloquear acceso a rutas de módulos no permitidos      │
  │  • Filtrar todos los datos por tenant_id                 │
  └──────────────────────────────────────────────────────────┘
```

---

## Respuesta directa a “cómo sería la arquitectura en backend”

- **Una sola API** que en cada petición:
  1. **Sabe qué tenant es** (por header, subdominio o token).
  2. **Carga la config de ese tenant** (qué módulos tiene).
  3. **Comprueba** si la ruta que piden pertenece a un módulo permitido; si no, responde “no permitido”.
  4. **Usa siempre el tenant_id** en base de datos para que cada cliente solo vea y modifique sus propios datos.

Eso es la arquitectura: identificación de tenant → config de tenant → control por módulo → datos aislados por tenant. Sin agregar código aquí, así es como se vería por dentro del backend.

---

## Si lo haces con una sola ruta (arquitectura “normal”)

Es la opción **sin multi-tenant**: un solo “cliente”, un solo sistema. Una API clásica.

### Cómo sería

- **Una sola “instancia” del negocio.** No hay varios clientes (tenants); hay un único sistema: por ejemplo “la clínica” o “la empresa”. Todos los usuarios y todos los datos pertenecen a ese mismo sistema.
- **Rutas normales.** Ejemplo: `/api/pacientes`, `/api/citas`, `/api/terapeutas`. No hay header de tenant ni nada que indique “de qué cliente es este request”, porque solo hay uno.
- **Base de datos sin tenant_id.** Las tablas (pacientes, citas, facturación, etc.) no llevan un campo “a qué tenant pertenece”; todo es del mismo sistema.
- **Sin config por tenant.** No existe “este cliente tiene módulo X y este no”. O todos tienen todo, o la habilitación se hace por roles de usuario (admin, recepcionista, etc.), no por “cliente/tenant”.
- **Un solo front (o uno por ambiente).** Normalmente una sola app front que habla con esa API. Si mañana tienes otro cliente, sería otro backend o otra base de datos, no el mismo backend sirviendo a varios.

### Flujo simplificado

```
  FRONT
    │  "Dame los pacientes"  (sin decir de qué tenant)
    ▼
  BACKEND
    • Recibe la petición.
    • No resuelve tenant (no hay tenants).
    • Consulta BD sin filtrar por tenant_id (no existe ese campo).
    • Responde con los datos.
```

### Cuándo encaja

- Una sola empresa/clínica que usa el sistema.
- No planeas vender el mismo producto a varias empresas desde la misma API y la misma BD.
- Quieres algo más simple: menos capas, menos configuración, menos riesgo de filtrar mal por tenant.

### Resumen: multi-tenant vs “una sola ruta” (normal)

| | Multi-tenant | Arquitectura normal (una sola ruta) |
|---|--------------|-------------------------------------|
| **Clientes** | Varios (cada uno es un tenant). | Uno (un solo sistema). |
| **Request** | Lleva “de qué tenant es” (header, etc.). | No lleva tenant. |
| **BD** | Tablas con tenant_id; todo se filtra por tenant. | Sin tenant_id; todo es del mismo sistema. |
| **Módulos** | Por tenant (este tiene pacientes, este no). | Igual para todos, o por rol de usuario. |
| **Complejidad** | Mayor (identificar tenant, config, filtros). | Menor (API clásica). |

Si tu proyecto es “un solo cliente, un solo sistema”, la arquitectura normal con una sola ruta es suficiente. Si son “varios clientes/empresas usando el mismo backend”, entonces sí tiene sentido multi-tenant.

---

## ¿Es escalable? ¿Sirve para un proyecto grande / negocio con inversión?

### Respuesta corta

- **La arquitectura (la forma de organizar tenants, módulos, servicios, middleware)** → **Sí es escalable** y es la adecuada para un negocio con varios clientes/empresas. No hay que cambiar el modelo cuando crezcas.
- **La implementación actual del backend** → Es una **base**. Para un proyecto grande donde se invierte dinero hace falta subir el nivel en varios frentes (base de datos real, autenticación, observabilidad, etc.). Lo que tienes sirve para arrancar y para que el equipo entienda el flujo; no para dejarlo así en producción sin más.

### Qué tienes hoy (base sólida)

| Aspecto | Estado |
|--------|--------|
| Modelo multi-tenant (identificar tenant, config por tenant, módulos) | Bien resuelto; escalable. |
| Separación por tenant en lógica (req.tenant, filtro por tenant_id) | Bien; cuando pases a BD, el mismo criterio se mantiene. |
| Servicios por módulo (pacientes, dashboard) | Patrón correcto; se pueden sumar más módulos igual. |
| Middleware (tenant + module guard) | Reutilizable; no hay que reescribirlo. |

### Qué falta para un negocio serio / producción

| Área | Qué implica |
|------|-------------|
| **Base de datos** | Hoy: almacén en memoria (se pierde al reiniciar). Producción: BD real (PostgreSQL, etc.) con tablas que tengan `tenant_id`, índices por tenant, backups. |
| **Autenticación y autorización** | Hoy: cualquiera puede enviar `x-tenant-id` y “hacerse pasar” por un tenant. Producción: login (JWT/sesiones), verificar que el usuario pertenece al tenant que dice el request, roles por tenant. |
| **Config de tenants** | Hoy: archivo en código. Producción: en BD o servicio de config, para poder dar de alta/cambiar tenants sin desplegar. |
| **Logs y trazabilidad** | Hoy: casi nada. Producción: logging por request (tenant_id, user_id, ruta), para auditoría y soporte. |
| **Seguridad** | Rate limiting, CORS, validación de entrada, no exponer errores internos. |
| **Escalado horizontal** | Cuando el tráfico crezca: varias instancias del backend detrás de un balanceador; la BD y el diseño por tenant ya permiten eso. |
| **Contratos API** | Documentación (OpenAPI/Swagger), versionado de API si varios clientes dependen de ti. |

### Conclusión

- **Arquitectura** → Sí es escalable y adecuada para proyecto grande y negocio.
- **Implementación** → Hay que evolucionarla: BD real, auth, config de tenants persistida, logs y seguridad. El camino que tienes (tenant en cada request, servicios que reciben tenantId, módulos por tenant) es el correcto; lo que falta es reemplazar lo “de ejemplo” (memoria, config en código) por componentes de producción.

Si quieres, en el siguiente paso podemos bajar esto a una lista concreta de tareas (por ejemplo: “Fase 1: BD + tenant_id”, “Fase 2: Auth por tenant”) para tu backlog.

---

## Una BD para todas las empresas ahora, ¿y luego una BD por empresa? ¿Es configurable?

### Respuesta corta

**Sí, es configurable.** Puedes empezar con **una sola BD** para todas las empresas (tablas con `tenant_id`) y más adelante, si lo necesitas, dar a **algunas o todas las empresas su propia BD** sin reescribir la lógica de negocio. La clave es **abstraer el acceso a datos** detrás de una capa que decida “de dónde leo para este tenant”.

### Dos modelos típicos

| Modelo | Cómo funciona | Cuándo suele usarse |
|--------|----------------|---------------------|
| **Una BD compartida** | Todas las tablas tienen `tenant_id`. Todas las consultas filtran por ese campo. Una sola conexión a BD. | Fase inicial, muchas empresas pequeñas/medianas, operación más simple. |
| **Una BD por tenant** | Cada empresa tiene su propia base de datos (mismo esquema). La app elige a qué BD conectarse según el tenant del request. | Empresas grandes que exigen aislamiento total, normativa, o clientes que pagan por “su propia BD”. |

Puedes tener **los dos a la vez**: la mayoría en BD compartida y algunos tenants con BD dedicada. Eso se controla por **configuración por tenant** (por ejemplo: “este tenant usa la BD compartida” vs “este tenant tiene connectionString propio”).

### Cómo hacerlo configurable

1. **Capa de acceso a datos (repositorios / data source)**  
   En lugar de que los servicios hablen directo con “la” BD, hablan con una capa que recibe siempre el `tenantId` (y los parámetros de la consulta). Esa capa:
   - Lee la config del tenant: “¿este tenant usa BD compartida o BD propia?”
   - Si es compartida → usa la conexión global y **todas** las queries llevan `WHERE tenant_id = ?`.
   - Si es BD propia → usa la conexión (o pool) asociada a ese tenant y no necesita `tenant_id` en las queries (porque toda la BD es de ese tenant).

2. **Config por tenant**  
   En la config de cada tenant (hoy en `tenants.config`, luego en BD) puedes tener algo como:
   - `database: 'shared'` → usa la BD compartida (y entonces sí usas `tenant_id` en las tablas).
   - `database: { type: 'dedicated', connectionString: '...' }` → ese tenant tiene su propia BD; la capa de datos usa esa conexión para ese tenant.

3. **Servicios iguales**  
   Los servicios (pacientes, citas, etc.) siguen recibiendo solo `tenantId` y pidiendo “dame los pacientes de este tenant”. No les importa si detrás es una BD compartida o una dedicada; eso lo resuelve la capa de datos. Así **sí es configurable**: cambias config del tenant, no código.

### Resumen

- **Ahora:** Una BD para todas → tablas con `tenant_id`, una sola conexión. Totalmente válido.
- **Luego:** Si quieres una BD por empresa (o solo para algunas), añades la capa que “resuelve la conexión por tenant” y en la config del tenant indicas si usa compartida o dedicada. La lógica de negocio y los servicios no cambian; solo la capa de datos y la config.

Sí es configurable; solo hay que diseñar el acceso a datos detrás de esa abstracción desde el principio (o refactorizar cuando pases de memoria a BD real).
