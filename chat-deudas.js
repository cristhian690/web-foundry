import "dotenv/config";
import OpenAI from "openai";
import readLine from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import fs from "node:fs";

const CONFIG = {
  endpoint: process.env.AZURE_ENDPOINT,
  apiKey: process.env.AZURE_API_KEY?.trim(),
  deploymentName: process.env.AZURE_DEPLOYMENT,
};

if (!CONFIG.endpoint || !CONFIG.apiKey || !CONFIG.deploymentName) {
  console.error("Faltan variables en el .env (AZURE_ENDPOINT, AZURE_API_KEY, AZURE_DEPLOYMENT)");
  process.exit(1);
}

const openai = new OpenAI({
  baseURL: CONFIG.endpoint,
  apiKey: CONFIG.apiKey,
  defaultHeaders: { "api-key": CONFIG.apiKey },
});

// "Base de datos" de clientes en un archivo JSON
const ARCHIVO_CLIENTES = new URL("./clientes.json", import.meta.url);

let clientes;
try {
  clientes = JSON.parse(fs.readFileSync(ARCHIVO_CLIENTES, "utf-8"));
} catch (e) {
  console.error("No se pudo leer clientes.json:", e.message);
  process.exit(1);
}

// Guarda los cambios (pagos) en el JSON
function guardarClientes() {
  fs.writeFileSync(ARCHIVO_CLIENTES, JSON.stringify(clientes, null, 2) + "\n", "utf-8");
}

// liente identificado en la sesión 
let clienteActual = null;

const redondear = (n) => Math.round(n * 100) / 100;

function identificarCliente({ dni }) {
  const limpio = String(dni).replace(/\D/g, "");

  if (limpio.length !== 8) {
    return { exito: false, mensaje: "El DNI debe tener 8 dígitos" };
  }

  const cliente = clientes.find((c) => c.dni === limpio);
  if (!cliente) {
    return { exito: false, mensaje: "No existe un cliente con ese DNI" };
  }

  clienteActual = cliente;
  return {
    exito: true,
    nombre: cliente.nombre,
    opciones: ["1) Conocer el estado de la deuda actual", "2) Pagar la deuda"],
  };
}

function consultarDeuda() {
  if (!clienteActual) {
    return { exito: false, mensaje: "Primero el cliente debe identificarse con su DNI" };
  }
  return {
    exito: true,
    nombre: clienteActual.nombre,
    deuda: clienteActual.deuda,
    estado: clienteActual.deuda > 0 ? "Con deuda pendiente" : "Sin deuda",
  };
}

function pagarDeuda({ monto }) {
  //el cliente debe existir (estar identificado)
  if (!clienteActual) {
    return { exito: false, mensaje: "Primero el cliente debe identificarse con su DNI" };
  }

  //la deuda debe ser mayor a 0
  if (clienteActual.deuda <= 0) {
    return { exito: false, mensaje: "El cliente no tiene deuda pendiente" };
  }

  const pago = redondear(Number(monto));

  if (!Number.isFinite(pago) || pago <= 0) {
    return { exito: false, mensaje: "El monto a pagar debe ser mayor a 0" };
  }

  // el monto no debe exceder el total de la deuda
  if (pago > clienteActual.deuda) {
    return {
      exito: false,
      mensaje: `El monto excede la deuda. Deuda actual: S/ ${clienteActual.deuda}`,
    };
  }

  clienteActual.deuda = redondear(clienteActual.deuda - pago);
  guardarClientes(); // el pago queda guardado en clientes.json
  return {
    exito: true,
    mensaje: `Pago registrado de S/ ${pago}`,
    deudaRestante: clienteActual.deuda,
  };
}

// Colección de funciones
const funciones = { identificarCliente, consultarDeuda, pagarDeuda };

// unción para el MODELO
const tools = [
  {
    type: "function",
    name: "identificarCliente",
    description: "Identifica al cliente por su DNI. Debe usarse antes de consultar o pagar.",
    parameters: {
      type: "object",
      properties: {
        dni: { type: "string", description: "DNI del cliente (8 dígitos)" },
      },
      required: ["dni"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: "function",
    name: "consultarDeuda",
    description: "Devuelve el estado y monto de la deuda actual del cliente identificado",
    parameters: {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: "function",
    name: "pagarDeuda",
    description: "Registra un pago a la deuda del cliente identificado. Úsala solo cuando el cliente indique el monto a pagar",
    parameters: {
      type: "object",
      properties: {
        monto: { type: "number", description: "Monto en soles a pagar" },
      },
      required: ["monto"],
      additionalProperties: false,
    },
    strict: true,
  },
];

const INSTRUCCIONES = `Eres el asistente de cobranzas de una tienda comercial. Responde en español, breve y amable.
Primero pide el DNI y usa identificarCliente. Sin identificación no des información ni registres pagos.
Luego ofrece: (1) Conocer el estado de la deuda actual, (2) Pagar la deuda.
Usa siempre las funciones; no inventes montos. Montos en soles (S/).`;

// ID de la última respuesta 
let ultimaRespuestaId = null;

async function preguntar(textoUsuario) {
  let inputActual = [{ role: "user", content: textoUsuario }];

  //5 vueltas para evitar bucles infinitos
  for (let vuelta = 0; vuelta < 5; vuelta++) {
    const response = await openai.responses.create({
      model: CONFIG.deploymentName,
      instructions: INSTRUCCIONES,
      input: inputActual,
      tools,
      previous_response_id: ultimaRespuestaId ?? undefined,
      max_output_tokens: 800,
      reasoning: { effort: "low" },
    });

    ultimaRespuestaId = response.id;

    // ¿El modelo pidió ejecutar funciones?
    const llamadas = response.output.filter((item) => item.type === "function_call");
    if (llamadas.length === 0) {
      return response.output_text;
    }

    // Ejecutar cada función y devolver el resultado al modelo
    inputActual = llamadas.map((llamada) => {
      let resultado;
      try {
        const args = JSON.parse(llamada.arguments);
        console.log(`  [Función] ${llamada.name}(${JSON.stringify(args)})`);
        resultado = funciones[llamada.name](args);
      } catch (e) {
        resultado = { error: e.message };
      }
      console.log(`  [Resultado] ${JSON.stringify(resultado)}`);

      return {
        type: "function_call_output",
        call_id: llamada.call_id,
        output: JSON.stringify(resultado),
      };
    });
  }

  return "No pude completar la solicitud, intenta de nuevo.";
}

//Chat en la terminal
const rl = readLine.createInterface({ input, output });
console.log("Asistente de cobranzas. Escribe 'salir' para terminar.");
console.log(`DNIs de prueba: ${clientes.map((c) => c.dni).join(", ")}\n`);
console.log("IA: Hola, para ayudarte primero ingresa tu DNI.\n");

while (true) {
  const texto = await rl.question("Tú: ");

  if (texto.trim().toLowerCase() === "salir") break;
  if (!texto.trim()) continue;

  try {
    const respuesta = await preguntar(texto);
    console.log(`\nIA: ${respuesta}\n`);
  } catch (e) {
    console.error("Error:", e.message);
  }
}

rl.close();
