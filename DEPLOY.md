# Despliegue recomendado

La opcion mas sencilla para este proyecto es Render como Web Service de Node.js con Supabase para la persistencia.

Motivos:

- El chat ya usa un servidor Node con `ws`, y Render soporta WebSockets en servicios web.
- No hace falta separar frontend y backend: el mismo proceso Node sirve `interfaz/dist` y atiende el WebSocket.
- No hace falta migrar a tablas complejas. Supabase guarda el estado del chat en una fila JSON de Postgres.
- Si no configuras Supabase, el proyecto usa `storage/chat-data.json` como fallback local.

## Configuracion en Supabase

1. Crea un proyecto en Supabase.
2. Abre SQL Editor.
3. Ejecuta el contenido de `supabase.sql`.
4. Copia estos valores desde Project Settings > API:
   - Project URL
   - `service_role` key

La `service_role` key solo debe ir en Render como variable de entorno. No la pegues en el frontend ni la subas a GitHub.

## Configuracion en Render

Puedes usar el archivo `render.yaml` incluido o crear el servicio manualmente:

- Tipo: Web Service
- Runtime: Node
- Build Command: `npm install && npm run build`
- Start Command: `npm start`
- Environment:
  - `SUPABASE_URL=<Project URL de Supabase>`
  - `SUPABASE_SERVICE_ROLE_KEY=<service_role key de Supabase>`
  - `SUPABASE_CHAT_TABLE=chat_state` opcional
  - `CHAT_DB_PATH=/opt/render/project/src/storage/chat-data.json` opcional como fallback local
- Persistent Disk: ya no es necesario si Supabase esta configurado.

Sin Supabase ni disco persistente, el chat funciona, pero los datos se pierden cuando Render reinicia o redeploya el servicio.

## Ejecutar local

```bash
npm run build
npm start
```

Abre `http://localhost:8080`.
