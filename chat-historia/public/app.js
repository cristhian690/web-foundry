const chat = document.getElementById("chat");
const form = document.getElementById("form");
const texto = document.getElementById("texto");
const btnEnviar = document.getElementById("enviar");
const btnNuevo = document.getElementById("nuevo");
const bienvenidaHTML = document.getElementById("bienvenida").outerHTML;

// Historial de la conversación (se envía al servidor en cada pregunta)
let mensajes = [];
let ocupado = false;

// Convierte un texto con markdown sencillo a HTML seguro
function formatear(md) {
  const esc = md.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const inline = (s) =>
    s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/(^|[^*])\*(?!\s)(.+?)\*/g, "$1<em>$2</em>");

  const bloques = [];
  let lista = null;
  for (const linea of esc.split("\n")) {
    const ul = linea.match(/^\s*[-•*]\s+(.*)/);
    const ol = linea.match(/^\s*\d+[.)]\s+(.*)/);
    if (ul || ol) {
      const tipo = ul ? "ul" : "ol";
      if (!lista || lista.tipo !== tipo) bloques.push((lista = { tipo, items: [] }));
      lista.items.push(inline((ul || ol)[1]));
    } else if (linea.trim()) {
      lista = null;
      const titulo = linea.match(/^#{1,6}\s+(.*)/);
      bloques.push(titulo ? `<p><strong>${inline(titulo[1])}</strong></p>` : `<p>${inline(linea)}</p>`);
    } else {
      lista = null;
    }
  }
  return bloques
    .map((b) => (typeof b === "string" ? b : `<${b.tipo}>${b.items.map((i) => `<li>${i}</li>`).join("")}</${b.tipo}>`))
    .join("");
}

function agregarMensaje(role, contenido = "") {
  document.getElementById("bienvenida")?.remove();
  const el = document.createElement("div");
  el.className = `msg ${role === "user" ? "user" : "bot"}`;
  el.innerHTML = `<div class="avatar">${role === "user" ? "Tú" : "IA"}</div><div class="bubble"></div>`;
  const bubble = el.querySelector(".bubble");
  if (role === "user") bubble.textContent = contenido;
  else bubble.innerHTML = '<span class="typing"><i></i><i></i><i></i></span>';
  chat.appendChild(el);
  chat.scrollTop = chat.scrollHeight;
  return bubble;
}

function setOcupado(valor) {
  ocupado = valor;
  btnEnviar.disabled = valor || !texto.value.trim();
}

async function enviar(pregunta) {
  pregunta = pregunta.trim();
  if (!pregunta || ocupado) return;

  mensajes.push({ role: "user", content: pregunta });
  agregarMensaje("user", pregunta);
  texto.value = "";
  ajustarAltura();
  setOcupado(true);

  const bubble = agregarMensaje("assistant");
  let respuesta = "";

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mensajes }),
    });

    if (!res.ok || !res.body) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || "Error del servidor");
    }

    // Leer el stream SSE
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const eventos = buffer.split("\n\n");
      buffer = eventos.pop();

      for (const ev of eventos) {
        const tipo = ev.match(/^event: (.*)$/m)?.[1];
        const datos = JSON.parse(ev.match(/^data: (.*)$/m)?.[1] || "{}");
        if (tipo === "delta") {
          respuesta += datos.texto;
          bubble.innerHTML = formatear(respuesta);
          chat.scrollTop = chat.scrollHeight;
        } else if (tipo === "error") {
          throw new Error(datos.error);
        }
      }
    }

    if (!respuesta) throw new Error("El modelo no devolvió respuesta");
    mensajes.push({ role: "assistant", content: respuesta });
  } catch (e) {
    bubble.classList.add("error");
    bubble.textContent = e.message;
    mensajes.pop(); // quitar la pregunta fallida del historial
  } finally {
    setOcupado(false);
    texto.focus();
  }
}

function ajustarAltura() {
  texto.style.height = "auto";
  texto.style.height = texto.scrollHeight + "px";
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  enviar(texto.value);
});

texto.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    enviar(texto.value);
  }
});

texto.addEventListener("input", () => {
  ajustarAltura();
  setOcupado(ocupado);
});

btnNuevo.addEventListener("click", () => {
  if (ocupado) return;
  mensajes = [];
  chat.innerHTML = bienvenidaHTML;
  texto.focus();
});

setOcupado(false);
texto.focus();
