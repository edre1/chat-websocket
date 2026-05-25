import { createClient } from "@supabase/supabase-js";

const TABLAS = Object.freeze({
  users: "chat_users",
  contacts: "chat_contacts",
  groups: "chat_groups",
  groupMembers: "chat_group_members",
  messages: "chat_messages",
  receipts: "chat_message_receipts",
});

export class SupabaseChatStore {
  constructor({ url, serviceRoleKey }) {
    this.client = createClient(url, serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
  }

  async init() {
    const { error } = await this.client.from(TABLAS.users).select("name").limit(1);
    if (error) throw error;
  }

  async touchUser(nombre) {
    const { error } = await this.client
      .from(TABLAS.users)
      .upsert({ name: nombre, last_seen: new Date().toISOString() }, { onConflict: "name" });

    if (error) throw error;
  }

  async addContact(usuario, contacto) {
    if (!usuario || !contacto || usuario === contacto) return;

    await this.touchUser(usuario);
    await this.touchUser(contacto);

    const { error } = await this.client
      .from(TABLAS.contacts)
      .upsert([
        { user_name: usuario, contact_name: contacto },
        { user_name: contacto, contact_name: usuario },
      ], { onConflict: "user_name,contact_name" });

    if (error) throw error;
  }

  async usersFor(usuarioActual, conectados) {
    const { data, error } = await this.client
      .from(TABLAS.users)
      .select("name,last_seen")
      .neq("name", usuarioActual)
      .order("name", { ascending: true });

    if (error) throw error;

    return (data ?? []).map((usuario) => ({
      nombre: usuario.name,
      conectado: conectados.has(usuario.name),
      lastSeen: usuario.last_seen ?? null,
    }));
  }

  async groupsFor(usuario) {
    const { data: membresias, error: errorMembresias } = await this.client
      .from(TABLAS.groupMembers)
      .select("group_id")
      .eq("user_name", usuario);

    if (errorMembresias) throw errorMembresias;

    const groupIds = [...new Set((membresias ?? []).map((fila) => fila.group_id))];
    if (groupIds.length === 0) return [];

    const [grupos, miembros] = await Promise.all([
      this.selectGroups(groupIds),
      this.selectMembers(groupIds),
    ]);

    return grupos.map((grupo) => this.toGroup(grupo, miembros));
  }

  async upsertGroup(grupo) {
    const miembros = [...new Set(grupo.miembros)].filter(Boolean);

    await this.touchUser(grupo.creador);
    for (const miembro of miembros) {
      await this.touchUser(miembro);
    }

    const { data, error } = await this.client
      .from(TABLAS.groups)
      .upsert({
        id: grupo.id,
        name: grupo.nombre,
        creator: grupo.creador,
        updated_at: new Date().toISOString(),
      }, { onConflict: "id" })
      .select("id,name,creator,created_at,updated_at")
      .single();

    if (error) throw error;

    const { error: deleteError } = await this.client
      .from(TABLAS.groupMembers)
      .delete()
      .eq("group_id", grupo.id);

    if (deleteError) throw deleteError;

    const { error: insertError } = await this.client
      .from(TABLAS.groupMembers)
      .insert(miembros.map((miembro) => ({ group_id: grupo.id, user_name: miembro })));

    if (insertError) throw insertError;

    return this.toGroup(data, miembros.map((miembro) => ({ group_id: grupo.id, user_name: miembro })));
  }

  async deleteGroup(grupoId) {
    const grupo = await this.getGroup(grupoId);
    if (!grupo) return null;

    const { error } = await this.client
      .from(TABLAS.groups)
      .delete()
      .eq("id", grupoId);

    if (error) throw error;
    return grupo;
  }

  async getGroup(grupoId) {
    const { data, error } = await this.client
      .from(TABLAS.groups)
      .select("id,name,creator,created_at,updated_at")
      .eq("id", grupoId)
      .maybeSingle();

    if (error) throw error;
    if (!data) return null;

    const miembros = await this.selectMembers([grupoId]);
    return this.toGroup(data, miembros);
  }

  async addMessage(mensaje) {
    await this.touchUser(mensaje.emisor);

    const ambito = mensaje.ambito === "grupo" ? "grupo" : "privado";
    const receptores = ambito === "grupo"
      ? (mensaje.miembros ?? []).filter((miembro) => miembro !== mensaje.emisor)
      : [mensaje.receptor];

    if (ambito === "privado") {
      await this.addContact(mensaje.emisor, mensaje.receptor);
    } else {
      for (const miembro of mensaje.miembros ?? []) {
        await this.touchUser(miembro);
      }
    }

    const { data, error } = await this.client
      .from(TABLAS.messages)
      .insert({
        id: mensaje.id,
        scope: ambito,
        sender: mensaje.emisor,
        recipient: ambito === "privado" ? mensaje.receptor : null,
        group_id: ambito === "grupo" ? mensaje.grupoId : null,
        body: mensaje.texto,
      })
      .select("id,scope,sender,recipient,group_id,body,created_at")
      .single();

    if (error) throw error;

    const recibos = [
      {
        message_id: mensaje.id,
        user_name: mensaje.emisor,
        delivered: true,
        read: true,
        delivered_at: data.created_at,
        read_at: data.created_at,
      },
      ...receptores.map((receptor) => ({
        message_id: mensaje.id,
        user_name: receptor,
        delivered: false,
        read: false,
      })),
    ];

    const { error: receiptError } = await this.client
      .from(TABLAS.receipts)
      .insert(recibos);

    if (receiptError) throw receiptError;

    return {
      id: data.id,
      ambito,
      grupoId: data.group_id,
      grupoNombre: mensaje.grupoNombre,
      miembros: mensaje.miembros,
      emisor: data.sender,
      receptor: data.recipient,
      texto: data.body,
      timestamp: data.created_at,
      leidosPor: [mensaje.emisor],
      entregadoA: [mensaje.emisor],
    };
  }

  async markDelivered(messageId, usuario) {
    const { error } = await this.client
      .from(TABLAS.receipts)
      .update({
        delivered: true,
        delivered_at: new Date().toISOString(),
      })
      .eq("message_id", messageId)
      .eq("user_name", usuario);

    if (error) throw error;
    return this.messageById(messageId);
  }

  async markRead(messageId, usuario) {
    const ahora = new Date().toISOString();
    const { error } = await this.client
      .from(TABLAS.receipts)
      .update({
        delivered: true,
        read: true,
        delivered_at: ahora,
        read_at: ahora,
      })
      .eq("message_id", messageId)
      .eq("user_name", usuario);

    if (error) throw error;
    return this.messageById(messageId);
  }

  async messagesFor(usuario) {
    const grupos = await this.groupsFor(usuario);
    const groupIds = grupos.map((grupo) => grupo.id);

    const { data: mensajesTodos, error } = await this.client
      .from(TABLAS.messages)
      .select("id,scope,sender,recipient,group_id,body,created_at")
      .order("created_at", { ascending: true });

    if (error) throw error;

    const mensajes = (mensajesTodos ?? []).filter((mensaje) => (
      mensaje.sender === usuario ||
      mensaje.recipient === usuario ||
      (mensaje.group_id && groupIds.includes(mensaje.group_id))
    ));

    if (!mensajes?.length) return [];

    const ids = mensajes.map((mensaje) => mensaje.id);
    const { data: recibos, error: receiptError } = await this.client
      .from(TABLAS.receipts)
      .select("message_id,user_name,delivered,read")
      .in("message_id", ids);

    if (receiptError) throw receiptError;

    const miembrosPorGrupo = Object.fromEntries(grupos.map((grupo) => [grupo.id, grupo.miembros]));
    const nombrePorGrupo = Object.fromEntries(grupos.map((grupo) => [grupo.id, grupo.nombre]));

    return mensajes.map((mensaje) => {
      const recibosMensaje = (recibos ?? []).filter((recibo) => recibo.message_id === mensaje.id);
      const leidosPor = recibosMensaje.filter((recibo) => recibo.read).map((recibo) => recibo.user_name);
      const entregadoA = recibosMensaje.filter((recibo) => recibo.delivered).map((recibo) => recibo.user_name);
      const esEmisor = mensaje.sender === usuario;
      const miembros = mensaje.scope === "grupo" ? (miembrosPorGrupo[mensaje.group_id] ?? []) : undefined;
      const receptores = mensaje.scope === "grupo"
        ? miembros.filter((miembro) => miembro !== mensaje.sender)
        : [mensaje.recipient];

      return {
        id: mensaje.id,
        ambito: mensaje.scope,
        grupoId: mensaje.group_id,
        grupoNombre: nombrePorGrupo[mensaje.group_id],
        miembros,
        emisor: mensaje.sender,
        receptor: mensaje.scope === "grupo" ? mensaje.group_id : mensaje.recipient,
        texto: mensaje.body,
        tipo: esEmisor ? "enviado" : "recibido",
        leido: esEmisor
          ? receptores.every((receptor) => leidosPor.includes(receptor))
          : leidosPor.includes(usuario),
        leidosPor,
        entregadoA,
        timestamp: mensaje.created_at,
      };
    });
  }

  async messageById(messageId) {
    const { data, error } = await this.client
      .from(TABLAS.messages)
      .select("id,scope,sender,recipient,group_id,body,created_at")
      .eq("id", messageId)
      .maybeSingle();

    if (error) throw error;
    if (!data) return null;

    return {
      id: data.id,
      ambito: data.scope,
      grupoId: data.group_id,
      emisor: data.sender,
      receptor: data.scope === "grupo" ? data.group_id : data.recipient,
      texto: data.body,
      timestamp: data.created_at,
    };
  }

  async selectGroups(groupIds) {
    const { data, error } = await this.client
      .from(TABLAS.groups)
      .select("id,name,creator,created_at,updated_at")
      .in("id", groupIds);

    if (error) throw error;
    return data ?? [];
  }

  async selectMembers(groupIds) {
    const { data, error } = await this.client
      .from(TABLAS.groupMembers)
      .select("group_id,user_name")
      .in("group_id", groupIds);

    if (error) throw error;
    return data ?? [];
  }

  toGroup(grupo, miembros) {
    return {
      id: grupo.id,
      nombre: grupo.name,
      miembros: miembros
        .filter((miembro) => miembro.group_id === grupo.id)
        .map((miembro) => miembro.user_name),
      creador: grupo.creator,
      createdAt: grupo.created_at,
      updatedAt: grupo.updated_at,
    };
  }
}
