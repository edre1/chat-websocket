import { createClient } from "@supabase/supabase-js";

const ESTADO_INICIAL = Object.freeze({
  users: {},
  groups: {},
  messages: [],
});

const cloneEstadoInicial = () => JSON.parse(JSON.stringify(ESTADO_INICIAL));

export class SupabaseChatStore {
  constructor({ url, serviceRoleKey, table = "chat_state", rowId = "default" }) {
    this.client = createClient(url, serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
    this.table = table;
    this.rowId = rowId;
    this.data = cloneEstadoInicial();
  }

  async init() {
    const { data, error } = await this.client
      .from(this.table)
      .select("data")
      .eq("id", this.rowId)
      .maybeSingle();

    if (error) throw error;

    if (!data) {
      this.data = cloneEstadoInicial();
      await this.save();
      return;
    }

    this.data = {
      ...cloneEstadoInicial(),
      ...(data.data ?? {}),
    };
  }

  async save() {
    const { error } = await this.client
      .from(this.table)
      .upsert({
        id: this.rowId,
        data: this.data,
        updated_at: new Date().toISOString(),
      });

    if (error) throw error;
  }

  async touchUser(nombre) {
    const ahora = new Date().toISOString();
    const existente = this.data.users[nombre] ?? {};

    this.data.users[nombre] = {
      name: nombre,
      contacts: Array.isArray(existente.contacts) ? existente.contacts : [],
      createdAt: existente.createdAt ?? ahora,
      lastSeen: ahora,
    };
    await this.save();
  }

  async addContact(usuario, contacto) {
    if (!usuario || !contacto || usuario === contacto) return;

    await this.touchUser(usuario);
    await this.touchUser(contacto);

    this.data.users[usuario].contacts = [
      ...new Set([...(this.data.users[usuario].contacts ?? []), contacto]),
    ];
    this.data.users[contacto].contacts = [
      ...new Set([...(this.data.users[contacto].contacts ?? []), usuario]),
    ];
    await this.save();
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

  async upsertGroup(grupo) {
    const ahora = new Date().toISOString();
    this.data.groups[grupo.id] = {
      ...grupo,
      createdAt: this.data.groups[grupo.id]?.createdAt ?? ahora,
      updatedAt: ahora,
    };

    for (const miembro of grupo.miembros) {
      await this.touchUser(miembro);
    }

    await this.save();
    return this.data.groups[grupo.id];
  }

  async deleteGroup(grupoId) {
    const grupo = this.data.groups[grupoId];
    if (!grupo) return null;

    delete this.data.groups[grupoId];
    await this.save();
    return grupo;
  }

  getGroup(grupoId) {
    return this.data.groups[grupoId] ?? null;
  }

  async addMessage(mensaje) {
    const registro = {
      ...mensaje,
      timestamp: new Date().toISOString(),
      leidosPor: [...new Set(mensaje.leidosPor ?? [mensaje.emisor])],
      entregadoA: [...new Set(mensaje.entregadoA ?? [mensaje.emisor])],
    };

    this.data.messages.push(registro);
    await this.touchUser(mensaje.emisor);

    if (registro.ambito === "privado") {
      await this.addContact(registro.emisor, registro.receptor);
    }

    await this.save();
    return registro;
  }

  async markDelivered(messageId, usuario) {
    const mensaje = this.data.messages.find((item) => item.id === messageId);
    if (!mensaje) return null;

    mensaje.entregadoA = [...new Set([...(mensaje.entregadoA ?? []), usuario])];
    await this.save();
    return mensaje;
  }

  async markRead(messageId, usuario) {
    const mensaje = this.data.messages.find((item) => item.id === messageId);
    if (!mensaje) return null;

    mensaje.leidosPor = [...new Set([...(mensaje.leidosPor ?? []), usuario])];
    await this.save();
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
