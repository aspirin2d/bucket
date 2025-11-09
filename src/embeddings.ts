import { config } from "./config.js";

export const embedDescriptions = async (descriptions: string[]) => {
  if (descriptions.length === 0) {
    return [];
  }

  if (descriptions.length > config.embedding.maxBatch) {
    throw new Error(
      `Cannot embed more than ${config.embedding.maxBatch} descriptions per batch`,
    );
  }

  const requestBody: Record<string, unknown> = {
    model: config.embedding.model,
    input: {
      texts: descriptions,
    },
  };

  if (config.embedding.dimensions) {
    requestBody.parameters = {
      dimension: config.embedding.dimensions,
    };
  }

  const response = await fetch(config.embedding.baseUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.embedding.apiKey}`,
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Embedding request failed: ${error}`);
  }

  const payload = (await response.json()) as {
    data?: Array<{ embedding: number[] }>;
    output?: { embeddings: Array<{ embedding: number[] }> };
  };

  const embeddings = payload.data ?? payload.output?.embeddings;
  if (!embeddings) {
    throw new Error("Embedding response missing embeddings array");
  }

  if (embeddings.length !== descriptions.length) {
    throw new Error("Embedding response length mismatch");
  }

  return embeddings.map(({ embedding }) => {
    if (!embedding || embedding.length !== config.embedding.dimensions) {
      throw new Error("Invalid embedding response");
    }
    return embedding;
  });
};
