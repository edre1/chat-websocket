import fs from "node:fs";
import path from "node:path";

const ESTADO_INICIAL = Object.freeze({
  users: {},
  groups: {},
  messages: [],
});

export class ChatStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.data = this.load();
  }

  load() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });

    if (!fs.existsSync(this.filePath)) {
      return structuredClone(ESTADO_INICIAL);
    }

    try {
      return {
        ...structuredClone(ESTADO_INICIAL),
        ...JSON.parse(fs.readFileSync(this.filePath, "utf8")),
      };
    } catch (error) {
      console.error("No se pudo leer la base persistente:", error);
      return structuredClone(ESTADO_INICIAL);
    }
  }

  save() {
    const temporal = `${this.filePath}.tmp`;
    fs.writeFileSync(temporal, JSON.stringify(this.data, null, 2));
    fs.renameSync(temporal, this.filePath);
  }

  touchUser(nombre) {
    const ahora = new Date().toISOString();
    const existente = this.data.users[nombre] ?? {};

    this.data.users[nombre] = {
      name: nombre,
      contacts: Array.isArray(existente.contacts) ? existente.contacts : [],
      createdAt: existente.createdAt ?? ahora,
      lastSeen: ahora,
    };
    this.save();
  }

  addContact(usuario, contacto) {
    if (!usuario || !contacto || usuario === contacto) return;

    this.touchUser(usuario);
    this.touchUser(contacto);

    this.data.users[usuario].contacts = [
      ...new Set([...(this.data.users[usuario].contacts ?? []), contacto]),
    ];
    this.data.users[contacto].contacts = [
      ...new Set([...(this.data.users[contacto].contacts ?? []), usuario]),
    ];
    this.save();
  }

  usersFor(usuarioActual, conectados) {
    return Object.values(this.data.users)
      .filter((usuario) => usuario.name !== usuarioActual)
      .map((usuario) => ({
        nombre: usuario.name,
        conectado: conectados.has(usuario.name),
        lastSeen: usuario.lastSeen ?? null,
      }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre));
  }

  groupsFor(usuario) {
    return Object.values(this.data.groups).filter((grupo) => grupo.miembros.includes(usuario));
  }

  upsertGroup(grupo) {
    const ahora = new Date().toISOString();
    this.data.groups[grupo.id] = {
      ...grupo,
      createdAt: this.data.groups[grupo.id]?.createdAt ?? ahora,
      updatedAt: ahora,
    };
    grupo.miembros.forEach((miembro) => this.touchUser(miembro));
    this.save();
    return this.data.groups[grupo.id];
  }

  deleteGroup(grupoId) {
    const grupo = this.data.groups[grupoId];
    if (!grupo) return null;

    delete this.data.groups[grupoId];
    this.save();
    return grupo;
  }

  getGroup(grupoId) {
    return this.data.groups[grupoId] ?? null;
  }

  addMessage(mensaje) {
    const registro = {
      ...mensaje,
      timestamp: new Date().toISOString(),
      leidosPor: [...new Set(mensaje.leidosPor ?? [mensaje.emisor])],
      entregadoA: [...new Set(mensaje.entregadoA ?? [mensaje.emisor])],
    };

    this.data.messages.push(registro);
    this.touchUser(mensaje.emisor);

    if (registro.ambito === "privado") {
      this.addContact(registro.emisor, registro.receptor);
    }

    this.save();
    return registro;
  }

  markDelivered(messageId, usuario) {
    const mensaje = this.data.messages.find((item) => item.id === messageId);
    if (!mensaje) return null;

    mensaje.entregadoA = [...new Set([...(mensaje.entregadoA ?? []), usuario])];
    this.save();
    return mensaje;
  }

  markRead(messageId, usuario) {
    const mensaje = this.data.messages.find((item) => item.id === messageId);
    if (!mensaje) return null;

    mensaje.leidosPor = [...new Set([...(mensaje.leidosPor ?? []), usuario])];
    this.save();
    return mensaje;
  }

  messagesFor(usuario) {
    return this.data.messages
      .filter((mensaje) => {
        if (mensaje.ambito === "grupo") return mensaje.miembros.includes(usuario);
        return mensaje.emisor === usuario || mensaje.receptor === usuario;
      })
      .map((mensaje) => {
        const esEmisor = mensaje.emisor === usuario;
        const receptores = mensaje.ambito === "grupo"
          ? mensaje.miembros.filter((miembro) => miembro !== mensaje.emisor)
          : [mensaje.receptor];

        return {
          id: mensaje.id,
          ambito: mensaje.ambito,
          grupoId: mensaje.grupoId,
          grupoNombre: mensaje.grupoNombre,
          miembros: mensaje.miembros,
          emisor: mensaje.emisor,
          receptor: mensaje.ambito === "grupo" ? mensaje.grupoId : mensaje.receptor,
          texto: mensaje.texto,
          tipo: esEmisor ? "enviado" : "recibido",
          leido: esEmisor
            ? receptores.every((receptor) => (mensaje.leidosPor ?? []).includes(receptor))
            : (mensaje.leidosPor ?? []).includes(usuario),
          leidosPor: mensaje.leidosPor ?? [],
          entregadoA: mensaje.entregadoA ?? [],
          timestamp: mensaje.timestamp,
        };
      });
  }
}
