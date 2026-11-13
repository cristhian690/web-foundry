/* FRONTEND */
const formulario = document.getElementById('formulario')
const archivo = document.getElementById('archivo')
const estado = document.getElementById('estado')
const resultado = document.getElementById('resultado')

formulario.addEventListener("submit", async (e) => {
  e.preventDefault()

  const archivoPDF = archivo.files[0]
  if(!archivoPDF) return

  estado.innerText = 'Analizando documento'

  const datos = new FormData()
  datos.append("archivo", archivoPDF)

  try{
    const respuesta = await fetch("/api/ocr", {
      method: "POST",
      body: datos
    })

    const json = await respuesta.json().catch(() => ({}))

    if (!respuesta.ok) throw new Error(json.error || "No se pudo analizar el PDF")
    mostrarResultado(json)

  }catch(e){
    console.error(e)
  }

})

function mostrarResultado(json){
  console.log(json)
}