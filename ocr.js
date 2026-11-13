export class OcrError extends Error{
  constructor(message, status = 500){
    super(message)
    this.name = "OcrError"
    this.status = status
  }
}

//Delay
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

//Variable .env
const config = () => ({
  endpoint: process.env.DI_ENDPOINT,
  key: process.env.DI_KEY,
  apiVersion: process.env.DI_API_VERSION || "2024-11-30",
  model: process.env.DI_MODEL || "prebuilt-read"
})

//Manejador de errores - clasificación code HTTP
async function fallo(res, contexto){
  const detalle = await res.text()
  console.error(`Error en AZURE: ${contexto} ${res.status} - descripción: ${detalle}`)

  //Analizando cada caso
  if (res.status === 401 || res.status === 403){
    return new OcrError("Azure rechazó las credenciales - verifique KEY y ENDPOINT", 502)
  }

  if (res.status === 404){
    return new OcrError("Ruta no encontrada en Azure, verifique ENDPOINT", 502)
  }

  if (res.status === 429){
    return new OcrError("Se alcanzó el límite de peticiones en el servicio de Azure", 429)
  }

  if (res.status === 400 || res.status === 413){
    return new OcrError("Azure no puede encontrar el archivo. Verifique tamaño", 400)
  }

  return new OcrError("Azure devolvió un error inesperado", 502)
}

//NO es necesario guardar el PDF de manera física (buffer = memoria)
export async function leerPDF(buffer){
  //Necesitamos los parámetros de conexión -> config()
  //Deserializar...
  const { endpoint, key, apiVersion, model } = config()

  //1. Enviar el PDF
  const url = `${endpoint}/documentintelligence/documentModels/${model}:analyze?api-version=${apiVersion}`
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Ocp-Apim-Subscription-Key": key,
      "Content-Type": "application/pdf"
    },
    body: buffer
  })

  //Error en la petición
  if (res.status !== 202){
    throw await fallo(res, "Envío")
  }

  //En caso tenemos éxito...
  const operationUrl = res.headers.get('operation-location')

  //2. Consulta (polling) hasta que termine
  for (let intento = 0; intento < 60; intento++){
    const r = await fetch(operationUrl, {
      headers: { "Ocp-Apim-Subscription-Key": key }
    })

    //Se generó un error durante la consulta de datos OCR (lectura)
    if (!r.ok) {
      throw await fallo(r, "Consulta")
    }

    //Analizamos los datos recibidos
    const data = await r.json()

    //Funcionó correctamente
    if (data.status === 'succeeded') return formatear(data.analyzeResult)

    //Si aun no ha terminado...
    if (data.status === 'failed'){
      console.error(`Azure, análisis de datos pendiente o con errores: `, JSON.stringify(data.error))
      throw new OcrError('Azure no puede analizar el documento', 502)
    }

    //Pausa para volver a intentar
    const espera = Number(r.headers.get("retry-after")) || 2
    await sleep(espera * 1000) //sleep(milisegundos)
  } //fin for intentos

  throw new OcrError("Tiempo de espera agotado al analizar el documento", 504)
}

//Retorne solo la parte necesaria del JSON que se obtiene AZURE
function formatear(analisis){
  //Obtener el número de páginas + texto
  const paginas = (analisis.pages ?? []).map((p) => ({
    numero: p.pageNumber,
    lineas: (p.lines ?? []).map((l) => l.content)
  }))

  //Retornar como JSON
  return {
    texto: analisis.content ?? "",
    totalPaginas: paginas.length,
    paginas
  }
}