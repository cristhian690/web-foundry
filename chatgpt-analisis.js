import "dotenv/config";
import OpenAI from "openai";
import fs from "node:fs"; // File System

/* ANÁLISIS DE ARCHIVO UTILIZANDO MODELO GPT-5.4-MINI */

const endpoint = process.env.AZURE_ENDPOINT;
const deploymentName = process.env.AZURE_DEPLOYMENT;
const apiKey = process.env.AZURE_API_KEY?.trim();

const openai = new OpenAI({
  baseURL: endpoint,
  apiKey: apiKey,
  defaultHeaders: { "api-key": apiKey },
});

// Acceder al archivo que analizaremos
//const imagenBase64 = fs.readFileSync("factura.png").toString("base64");
const imagenBase64 = fs.readFileSync("factura.png").toString("base64");

const res = await openai.responses.create({
  model: deploymentName,
  instructions: "Responde siempre en español",
  input: [
    {
      role: "user",
      content: [
        { type: "input_text", text: "¿Qué ves en la imagen? Indícame cuántas personas hay y las características que encuentras" },
        { type: "input_image", image_url: `data:image/png;base64,${imagenBase64}` },
      ],
    },
  ],
});

console.log(res.output_text);