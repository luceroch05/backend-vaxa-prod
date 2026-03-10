# Subir Vaxa Back a cPanel (Node.js)

## 1. Qué subir

Sube **todo el contenido** de la carpeta `_back` al **Application root** de tu app en cPanel (en tu caso, la ruta que corresponde a `vaxa.com.pe` / `api`).

- Incluye: `package.json`, `package-lock.json`, `tsconfig.json`, `server.js`, la carpeta `src/`, la carpeta `docs/` (opcional).
- **No subas** la carpeta `node_modules` (cPanel la generará con "Run NPM Install").
- **No subas** la carpeta `dist/` si no la tienes compilada; se creará en el servidor con `npm run build`.

Puedes subir por **File Manager** (ZIP y extraer) o por **Git** si cPanel lo tiene.

---

## 2. Configuración en cPanel (Node.js)

| Campo | Valor |
|-------|--------|
| **Node.js version** | 20.x o 22.x (la que tengas recomendada). |
| **Application mode** | **Production** (no Development). |
| **Application root** | La ruta donde subiste los archivos (ej. `vaxa.com.pe` o la que uses para la API). |
| **Application URL** | La que ya tienes (ej. `vaxa.com.pe` + subruta `api`). |
| **Application startup file** | **server.js** (este archivo arranca la app compilada). |

---

## 3. Pasos después de subir

1. **Run NPM Install**  
   En la misma pantalla de Node.js, pulsa **Run NPM Install** para instalar dependencias en el servidor.

2. **Compilar TypeScript**  
   Hay que generar la carpeta `dist/` en el servidor. Según tu cPanel:
   - Si tienes **Terminal** o **SSH**: entra a la carpeta de la app y ejecuta:
     ```bash
     npm run build
     ```
   - Si hay **“Run JS script”** o **“Run script”**: suele ser para un solo comando; si permite ejecutar `npm run build`, úsalo. Si no, tendrás que usar Terminal/SSH.

3. **Restart**  
   Pulsa **RESTART** (o STOP y luego arranca de nuevo) para que la app use el `server.js` y el `dist/` recién generado.

---

## 4. Comprobar que funciona

- **Health:**  
  `https://tu-dominio.com/api/health`  
  (o la URL que tengas según **Application URL**).  
  Debería responder algo como: `{ "ok": true, "service": "vaxa-back", ... }`.

- **Backoffice (con tenant):**  
  `GET https://tu-dominio.com/api/api/backoffice/empresas`  
  (o `.../api/backoffice/empresas` según cómo esté montada la subruta).  
  Header: `x-tenant-id: backoffice`.

La URL final depende de cómo cPanel monte la app: a veces es `dominio.com/api` y las rutas de Express quedan directamente ahí, entonces sería `dominio.com/api/health`, `dominio.com/api/backoffice/empresas`, etc.

---

## 5. Si el startup file no puede ser server.js

Si cPanel te exige otro nombre o un solo archivo de entrada, pon como **Application startup file**:

- **dist/index.js**

En ese caso, **sí o sí** tienes que ejecutar `npm run build` en el servidor (Terminal/SSH o script) antes de dar **Restart**, para que exista la carpeta `dist/` y ese archivo.

---

## Resumen

1. Subir código (sin `node_modules`, sin `dist`).
2. Application startup file: **server.js** (o **dist/index.js** si no usas server.js).
3. Application mode: **Production**.
4. **Run NPM Install**.
5. En el servidor: **npm run build** (Terminal/SSH o script).
6. **Restart** la aplicación.
