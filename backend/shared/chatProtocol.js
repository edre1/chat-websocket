export const MENSAJES = Object.freeze({
  IDENTIFICATE: "IDENTIFICATE",
  IDENTIFICACION: "IDENTIFICACION",
  CONECTADOS: "CONECTADOS",
  HISTORIAL: "HISTORIAL",
  CHAT: "CHAT",
  LEIDO: "LEIDO",
  GRUPO: "GRUPO",
  EDITAR_GRUPO: "EDITAR_GRUPO",
  ELIMINAR_GRUPO: "ELIMINAR_GRUPO",
  GRUPO_ELIMINADO: "GRUPO_ELIMINADO",
});

export function parsearMensaje(json) {
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export function construirMensaje(mensaje, data) {
  const payload = { mensaje };
  if (data !== undefined && data !== null) {
    payload.data = data;
  }
  return JSON.stringify(payload);
}
