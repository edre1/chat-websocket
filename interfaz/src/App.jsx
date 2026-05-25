import { useEffect, useMemo, useRef, useState } from "react";
import WsFrontendClient from "../../backend/clients/wsFrontendClient.js";
import "./App.css";
import iconoEnviado from "./assets/enviado.png";
import iconoVisto from "./assets/visto.png";
import fondoMensajes from "./assets/fondo.png";
import botonEnviar from "./assets/boton-enviar.png";

const idUsuario = (usuario) => `usuario:${usuario}`;
const idGrupo = (grupoId) => `grupo:${grupoId}`;
const crearIdMensaje = (usuario) => `${usuario}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const obtenerWsUrl = () => {
  if (import.meta.env.VITE_WS_URL) return import.meta.env.VITE_WS_URL;
  if (window.location.port === "5173") return "ws://localhost:8080";

  const protocolo = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocolo}//${window.location.host}`;
};

const normalizarUsuarios = (lista) => {
  const usuarios = [];
  const estados = {};

  (Array.isArray(lista) ? lista : []).forEach((item) => {
    const nombre = typeof item === "string" ? item : item?.nombre;
    if (!nombre) return;

    usuarios.push(nombre);
    estados[nombre] = typeof item === "string" ? true : Boolean(item.conectado);
  });

  return { usuarios, estados };
};

function App() {
  const clienteRef = useRef(null);

  const [nombre, setNombre] = useState("");
  const [nombreTemp, setNombreTemp] = useState("");
  const [conectado, setConectado] = useState(false);

  const [usuarios, setUsuarios] = useState([]);
  const [estadosUsuarios, setEstadosUsuarios] = useState({});
  const [grupos, setGrupos] = useState([]);
  const [chatActivoId, setChatActivoId] = useState("");
  const [mensaje, setMensaje] = useState("");
  const [mensajes, setMensajes] = useState([]);
  const [creandoGrupo, setCreandoGrupo] = useState(false);
  const [nombreGrupo, setNombreGrupo] = useState("");
  const [miembrosGrupo, setMiembrosGrupo] = useState([]);
  const [editandoGrupo, setEditandoGrupo] = useState(false);
  const [miembrosGrupoEdicion, setMiembrosGrupoEdicion] = useState([]);

  const gruposVisibles = useMemo(
    () => grupos.filter((grupo) => Array.isArray(grupo.miembros) && grupo.miembros.includes(nombre)),
    [grupos, nombre]
  );

  useEffect(() => {
    if (!chatActivoId.startsWith("grupo:")) return;

    const permitido = gruposVisibles.some((grupo) => idGrupo(grupo.id) === chatActivoId);
    if (!permitido) setChatActivoId("");
  }, [chatActivoId, gruposVisibles]);

  const chatActivo = useMemo(() => {
    if (chatActivoId.startsWith("usuario:")) {
      const usuario = chatActivoId.slice("usuario:".length);
      return { tipo: "usuario", id: usuario, nombre: usuario, miembros: [nombre, usuario] };
    }

    if (chatActivoId.startsWith("grupo:")) {
      const grupo = gruposVisibles.find((item) => idGrupo(item.id) === chatActivoId);
      return grupo ? { tipo: "grupo", ...grupo } : null;
    }

    return null;
  }, [chatActivoId, gruposVisibles, nombre]);

  const desconectar = () => {
    if (clienteRef.current) {
      clienteRef.current.cerrar();
      clienteRef.current = null;
    }

    setConectado(false);
    setNombre("");
    setUsuarios([]);
    setEstadosUsuarios({});
    setGrupos([]);
    setMensajes([]);
    setChatActivoId("");
  };

  const conectar = () => {
    const nombreLimpio = nombreTemp.trim();
    if (!nombreLimpio) return;

    const cliente = new WsFrontendClient({
      url: obtenerWsUrl(),
      nombre: nombreLimpio,
      onOpen: () => {
        setConectado(true);
        setNombre(nombreLimpio);
      },
      onUsuarios: (lista) => {
        const { usuarios: usuariosNormalizados, estados } = normalizarUsuarios(lista);
        setUsuarios(usuariosNormalizados);
        setEstadosUsuarios(estados);
        setChatActivoId((actual) => {
          if (!actual.startsWith("usuario:")) return actual;
          const usuario = actual.slice("usuario:".length);
          return usuariosNormalizados.includes(usuario) ? actual : "";
        });
      },
      onHistorial: (data) => {
        const { usuarios: usuariosNormalizados, estados } = normalizarUsuarios(data.usuarios);
        setUsuarios(usuariosNormalizados);
        setEstadosUsuarios(estados);
        setGrupos(Array.isArray(data.grupos) ? data.grupos : []);
        setMensajes(Array.isArray(data.mensajes) ? data.mensajes : []);
      },
      onGrupo: (grupo) => {
        if (!Array.isArray(grupo.miembros)) return;

        if (!grupo.miembros.includes(nombreLimpio)) {
          setGrupos((prev) => prev.filter((item) => item.id !== grupo.id));
          setMensajes((prev) => prev.filter((msg) => !(msg.ambito === "grupo" && msg.grupoId === grupo.id)));
          setChatActivoId((actual) => (actual === idGrupo(grupo.id) ? "" : actual));
          setEditandoGrupo(false);
          return;
        }

        setGrupos((prev) => {
          const existe = prev.some((item) => item.id === grupo.id);
          return existe
            ? prev.map((item) => (item.id === grupo.id ? grupo : item))
            : [...prev, grupo];
        });
        setChatActivoId((actual) => actual || idGrupo(grupo.id));
      },
      onGrupoEliminado: ({ id }) => {
        if (!id) return;

        setGrupos((prev) => prev.filter((item) => item.id !== id));
        setMensajes((prev) => prev.filter((msg) => !(msg.ambito === "grupo" && msg.grupoId === id)));
        setChatActivoId((actual) => (actual === idGrupo(id) ? "" : actual));
        setEditandoGrupo(false);
      },
      onChat: (data) => {
        if (data.grupoId && (!Array.isArray(data.miembros) || !data.miembros.includes(nombreLimpio))) return;

        setMensajes((prev) => [
          ...prev,
          {
            id: data.id ?? crearIdMensaje(data.emisor ?? "mensaje"),
            ambito: data.grupoId ? "grupo" : "privado",
            grupoId: data.grupoId,
            grupoNombre: data.grupoNombre,
            miembros: data.miembros,
            emisor: data.emisor,
            receptor: nombreLimpio,
            texto: data.mensaje,
            tipo: "recibido",
            leido: false,
            leidosPor: [],
          },
        ]);
      },
      onLeido: (data) => {
        setMensajes((prev) =>
          prev.map((msg) => {
            const esGrupo = msg.ambito === "grupo" && data.grupoId && msg.grupoId === data.grupoId;
            const esPrivado =
              msg.ambito !== "grupo" &&
              msg.tipo === "enviado" &&
              msg.id === data.id &&
              msg.receptor === data.emisor &&
              !msg.leido;

            if (esPrivado) return { ...msg, leido: true };

            if (esGrupo && msg.tipo === "enviado" && msg.id === data.id) {
              const leidosPor = [...new Set([...(msg.leidosPor ?? []), data.emisor])];
              const miembrosPendientes = (msg.miembros ?? []).filter((miembro) => miembro !== nombreLimpio);
              const todosLeidos = miembrosPendientes.every((miembro) => leidosPor.includes(miembro));
              return { ...msg, leidosPor, leido: todosLeidos };
            }

            return msg;
          })
        );
      },
      onClose: () => {
        setConectado(false);
        setUsuarios([]);
        setEstadosUsuarios({});
        setChatActivoId("");
      },
      onError: (error) => {
        console.error("Error de WebSocket:", error);
      },
    });

    clienteRef.current = cliente;
    cliente.conectar();
  };

  const enviarMensaje = () => {
    const textoLimpio = mensaje.trim();
    if (!textoLimpio || !chatActivo || !clienteRef.current) return;

    const id = crearIdMensaje(nombre);

    if (chatActivo.tipo === "grupo") {
      if (!Array.isArray(chatActivo.miembros) || !chatActivo.miembros.includes(nombre)) return;

      clienteRef.current.enviarChatGrupo(chatActivo, textoLimpio, id);
      setMensajes((prev) => [
        ...prev,
        {
          id,
          ambito: "grupo",
          grupoId: chatActivo.id,
          grupoNombre: chatActivo.nombre,
          miembros: chatActivo.miembros,
          emisor: nombre,
          receptor: chatActivo.id,
          texto: textoLimpio,
          tipo: "enviado",
          leido: chatActivo.miembros.filter((miembro) => miembro !== nombre).length === 0,
          leidosPor: [nombre],
        },
      ]);
    } else {
      clienteRef.current.enviarChatConId(chatActivo.id, textoLimpio, id);
      setMensajes((prev) => [
        ...prev,
        {
          id,
          ambito: "privado",
          emisor: nombre,
          receptor: chatActivo.id,
          texto: textoLimpio,
          tipo: "enviado",
          leido: false,
          leidosPor: [],
        },
      ]);
    }

    setMensaje("");
  };

  const crearGrupo = () => {
    const miembros = miembrosGrupo.filter((usuario) => usuarios.includes(usuario));
    if (!clienteRef.current || miembros.length === 0) return;

    clienteRef.current.crearGrupo(nombreGrupo.trim() || `Grupo ${gruposVisibles.length + 1}`, miembros);
    setNombreGrupo("");
    setMiembrosGrupo([]);
    setCreandoGrupo(false);
  };

  const esCreadorGrupoActivo =
    chatActivo?.tipo === "grupo" && !!chatActivo.creador && chatActivo.creador === nombre;

  const abrirEdicionGrupo = () => {
    if (!chatActivo || chatActivo.tipo !== "grupo") return;
    setMiembrosGrupoEdicion(
      (chatActivo.miembros ?? []).filter((miembro) => miembro && miembro !== chatActivo.creador)
    );
    setEditandoGrupo(true);
  };

  const guardarEdicionGrupo = () => {
    if (!clienteRef.current || !chatActivo || chatActivo.tipo !== "grupo") return;

    const miembros = [...new Set(miembrosGrupoEdicion.filter((usuario) => usuarios.includes(usuario)))];
    clienteRef.current.editarGrupo(chatActivo.id, miembros);
    setEditandoGrupo(false);
  };

  const eliminarGrupoActivo = () => {
    if (!clienteRef.current || !chatActivo || chatActivo.tipo !== "grupo") return;
    if (!window.confirm(`Eliminar el grupo "${chatActivo.nombre}"?`)) return;

    clienteRef.current.eliminarGrupo(chatActivo.id);
    setEditandoGrupo(false);
  };

  const mensajesFiltrados = useMemo(() => {
    if (!chatActivo) return [];

    if (chatActivo.tipo === "grupo") {
      return mensajes.filter((msg) => msg.ambito === "grupo" && msg.grupoId === chatActivo.id);
    }

    return mensajes.filter(
      (msg) =>
        msg.ambito !== "grupo" &&
        ((msg.emisor === nombre && msg.receptor === chatActivo.id) ||
          (msg.emisor === chatActivo.id && msg.receptor === nombre))
    );
  }, [chatActivo, mensajes, nombre]);

  const resumenPorUsuario = useMemo(() => {
    return usuarios.reduce((resumen, usuario) => {
      const conversacion = mensajes.filter(
        (msg) =>
          msg.ambito !== "grupo" &&
          ((msg.emisor === nombre && msg.receptor === usuario) ||
            (msg.emisor === usuario && msg.receptor === nombre))
      );
      const ultimoMensaje = conversacion.at(-1);
      const recibidosSinLeer = conversacion.filter(
        (msg) => msg.tipo === "recibido" && msg.emisor === usuario && !msg.leido
      ).length;

      resumen[usuario] = { ultimoMensaje, recibidosSinLeer };
      return resumen;
    }, {});
  }, [usuarios, mensajes, nombre]);

  const resumenPorGrupo = useMemo(() => {
    return gruposVisibles.reduce((resumen, grupo) => {
      const conversacion = mensajes.filter((msg) => msg.ambito === "grupo" && msg.grupoId === grupo.id);
      const ultimoMensaje = conversacion.at(-1);
      const recibidosSinLeer = conversacion.filter(
        (msg) => msg.tipo === "recibido" && msg.emisor !== nombre && !msg.leido
      ).length;

      resumen[grupo.id] = { ultimoMensaje, recibidosSinLeer };
      return resumen;
    }, {});
  }, [gruposVisibles, mensajes, nombre]);

  useEffect(() => {
    if (!chatActivo || !nombre || !clienteRef.current) return;

    const idsPorConfirmar = mensajes
      .filter((msg) => {
        if (msg.tipo !== "recibido" || msg.leido) return false;

        if (chatActivo.tipo === "grupo") {
          return msg.ambito === "grupo" && msg.grupoId === chatActivo.id;
        }

        return msg.ambito !== "grupo" && msg.emisor === chatActivo.id && msg.receptor === nombre;
      })
      .map((msg) => ({ id: msg.id, emisor: msg.emisor, grupoId: msg.grupoId }));

    if (idsPorConfirmar.length === 0) return;

    queueMicrotask(() => {
      setMensajes((prev) =>
        prev.map((msg) => {
          const debeMarcarse = idsPorConfirmar.some(
            (confirmacion) => confirmacion.id === msg.id && confirmacion.grupoId === msg.grupoId
          );

          return debeMarcarse ? { ...msg, leido: true } : msg;
        })
      );

      idsPorConfirmar.forEach((msg) => {
        clienteRef.current?.enviarLeido(msg.emisor, msg.id, msg.grupoId);
      });
    });
  }, [chatActivo, nombre, mensajes]);

  useEffect(() => {
    const manejarEscape = (e) => {
      if (e.key === "Escape") setChatActivoId("");
    };

    window.addEventListener("keydown", manejarEscape);
    return () => window.removeEventListener("keydown", manejarEscape);
  }, []);

  const obtenerInicial = (valor) => {
    const texto = (valor ?? "").trim();
    return texto ? texto.charAt(0).toUpperCase() : "?";
  };

  useEffect(() => {
    const intervalo = setInterval(() => {
      if (clienteRef.current && clienteRef.current.estaConectado) {
        clienteRef.current.pedirConectados();
      }
    }, 1000);

    return () => {
      clearInterval(intervalo);
      desconectar();
    };
  }, []);

  const renderIndicadorResumen = (ultimoMensaje, recibidosSinLeer) => {
    if (recibidosSinLeer > 0) {
      return <span className="contador-mensajes">{recibidosSinLeer}</span>;
    }

    if (ultimoMensaje?.tipo === "enviado") {
      return (
        <img
          className="estado-contacto"
          src={ultimoMensaje.leido ? iconoVisto : iconoEnviado}
          alt={ultimoMensaje.leido ? "Leido" : "Enviado"}
        />
      );
    }

    return null;
  };

  return (
    <div className="app">
      {!conectado ? (
        <div className="login-card">
          <h1>Mensajeria</h1>
          <input
            type="text"
            placeholder="Ingresa tu nombre"
            value={nombreTemp}
            onChange={(e) => setNombreTemp(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") conectar();
            }}
          />

          <button onClick={conectar}>Entrar</button>
        </div>
      ) : (
        <div className="chat-layout">
          <aside className="sidebar">
            <div className="sidebar-header">
              <div className="identidad">
                <span className="avatar-circulo">{obtenerInicial(nombre)}</span>
                <h2>{nombre}</h2>
              </div>
            </div>

            <div className="sidebar-contenido">
              <h3>Contactos</h3>

              <div className="usuarios">
                {usuarios.map((usuario) => {
                  const resumen = resumenPorUsuario[usuario] ?? {};
                  const activo = chatActivoId === idUsuario(usuario);

                  return (
                    <button
                      key={usuario}
                      className={`usuario ${activo ? "activo" : ""}`}
                      onClick={() => setChatActivoId(idUsuario(usuario))}
                    >
                      <span className="avatar-con-estado">
                        <span className="avatar-circulo">{obtenerInicial(usuario)}</span>
                        {estadosUsuarios[usuario] && <span className="punto-conectado" />}
                      </span>
                      <span className="datos-usuario">
                        <span className="nombre-usuario">{usuario}</span>
                        {resumen.ultimoMensaje && (
                          <span className="ultimo-mensaje">{resumen.ultimoMensaje.texto}</span>
                        )}
                      </span>
                      <span className="indicador-contacto">
                        {renderIndicadorResumen(resumen.ultimoMensaje, resumen.recibidosSinLeer ?? 0)}
                      </span>
                    </button>
                  );
                })}
              </div>

              {gruposVisibles.length > 0 && <h3 className="titulo-grupos">Grupos</h3>}

              <div className="usuarios">
                {gruposVisibles.map((grupo) => {
                  const resumen = resumenPorGrupo[grupo.id] ?? {};
                  const activo = chatActivoId === idGrupo(grupo.id);

                  return (
                    <button
                      key={grupo.id}
                      className={`usuario ${activo ? "activo" : ""}`}
                      onClick={() => setChatActivoId(idGrupo(grupo.id))}
                    >
                      <span className="avatar-circulo">{obtenerInicial(grupo.nombre)}</span>
                      <span className="datos-usuario">
                        <span className="nombre-usuario">{grupo.nombre}</span>
                        {resumen.ultimoMensaje ? (
                          <span className="ultimo-mensaje">{resumen.ultimoMensaje.texto}</span>
                        ) : (
                          <span className="ultimo-mensaje">{grupo.miembros.join(", ")}</span>
                        )}
                      </span>
                      <span className="indicador-contacto">
                        {renderIndicadorResumen(resumen.ultimoMensaje, resumen.recibidosSinLeer ?? 0)}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {creandoGrupo && (
              <div className="panel-grupo">
                <input
                  type="text"
                  placeholder="Nombre del grupo"
                  value={nombreGrupo}
                  onChange={(e) => setNombreGrupo(e.target.value)}
                />
                <div className="opciones-grupo">
                  {usuarios.map((usuario) => (
                    <label key={usuario} className="opcion-grupo">
                      <input
                        type="checkbox"
                        checked={miembrosGrupo.includes(usuario)}
                        onChange={(e) => {
                          setMiembrosGrupo((prev) =>
                            e.target.checked
                              ? [...prev, usuario]
                              : prev.filter((item) => item !== usuario)
                          );
                        }}
                      />
                      <span>{usuario}</span>
                    </label>
                  ))}
                </div>
                <button className="crear-grupo" onClick={crearGrupo}>
                  Crear grupo
                </button>
              </div>
            )}

            {esCreadorGrupoActivo && (
              <div className="panel-grupo">
                {!editandoGrupo ? (
                  <>
                    <button className="crear-grupo" onClick={abrirEdicionGrupo}>
                      Editar integrantes
                    </button>
                    <button className="crear-grupo" onClick={eliminarGrupoActivo}>
                      Eliminar grupo
                    </button>
                  </>
                ) : (
                  <>
                    <div className="opciones-grupo">
                      {usuarios.map((usuario) => {
                        const esCreador = usuario === chatActivo.creador;
                        return (
                          <label key={usuario} className="opcion-grupo">
                            <input
                              type="checkbox"
                              disabled={esCreador}
                              checked={
                                esCreador ? true : miembrosGrupoEdicion.includes(usuario)
                              }
                              onChange={(e) => {
                                if (esCreador) return;
                                setMiembrosGrupoEdicion((prev) =>
                                  e.target.checked
                                    ? [...prev, usuario]
                                    : prev.filter((item) => item !== usuario)
                                );
                              }}
                            />
                            <span>{usuario}</span>
                          </label>
                        );
                      })}
                    </div>
                    <button className="crear-grupo" onClick={guardarEdicionGrupo}>
                      Guardar cambios
                    </button>
                    <button className="crear-grupo" onClick={() => setEditandoGrupo(false)}>
                      Cancelar
                    </button>
                  </>
                )}
              </div>
            )}

            <button
              className="boton-grupo"
              onClick={() => setCreandoGrupo((actual) => !actual)}
              aria-label="Nuevo grupo"
            >
              +
            </button>
          </aside>

          <main className="panel-chat" style={{ backgroundImage: `url(${fondoMensajes})` }}>
            {chatActivo && (
              <header className="chat-header">
                <div className="identidad">
                  <span className="avatar-circulo">{obtenerInicial(chatActivo.nombre)}</span>
                  <h2>{chatActivo.nombre}</h2>
                </div>
              </header>
            )}

            <section className="mensajes" style={{ backgroundImage: `url(${fondoMensajes})` }}>
              {chatActivo &&
                mensajesFiltrados.map((msg, index) => {
                  const mensajeAnterior = mensajesFiltrados[index - 1];
                  const mostrarNombre =
                    chatActivo.tipo === "grupo" && mensajeAnterior?.emisor !== msg.emisor;

                  return (
                    <div
                      key={`${msg.ambito}-${msg.grupoId ?? msg.receptor}-${msg.id}-${msg.tipo}`}
                      className={`burbuja ${msg.tipo === "enviado" ? "enviado" : "recibido"}`}
                    >
                      {mostrarNombre && <strong>{msg.emisor}</strong>}
                      <span className="contenido-mensaje">
                        <span>{msg.texto}</span>
                        {msg.tipo === "enviado" && (
                          <img
                            className="estado-mensaje"
                            src={msg.leido ? iconoVisto : iconoEnviado}
                            alt={msg.leido ? "Leido" : "Enviado"}
                          />
                        )}
                      </span>
                    </div>
                  );
                })}
            </section>

            {chatActivo && (
              <footer className="barra-envio">
                <input
                  type="text"
                  placeholder="Mensaje"
                  value={mensaje}
                  onChange={(e) => setMensaje(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") enviarMensaje();
                  }}
                />

                <button className="boton-enviar" onClick={enviarMensaje}>
                  <img src={botonEnviar} alt="Enviar" />
                </button>
              </footer>
            )}
          </main>
        </div>
      )}
    </div>
  );
}

export default App;

