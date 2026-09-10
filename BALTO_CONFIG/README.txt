BALTO - CONFIGURACION CENTRAL DEL FRONTEND
==========================================

OBJETIVO
--------
Una sola URL controla:
- BALTO_LOGIN
- BALTO_COMERCIO
- BALTO_SERVICIOS
- Playwright COMERCIO
- Playwright SERVICIOS

UNICO ARCHIVO QUE SE EDITA
--------------------------
BALTO_CONFIG\balto.env

Tiene una sola linea activa:
BALTO_ORIGIN=https://balto.3devsnet.com

Para produccion:
BALTO_ORIGIN=https://app.balto.com.ar

No agregues /BALTO_COMERCIO, /BALTO_SERVICIOS ni /api/routes.
Eso se deriva automaticamente.

INSTALACION (UNA SOLA VEZ)
--------------------------
1. Extraer la carpeta BALTO_CONFIG en la raiz del repo BALTO, al lado de:
   BALTO_LOGIN
   BALTO_COMERCIO
   BALTO_SERVICIOS

2. Ejecutar:
   BALTO_CONFIG\INSTALAR_CONFIG_CENTRAL.bat

El instalador:
- hace backup de package.json y .env actuales;
- agrega balto:sync en cada package.json;
- hace que npm start y npm run build sincronicen antes de correr;
- reescribe los .env runtime con URLs derivadas de BALTO_ORIGIN;
- conserva cualquier otra variable activa que ya existiera;
- actualiza PW_API_URL sin tocar los tests.

USO DIARIO
----------
A) Cambia SOLO BALTO_CONFIG\balto.env.

B) Build normal desde cualquier frontend:
   npm run build

El prebuild sincroniza TODO automaticamente antes del build.

Tambien podes usar desde la raiz:
   BALTO_CONFIG\BUILD_LOGIN.bat
   BALTO_CONFIG\BUILD_COMERCIO.bat
   BALTO_CONFIG\BUILD_SERVICIOS.bat
   BALTO_CONFIG\BUILD_TODO.bat

PLAYWRIGHT
----------
Usa:
   BALTO_CONFIG\TEST_COMERCIO.bat
   BALTO_CONFIG\TEST_SERVICIOS.bat

Ambos sincronizan primero y fuerzan PW_API_URL a la URL central.

Tambien podes seguir usando tus scripts viejos despues de ejecutar:
   BALTO_CONFIG\SYNC_CONFIG.bat

No se modifica ningun .spec.js ni la logica de testing.

URLS DERIVADAS
--------------
Si BALTO_ORIGIN=https://app.balto.com.ar, se generan:

LOGIN API:
https://app.balto.com.ar/BALTO_LOGIN/api/routes

COMERCIO API:
https://app.balto.com.ar/BALTO_COMERCIO/api/routes

SERVICIOS API:
https://app.balto.com.ar/BALTO_SERVICIOS/api/routes

LOGIN GLOBAL:
https://app.balto.com.ar/

IMPORTANTE
----------
Los .env dentro de cada frontend pasan a ser ARCHIVOS GENERADOS.
No hay que volver a editarlos manualmente.

Se escriben tanto los nombres actuales como los aliases que hoy usa el codigo
(REACT_APP_BALTO_LOGIN_URL y REACT_APP_BALTO_ACCESS_URL; REACT_APP_API_URL y
REACT_APP_AUTH_API_BASE) para evitar romper el frontend mientras se elimina
la configuracion duplicada.

Los overrides CRA (.env.local, .env.development.local y .env.production.local)
solo se tocan SI YA EXISTEN, y se sincronizan para que una URL vieja no pise
la central sin que te des cuenta.

BACKUP
------
La primera instalacion guarda copia de package.json y .env en:
BALTO_CONFIG\backup-instalacion\FECHA-HORA\...
