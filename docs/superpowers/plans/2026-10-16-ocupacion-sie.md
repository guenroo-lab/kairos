# Ocupación SIE en Kairos y Centinela — plan y estado

Spec: `docs/superpowers/specs/2026-10-16-ocupacion-sie-design.md`. Estado a 16/10/2026: **todo el código hecho y
probado, NADA desplegado** (cada despliegue pide el «sí» de Pedro).

## Hecho

| Pieza | Ficheros | Pruebas |
|---|---|---|
| Motor (app Ocupación Tiendas SIE) | `OcupacionTiendas/Api.js` (nuevo), `WebApp.js` (3 líneas en `doGet`), `.claspignore` (`test/**`), `test/api.test.js` | 31 pruebas con el código real de `Código.js`+`WebApp.js`+`Api.js` y una hoja en memoria; 24/24 mutaciones detectadas. `soloGuardarDatos` y `procesarEnvioPendiente` intactos (el trigger recoge la fila nueva: probado). |
| Kairos operario + jefe | `kairos-operario/Ocupacion.js`, `OcupacionSieUI.html` (nuevos), `Index.html` (menú, pestaña de jefe, rutas, include) | `test/ocupacionSie.test.js` (35); 36/36 mutaciones detectadas; guardián de HtmlService en verde; arnés de Chrome con el `Index.html` real y un motor simulado: menú, formulario, errores, confirmación (con aviso «ya hay uno hoy» y «crítica»), enviado, corregir, «ya enviado», fallo de red + reintento, vista de jefe (escritorio, móvil, oscuro, modo pruebas). |
| Centinela | `centinela/OcupacionSie.gs`, `OcupacionSieUI.html` (nuevos), `Config.gs` (`OCUPACION_SIE_URL`), `ShellUI.html` (panel, botón, gancho), `test/ocupacionSie.test.js` | 15 pruebas; 24/24 mutaciones detectadas; arnés de Chrome: escritorio, móvil, oscuro, copia, error, permiso, vacío, un solo registro. |

## Despliegue (orden fijo; ninguno hecho)

Antes de cada `clasp push`: `clasp pull --versionNumber <viva>` a una carpeta aparte (con su propio `.clasp.json` de
`rootDir:"."`), diff contra el local y partir de la viva si hay cambios ajenos. Después de cada deploy: otro pull de la
versión nueva y diff (solo deben cambiar mis ficheros).

1. **Motor** — local == @26 (comprobado el 16/10). `clasp push --force` → `clasp version "API para Kairos y Centinela"` →
   `clasp deploy -i AKfycbw1ssfsAFEHBS1mm0ya_pE3nNOJALrqPqfXbK0lmQ9uQVZJVk2OqOF2lzV98VdPcTRZ1g -V 27`.
   No pide permisos nuevos. Comprobar abriendo `/a/macros/ext.leroymerlin.es/s/<id>/exec?accion=ocupacion` con la sesión de
   Pedro (debe salir un JSON con `"ok":true`) y que la app de siempre (sin `?accion`) carga igual.
   Vuelta atrás: `… -V 26`.
2. **Kairos operario** — viva = v82 = git 7ac298e (comprobado el 16/10). Sin cambios de manifiesto (ya tiene `drive` y
   `script.external_request`). `clasp push --force` → `clasp version` (v83) →
   `clasp deploy -i AKfycbzdmLGTnMMueEn6gu__NGxlnkqjkNci1Lb8rAnLoNXfJ8mkjVNzk5BqxeNDAlf2Vav55A -V 83`. Vuelta atrás `-V 82`.
   Si el menú dice «Sin conexión» o la pantalla «no ha respondido con datos»: poner la propiedad de script
   `OCUPACION_WEBAPP_URL` con la URL en forma `/a/macros/ext.leroymerlin.es/s/<id>/exec` (sin tocar código).
3. **Centinela** — viva = v80. El árbol local trae cambios de OTRAS sesiones sin desplegar (`CargasUI.html`,
   `.clasp.json`, un plan en `docs/`): partir de `clasp pull --versionNumber 80` y copiar encima SOLO `OcupacionSie.gs`,
   `OcupacionSieUI.html`, `Config.gs` y `ShellUI.html` (comprobar que `ShellUI.html` de la viva no difiere del local salvo mis 3 hunks).
   `clasp deploy -i AKfycbwmhHWgXRZ8f1PKM7Ko-VxFUMU2NW4A02vPFJ9oULMWhuYonML36X6hREma-sKe-6sqzw -V <n>`. Vuelta atrás `-V 80`.
   Cada jefe puede ver el aviso de permisos la primera vez (ya lo aceptaron para HODOS).

## Prueba real (con Pedro, tras desplegar 1 y 2)

1. En el Sheet de Ocupación: menú «🧪 Volver a modo PRUEBAS» (`B14` ≠ `PRODUCCION`): los 3 correos irán solo a Pedro.
2. En Kairos (modo operario) → «Ocupación SIE»: registrar unos números, revisar, guardar. Debe aparecer «En cola» y a los
   ≤ 5 min «Informes enviados»; llegan 3 correos a Pedro con el asunto `[TEST · …]`. Probar también «Corregir» antes de
   que salgan.
3. Mirar el mismo registro en la pestaña de jefe de Kairos y en Centinela (tras desplegar 3).
4. Borrar la fila de prueba de `Registro Semanal` y volver a «✅ PASAR A PRODUCCIÓN».

## Pendiente / ideas fuera de alcance

- `Configuración!B6` sigue con `salvador.gonzalez22@…` (posible typo) — sin confirmar con Pedro.
- Recordatorio por correo si pasan > 4 días sin registro (hoy solo se ve en el botón del menú de Kairos).
- Desglose por zona o pasillo; contar una sola tienda por registro; migrar el histórico a Supabase.
- `OcupacionTiendas` no tiene repositorio git: los cambios del motor están solo en la carpeta (copia de la viva en el scratchpad de la sesión).
