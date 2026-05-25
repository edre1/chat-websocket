import { MENSAJES, construirMensaje, parsearMensaje } from "../shared/chatProtocol.js";

class WsFrontendClient {
  constructor({ url, nombre, onOpen, onClose, onUsuarios, onHistorial, onChat, onLeido, onGrupo, onGrupoEliminado, onError }) {
    this.url = url;
    this.nombre = nombre;
    this.onOpen = onOpen;
    this.onClose = onClose;
    this.onUsuarios = onUsuarios;
    this.onHistorial = onHistorial;
    this.onChat = onChat;
    this.onLeido = onLeido;
    this.onGrupo = onGrupo;
    this.onGrupoEliminado = onGrupoEliminado;
    this.onError = onError;
    this.socket = null;
  }

  conectar() {
    this.socket = new WebSocket(this.url);

    this.socket.onopen = () => {
      if (typeof this.onOpen === "function") {
        this.onOpen();
      }
    };

    this.socket.onmessage = (event) => {
      const paquete = parsearMensaje(event.data);
      if (!paquete) return;

      const { mensaje, data } = paquete;

      if (mensaje === MENSAJES.IDENTIFICATE) {
        this.enviar(MENSAJES.IDENTIFICACION, this.nombre);
        this.pedirConectados();
        return;
      }

      if (mensaje === MENSAJES.CONECTADOS) {
        if (typeof this.onUsuarios === "function") {
          this.onUsuarios(Array.isArray(data) ? data : []);
        }
        return;
      }

      if (mensaje === MENSAJES.HISTORIAL && data && typeof this.onHistorial === "function") {
        this.onHistorial(data);
        return;
      }

      if (mensaje === MENSAJES.CHAT && data && typeof this.onChat === "function") {
        this.onChat(data);
        return;
      }

      if (mensaje === MENSAJES.LEIDO && data && typeof this.onLeido === "function") {
        this.onLeido(data);
        return;
      }

      if (mensaje === MENSAJES.GRUPO && data && typeof this.onGrupo === "function") {
        this.onGrupo(data);
        return;
      }

      if (mensaje === MENSAJES.GRUPO_ELIMINADO && data && typeof this.onGrupoEliminado === "function") {
        this.onGrupoEliminado(data);
      }
    };

    this.socket.onerror = (error) => {
      if (typeof this.onError === "function") {
        this.onError(error);
      }
    };

    this.socket.onclose = () => {
      if (typeof this.onClose === "function") {
        this.onClose();
      }
    };
  }

  get estaConectado() {
    return this.socket && this.socket.readyState === WebSocket.OPEN;
  }

  enviar(mensaje, data) {
    if (!this.estaConectado) return;
    this.socket.send(construirMensaje(mensaje, data));
  }

  pedirConectados() {
    this.enviar(MENSAJES.CONECTADOS);
  }

  enviarChat(receptor, mensaje) {
    this.enviar(MENSAJES.CHAT, {
      receptor: [receptor],
      mensaje,
    });
  }

  enviarChatConId(receptor, mensaje, id) {
    this.enviar(MENSAJES.CHAT, {
      receptor: [receptor],
      mensaje,
      id,
    });
  }

  enviarChatGrupo(grupo, mensaje, id) {
    this.enviar(MENSAJES.CHAT, {
      receptor: grupo.miembros.filter((miembro) => miembro !== this.nombre),
      mensaje,
      id,
      grupoId: grupo.id,
      grupoNombre: grupo.nombre,
      miembros: grupo.miembros,
    });
  }

  enviarLeido(emisor, id, grupoId = null) {
    this.enviar(MENSAJES.LEIDO, { emisor, id, grupoId });
  }

  crearGrupo(nombre, miembros) {
    this.enviar(MENSAJES.GRUPO, { nombre, miembros });
  }

  editarGrupo(grupoId, miembros) {
    this.enviar(MENSAJES.EDITAR_GRUPO, { grupoId, miembros });
  }

  eliminarGrupo(grupoId) {
    this.enviar(MENSAJES.ELIMINAR_GRUPO, { grupoId });
  }

  cerrar() {
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
  }
}

export default WsFrontendClient;
