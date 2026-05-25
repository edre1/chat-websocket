import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { MENSAJES, construirMensaje, parsearMensaje } from "../shared/chatProtocol.js";
import { createChatStore } from "./storeFactory.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const raizProyecto = path.resolve(__dirname, "../..");
const distPath = path.join(raizProyecto, "interfaz", "dist");
const storagePath = process.env.CHAT_DB_PATH || path.join(raizProyecto, "storage", "chat-data.json");

const tipos = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

class wsServer {
  constructor(store) {
    this.store = store;
    this.server = http.createServer((req, res) => this.http(req, res));
    this.wss = new WebSocketServer({ server: this.server });
    this.port = Number(process.env.PORT || 8080);

    this.wss.on("connection", (ws) => {
      this.MSG(ws, MENSAJES.IDENTIFICATE);

      ws.on("message", async (datos) => {
        const paquete = parsearMensaje(datos);
        if (!paquete) return;

        const { mensaje, data } = paquete;
        if (this[mensaje] && typeof this[mensaje] === "function") {
          try {
            await this[mensaje](ws, data);
          } catch (error) {
            console.error(`Error gestionando ${mensaje}:`, error);
          }
        }
      });

      ws.on("close", async () => {
        if (ws.data) {
          await this.store.touchUser(ws.data);
          await this.broadcastUsuarios();
          console.log(`${ws.data} desconectado`);
        }
      });
    });

    this.server.listen(this.port, () => {
      console.log(`Servidor iniciado en http://localhost:${this.port}`);
    });
  }

  http(req, res) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const solicitado = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    const destino = path.normalize(path.join(distPath, solicitado));

    if (!destino.startsWith(distPath)) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }

    const archivo = fs.existsSync(destino) && fs.statSync(destino).isFile()
      ? destino
      : path.join(distPath, "index.html");

    if (!fs.existsSync(archivo)) {
      res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
      res.end("Ejecuta `npm run build` antes de desplegar o servir el frontend.");
      return;
    }

    res.writeHead(200, { "content-type": tipos[path.extname(archivo)] ?? "application/octet-stream" });
    fs.createReadStream(archivo).pipe(res);
  }

  async IDENTIFICACION(ws, data) {
    const nombre = String(data ?? "").trim();
    if (!nombre) return;

    ws.data = nombre;
    await this.store.touchUser(nombre);
    await this.enviarHistorial(ws);
    await this.entregarPendientes(nombre);
    await this.broadcastUsuarios();
    console.log(`${ws.data} conectado...`);
  }

  async CONECTADOS(ws) {
    if (!ws.data) return;
    this.MSG(ws, MENSAJES.CONECTADOS, await this.usuariosPara(ws.data));
  }

  async CHAT(ws, data) {
    if (!ws.data || !data) return;

    const emisor = ws.data;
    const id = data.id || `${emisor}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const texto = String(data.mensaje ?? "").trim();
    if (!texto) return;

    if (data.grupoId) {
      const grupo = await this.store.getGroup(data.grupoId);
      if (!grupo || !grupo.miembros.includes(emisor)) return;

      const mensaje = await this.store.addMessage({
        id,
        ambito: "grupo",
        grupoId: grupo.id,
        grupoNombre: grupo.nombre,
        miembros: grupo.miembros,
        emisor,
        texto,
      });

      for (const miembro of grupo.miembros.filter((item) => item !== emisor)) {
        await this.enviarChat(miembro, mensaje);
      }
      return;
    }

    const receptores = Array.isArray(data.receptor) ? data.receptor.filter(Boolean) : [];
    for (const receptor of receptores) {
      const mensaje = await this.store.addMessage({
        id: receptores.length === 1 ? id : `${id}-${receptor}`,
        ambito: "privado",
        emisor,
        receptor,
        texto,
      });

      await this.enviarChat(receptor, mensaje);
    }
    await this.broadcastUsuarios();
  }

  async LEIDO(ws, data) {
    if (!ws.data || !data?.id) return;

    const lector = ws.data;
    const mensaje = await this.store.markRead(data.id, lector);
    if (!mensaje) return;

    const socketEmisor = this.socketId(mensaje.emisor);
    if (socketEmisor) {
      this.MSG(socketEmisor, MENSAJES.LEIDO, {
        id: mensaje.id,
        emisor: lector,
        grupoId: mensaje.grupoId,
      });
    }
  }

  async GRUPO(ws, data) {
    if (!ws.data || !data) return;

    const creador = ws.data;
    const miembros = [...new Set([creador, ...(Array.isArray(data.miembros) ? data.miembros : [])])].filter(Boolean);
    if (miembros.length < 2) return;

    const gruposCreador = await this.store.groupsFor(creador);
    const grupo = await this.store.upsertGroup({
      id: data.id || `grupo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      nombre: data.nombre || `Grupo ${gruposCreador.length + 1}`,
      miembros,
      creador,
    });

    for (const miembro of miembros) {
      this.enviarGrupo(miembro, grupo);
    }
    await this.broadcastUsuarios();
  }

  async EDITAR_GRUPO(ws, data) {
    if (!ws.data || !data?.grupoId) return;

    const grupoActual = await this.store.getGroup(data.grupoId);
    if (!grupoActual || grupoActual.creador !== ws.data) return;

    const miembrosAnteriores = [...grupoActual.miembros];
    const miembros = [...new Set([grupoActual.creador, ...(Array.isArray(data.miembros) ? data.miembros : [])])].filter(Boolean);
    if (miembros.length < 2) return;

    const grupo = await this.store.upsertGroup({ ...grupoActual, miembros });
    const removidos = miembrosAnteriores.filter((miembro) => !miembros.includes(miembro));

    miembros.forEach((miembro) => this.enviarGrupo(miembro, grupo));
    removidos.forEach((miembro) => {
      const socket = this.socketId(miembro);
      if (socket) this.MSG(socket, MENSAJES.GRUPO_ELIMINADO, { id: grupo.id });
    });
  }

  async ELIMINAR_GRUPO(ws, data) {
    if (!ws.data || !data?.grupoId) return;

    const grupo = await this.store.getGroup(data.grupoId);
    if (!grupo || grupo.creador !== ws.data) return;

    await this.store.deleteGroup(grupo.id);
    grupo.miembros.forEach((miembro) => {
      const socket = this.socketId(miembro);
      if (socket) this.MSG(socket, MENSAJES.GRUPO_ELIMINADO, { id: grupo.id });
    });
  }

  async enviarHistorial(ws) {
    this.MSG(ws, MENSAJES.HISTORIAL, {
      usuarios: await this.usuariosPara(ws.data),
      grupos: await this.store.groupsFor(ws.data),
      mensajes: await this.store.messagesFor(ws.data),
    });
  }

  async entregarPendientes(usuario) {
    const mensajes = await this.store.messagesFor(usuario);
    const pendientes = mensajes
      .filter((mensaje) => mensaje.tipo === "recibido" && !(mensaje.entregadoA ?? []).includes(usuario));

    for (const mensaje of pendientes) {
      await this.store.markDelivered(mensaje.id, usuario);
    }
  }

  async enviarChat(usuario, mensaje) {
    const socket = this.socketId(usuario);
    if (!socket) return;

    await this.store.markDelivered(mensaje.id, usuario);
    this.MSG(socket, MENSAJES.CHAT, {
      id: mensaje.id,
      emisor: mensaje.emisor,
      mensaje: mensaje.texto,
      grupoId: mensaje.grupoId,
      grupoNombre: mensaje.grupoNombre,
      miembros: mensaje.miembros,
    });
  }

  enviarGrupo(usuario, grupo) {
    const socket = this.socketId(usuario);
    if (socket) this.MSG(socket, MENSAJES.GRUPO, grupo);
  }

  async broadcastUsuarios() {
    for (const cliente of this.wss.clients) {
      if (cliente.data) {
        this.MSG(cliente, MENSAJES.CONECTADOS, await this.usuariosPara(cliente.data));
      }
    }
  }

  async usuariosPara(usuario) {
    return this.store.usersFor(usuario, this.conectados());
  }

  conectados() {
    const usuarios = new Set();
    for (const cliente of this.wss.clients) {
      if (cliente.data) usuarios.add(cliente.data);
    }
    return usuarios;
  }

  socketId(id) {
    for (const cliente of this.wss.clients) {
      if (cliente.data === id) return cliente;
    }
    return null;
  }

  MSG(ws, mensaje, data) {
    if (ws.readyState === 1) {
      ws.send(construirMensaje(mensaje, data));
    }
  }
}

const store = await createChatStore(storagePath);
new wsServer(store);
