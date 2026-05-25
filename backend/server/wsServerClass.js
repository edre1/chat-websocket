import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { MENSAJES, construirMensaje, parsearMensaje } from "../shared/chatProtocol.js";
import { ChatStore } from "./chatStore.js";

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
  constructor() {
    this.store = new ChatStore(storagePath);
    this.server = http.createServer((req, res) => this.http(req, res));
    this.wss = new WebSocketServer({ server: this.server });
    this.port = Number(process.env.PORT || 8080);

    this.wss.on("connection", (ws) => {
      this.MSG(ws, MENSAJES.IDENTIFICATE);

      ws.on("message", (datos) => {
        const paquete = parsearMensaje(datos);
        if (!paquete) return;

        const { mensaje, data } = paquete;
        if (this[mensaje] && typeof this[mensaje] === "function") {
          this[mensaje](ws, data);
        }
      });

      ws.on("close", () => {
        if (ws.data) {
          this.store.touchUser(ws.data);
          this.broadcastUsuarios();
          console.log(`${ws.data} desconectado`);
        }
      });
    });

    this.server.listen(this.port, () => {
      console.log(`Servidor iniciado en http://localhost:${this.port}`);
      console.log(`Base persistente: ${storagePath}`);
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

  IDENTIFICACION(ws, data) {
    const nombre = String(data ?? "").trim();
    if (!nombre) return;

    ws.data = nombre;
    this.store.touchUser(nombre);
    this.enviarHistorial(ws);
    this.entregarPendientes(nombre);
    this.broadcastUsuarios();
    console.log(`${ws.data} conectado...`);
  }

  CONECTADOS(ws) {
    if (!ws.data) return;
    this.MSG(ws, MENSAJES.CONECTADOS, this.usuariosPara(ws.data));
  }

  CHAT(ws, data) {
    if (!ws.data || !data) return;

    const emisor = ws.data;
    const id = data.id || `${emisor}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const texto = String(data.mensaje ?? "").trim();
    if (!texto) return;

    if (data.grupoId) {
      const grupo = this.store.getGroup(data.grupoId);
      if (!grupo || !grupo.miembros.includes(emisor)) return;

      const mensaje = this.store.addMessage({
        id,
        ambito: "grupo",
        grupoId: grupo.id,
        grupoNombre: grupo.nombre,
        miembros: grupo.miembros,
        emisor,
        texto,
      });

      grupo.miembros
        .filter((miembro) => miembro !== emisor)
        .forEach((miembro) => this.enviarChat(miembro, mensaje));
      return;
    }

    const receptores = Array.isArray(data.receptor) ? data.receptor.filter(Boolean) : [];
    receptores.forEach((receptor) => {
      const mensaje = this.store.addMessage({
        id: receptores.length === 1 ? id : `${id}-${receptor}`,
        ambito: "privado",
        emisor,
        receptor,
        texto,
      });

      this.enviarChat(receptor, mensaje);
    });
    this.broadcastUsuarios();
  }

  LEIDO(ws, data) {
    if (!ws.data || !data?.id) return;

    const lector = ws.data;
    const mensaje = this.store.markRead(data.id, lector);
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

  GRUPO(ws, data) {
    if (!ws.data || !data) return;

    const creador = ws.data;
    const miembros = [...new Set([creador, ...(Array.isArray(data.miembros) ? data.miembros : [])])].filter(Boolean);
    if (miembros.length < 2) return;

    const grupo = this.store.upsertGroup({
      id: data.id || `grupo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      nombre: data.nombre || `Grupo ${this.store.groupsFor(creador).length + 1}`,
      miembros,
      creador,
    });

    miembros.forEach((miembro) => this.enviarGrupo(miembro, grupo));
    this.broadcastUsuarios();
  }

  EDITAR_GRUPO(ws, data) {
    if (!ws.data || !data?.grupoId) return;

    const grupoActual = this.store.getGroup(data.grupoId);
    if (!grupoActual || grupoActual.creador !== ws.data) return;

    const miembrosAnteriores = [...grupoActual.miembros];
    const miembros = [...new Set([grupoActual.creador, ...(Array.isArray(data.miembros) ? data.miembros : [])])].filter(Boolean);
    if (miembros.length < 2) return;

    const grupo = this.store.upsertGroup({ ...grupoActual, miembros });
    const removidos = miembrosAnteriores.filter((miembro) => !miembros.includes(miembro));

    miembros.forEach((miembro) => this.enviarGrupo(miembro, grupo));
    removidos.forEach((miembro) => {
      const socket = this.socketId(miembro);
      if (socket) this.MSG(socket, MENSAJES.GRUPO_ELIMINADO, { id: grupo.id });
    });
  }

  ELIMINAR_GRUPO(ws, data) {
    if (!ws.data || !data?.grupoId) return;

    const grupo = this.store.getGroup(data.grupoId);
    if (!grupo || grupo.creador !== ws.data) return;

    this.store.deleteGroup(grupo.id);
    grupo.miembros.forEach((miembro) => {
      const socket = this.socketId(miembro);
      if (socket) this.MSG(socket, MENSAJES.GRUPO_ELIMINADO, { id: grupo.id });
    });
  }

  enviarHistorial(ws) {
    this.MSG(ws, MENSAJES.HISTORIAL, {
      usuarios: this.usuariosPara(ws.data),
      grupos: this.store.groupsFor(ws.data),
      mensajes: this.store.messagesFor(ws.data),
    });
  }

  entregarPendientes(usuario) {
    this.store.messagesFor(usuario)
      .filter((mensaje) => mensaje.tipo === "recibido" && !(mensaje.entregadoA ?? []).includes(usuario))
      .forEach((mensaje) => this.store.markDelivered(mensaje.id, usuario));
  }

  enviarChat(usuario, mensaje) {
    const socket = this.socketId(usuario);
    if (!socket) return;

    this.store.markDelivered(mensaje.id, usuario);
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

  broadcastUsuarios() {
    for (const cliente of this.wss.clients) {
      if (cliente.data) {
        this.MSG(cliente, MENSAJES.CONECTADOS, this.usuariosPara(cliente.data));
      }
    }
  }

  usuariosPara(usuario) {
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

new wsServer();
