# Despliegue recomendado

La opcion mas sencilla para este proyecto es Render como Web Service de Node.js con un disco persistente.

Motivos:

- El chat ya usa un servidor Node con `ws`, y Render soporta WebSockets en servicios web.
- No hace falta separar frontend y backend: el mismo proceso Node sirve `interfaz/dist` y atiende el WebSocket.
- No hace falta migrar a una base relacional para este alcance. La persistencia se guarda en `storage/chat-data.json`.
- En Render se debe montar un Persistent Disk en `/opt/render/project/src/storage` para que usuarios, grupos e historial no se pierdan al reiniciar.

## Configuracion en Render

Puedes usar el archivo `render.yaml` incluido o crear el servicio manualmente:

- Tipo: Web Service
- Runtime: Node
- Build Command: `npm install && npm run build`
- Start Command: `npm start`
- Environment:
  - `CHAT_DB_PATH=/opt/render/project/src/storage/chat-data.json`
- Persistent Disk:
  - Mount path: `/opt/render/project/src/storage`
  - Size: `1 GB`

Sin disco persistente, el chat funciona, pero los datos se pierden cuando Render reinicia o redeploya el servicio.

## Ejecutar local

```bash
npm run build
npm start
```

Abre `http://localhost:8080`.
