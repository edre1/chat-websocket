import WebSocket, { WebSocketServer } from 'ws'

class wsCliente {
	constructor() {
		// El servidor principal sigue escuchando en 8080
		this.servidorUrl = 'ws://localhost:8080'
		// La interfaz web se conecta a este cliente en 8090, no al servidor
		this.puertoInterfaz = 8090

		this.escucharInterfaz()
	}

	escucharInterfaz() {
		// Este WebSocketServer recibe las conexiones de React
		this.wssInterfaz = new WebSocketServer({ port: this.puertoInterfaz })
		console.log(`Cliente listo para la interfaz en ws://localhost:${this.puertoInterfaz}`)

		this.wssInterfaz.on('connection', (ws) => {
			console.log('Interfaz conectada al cliente')
			// Cada ventana o usuario de la interfaz tiene su propia conexion al servidor
			new ConexionInterfazServidor(ws, this.servidorUrl)
		})
	}
}

// clase funciona como puente entre la interfaz web - cliente - servidor.
class ConexionInterfazServidor {
	constructor(wsInterfaz, servidorUrl) {
		this.wsInterfaz = wsInterfaz
		this.wsServidor = new WebSocket(servidorUrl)
		// Si la interfaz manda algo antes de que el servidor abra, lo guardamos aqui
		this.mensajesPendientes = []

		this.wsServidor.on('open', () => {
			console.log('Conexion interna abierta con el servidor')

			// Enviamos los mensajes que estaban esperando a que abriera la conexion
			for (const mensaje of this.mensajesPendientes) {
				this.wsServidor.send(mensaje)
			}
			this.mensajesPendientes = []
		})

		this.wsServidor.on('message', (data) => {
			// Todo lo que manda el servidor se reenvia a la interfaz
			this.enviarAInterfaz(data.toString())
		})

		this.wsServidor.on('close', () => {
			console.log('Conexion interna cerrada con el servidor')
			this.cerrarInterfaz()
		})

		this.wsServidor.on('error', (error) => {
			console.log('Error conectando con el servidor:', error.message)
			this.cerrarInterfaz()
		})

		this.wsInterfaz.on('message', (data) => {
			// Todo lo que manda la interfaz se reenvia al servidor
			this.enviarAServidor(data.toString())
		})

		this.wsInterfaz.on('close', () => {
			console.log('Interfaz desconectada del cliente')
			this.cerrarServidor()
		})
	}

	enviarAServidor(mensaje) {
		// Si el servidor aun esta conectando, esperamos para no perder el mensaje
		if (this.wsServidor.readyState === WebSocket.CONNECTING) {
			this.mensajesPendientes.push(mensaje)
			return
		}

		if (this.wsServidor.readyState === WebSocket.OPEN) {
			this.wsServidor.send(mensaje)
		}
	}

	enviarAInterfaz(mensaje) {
		if (!this.wsInterfaz || this.wsInterfaz.readyState !== WebSocket.OPEN) return

		this.wsInterfaz.send(mensaje)
	}

	cerrarServidor() {
		if (this.wsServidor.readyState === WebSocket.OPEN || this.wsServidor.readyState === WebSocket.CONNECTING) {
			this.wsServidor.close()
		}
	}

	cerrarInterfaz() {
		if (this.wsInterfaz.readyState === WebSocket.OPEN || this.wsInterfaz.readyState === WebSocket.CONNECTING) {
			this.wsInterfaz.close()
		}
	}
}

// Este cliente mantiene el uso anterior por consola, por ejemplo: npm run mario.
class wsClienteConsola {
	constructor(cliente) {
		this.ws = new WebSocket('ws://localhost:8080')
		this.cliente = cliente

		this.ws.on('open', () => {
			console.log('Conectado al servidor')
		})

		this.ws.on('message', (data) => {
			const datos = this.jsonAJS(data.toString())
			if (!datos) return

			const { mensaje, data: contenido } = datos
			if (this[mensaje] && typeof this[mensaje] == 'function') {
				this[mensaje](contenido)
			}
		})
	}

	IDENTIFICATE() {
		// El servidor pide identificacion y este cliente responde con su nombre.
		this.MSG('IDENTIFICACION', this.cliente)
		this.MSG('CONECTADOS')
	}

	CONECTADOS(data) {
		if (!data) return

		console.log('*** CLIENTES CONECTADOS ***')
		for (const cliente of data) {
			console.log(cliente)
		}
	}

	CHAT(data) {
		if (!data) return

		console.log(`${data.emisor} dice: ${data.mensaje}`)
	}

	MSG(mensaje, data) {
		const msg = this.JSAJson(data !== undefined && data !== null ? { mensaje, data } : { mensaje })

		if (msg) this.ws.send(msg)
	}

	jsonAJS(json) {
		try { return JSON.parse(json) }
		catch { return false }
	}

	JSAJson(js) {
		try { return JSON.stringify(js) }
		catch { return false }
	}
}

const cliente = process.argv[2]

if (cliente) {
	new wsClienteConsola(cliente)
} else {
	new wsCliente()
}
