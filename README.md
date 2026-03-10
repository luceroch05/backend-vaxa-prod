# Vaxa Back — Multi-tenant

Backend con arquitectura multi-tenant. Una API para varias empresas (tenants); cada request identifica el tenant y solo ve/modifica datos de ese tenant.

## Estructura

```
src/
├── types/
│   ├── tenant.ts          # TenantConfig, TenantModules
│   └── express.d.ts       # req.tenant
├── tenants/
│   ├── tenants.config.ts  # Base de datos simulada de tenants (alineado al front)
│   └── get-tenant.ts      # getTenantConfig(tenantId)
├── middleware/
│   ├── tenant.middleware.ts     # Resuelve tenant del header x-tenant-id
│   └── module-guard.middleware.ts  # requireModule('pacientes') → 403 si no tiene el módulo
├── modules/
│   ├── dashboard/
│   │   ├── dashboard.service.ts
│   │   └── dashboard.routes.ts   # GET /api/dashboard/config (módulo dashboard)
│   └── pacientes/
│       ├── pacientes.types.ts
│       ├── pacientes.store.ts   # Almacén en memoria por tenant (ejemplo; luego BD)
│       ├── pacientes.service.ts # CRUD filtrado por tenantId
│       └── pacientes.routes.ts  # CRUD bajo /api/pacientes (módulo pacientes)
└── index.ts                # Express app, monta rutas con tenantMiddleware
```

## Cómo probar

```bash
npm install
npm run dev
```

- **Sin tenant:** `GET http://localhost:4000/health` → `{ ok: true }`
- **Con tenant (dashboard):**  
  `GET http://localhost:4000/api/dashboard/config`  
  Header: `x-tenant-id: empresa-demo` → config del tenant y módulos
- **Con tenant (pacientes):**  
  `empresa-demo` tiene módulo pacientes; `empresa-techpro` no.  
  `GET http://localhost:4000/api/pacientes` con `x-tenant-id: empresa-demo` → lista (vacía al inicio).  
  Con `x-tenant-id: empresa-techpro` → 403 (módulo no disponible).
- **Crear paciente:**  
  `POST http://localhost:4000/api/pacientes`  
  Headers: `x-tenant-id: empresa-demo`, `Content-Type: application/json`  
  Body: `{ "nombre": "Juan", "email": "juan@mail.com" }`

## Subir a cPanel

Sube a la **Application root** (ej: `vaxa.com.pe`) solo esto:

| Incluir | Descripción |
|--------|-------------|
| **server.js** | Archivo de arranque (Application startup file). |
| **package.json** | Dependencias. |
| **package-lock.json** | Bloqueo de versiones (recomendado). |
| **dist/** | Carpeta completa (código compilado). Generar antes con `npm run build`. |

**No subas:** `node_modules`, `src/`, `tsconfig.json`, `.git`, `docs/`.  
En cPanel: **Run NPM Install** para instalar dependencias en el servidor.

Resumen: en la raíz de la app en el servidor deben estar `server.js`, `package.json`, `package-lock.json` y la carpeta `dist/` con todo su contenido.

---

## Front

En cada llamada a la API, envía el header:

```
x-tenant-id: empresa-techpro
```

(o el id del tenant que corresponda). El backend resuelve la config y filtra datos por ese tenant.
