import "dotenv/config";
import OpenAI from "openai";

const endpoint = process.env.AZURE_ENDPOINT;
const deploymentName = process.env.AZURE_DEPLOYMENT;
const apiKey = process.env.AZURE_API_KEY?.trim();

if (!endpoint || !apiKey || !deploymentName) {
  console.error("Faltan variables en el .env (AZURE_ENDPOINT, AZURE_API_KEY, AZURE_DEPLOYMENT)");
  process.exit(1);
}

const openai = new OpenAI({
  baseURL: endpoint,
  apiKey: apiKey,
  defaultHeaders: { "api-key": apiKey },
});

async function main() {
  try {
    const runner = openai.responses
      .stream({
        model: deploymentName,
        instructions: "Eres un asistente útil. Responde en español de forma clara y breve.",
        input: "¿Qué sabes del Perú?",
        max_output_tokens: 1500,
        text: { verbosity: "low" },
        reasoning: { effort: "low" },
      })
      .on("response.output_text.delta", (diff) => process.stdout.write(diff.delta));

    const result = await runner.finalResponse();
    console.log("\n\nTokens utilizados:", result.usage);
  } catch (error) {
    console.error("Error al conectar con Foundry:", error.status, error.message);
  }
}

main();