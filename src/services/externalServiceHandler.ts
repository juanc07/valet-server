// src/services/externalServiceHandler.ts
import { Task } from "../types/task";
import axios from "axios";
import OpenAI from "openai";

interface ProcessResult {
  success: boolean;
  data?: any;
  error?: string;
}

export async function processExternalTask(task: Task): Promise<ProcessResult> {
  try {
    switch (task.task_type) {
      case "api_call":
        return await handleApiCall(task);
      case "blockchain_tx":
        return await handleBlockchainTx(task);
      case "mcp_action":
        return await handleMcpAction(task);
      default:
        throw new Error(`Unsupported task type: ${task.task_type}`);
    }
  } catch (error) {
    console.error(`Error processing task ${task.task_id}:`, error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

async function handleApiCall(task: Task): Promise<ProcessResult> {
  const { service_name, request_data, api_key } = task.external_service || {};
  if (!service_name || !request_data) {
    throw new Error("Missing service_name or request_data");
  }

  if (service_name === "image_generation") {
    const prompt = request_data.prompt || "Default image prompt";
    if (!api_key && !process.env.OPENAI_API_KEY) {
      throw new Error("No OpenAI API key provided for image generation");
    }
    console.log(`Processing image generation for task ${task.task_id} with api_key: ${api_key ? "present" : "missing"}`);
    try {
      const openai = new OpenAI({
        apiKey: api_key || process.env.OPENAI_API_KEY,
      });
      const response = await openai.images.generate({
        model: "dall-e-3",
        prompt,
        n: 1,
        size: "1024x1024",
        quality: "standard",
        response_format: "url",
      });

      const imageUrl = response.data[0]?.url;
      if (!imageUrl) {
        throw new Error("No image URL returned from OpenAI");
      }

      return {
        success: true,
        data: imageUrl,
      };
    } catch (error) {
      throw new Error(`Image generation failed: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }

  // Handle other API calls
  const response = await axios({
    method: request_data.method || "GET",
    url: service_name,
    data: request_data.body,
    headers: request_data.headers,
  });

  return {
    success: true,
    data: response.data,
  };
}

async function handleBlockchainTx(task: Task): Promise<ProcessResult> {
  const { service_name, request_data } = task.external_service || {};
  if (!service_name || !request_data) {
    throw new Error("Missing service_name or request_data");
  }

  // Example: Solana transaction
  if (service_name === "solana") {
    // Use solana/web3.js to send a transaction
    // Placeholder: Implement actual logic
    return {
      success: true,
      data: { txId: "mock_transaction_id" },
    };
  }

  throw new Error(`Unsupported blockchain service: ${service_name}`);
}

async function handleMcpAction(task: Task): Promise<ProcessResult> {
  const { service_name, request_data } = task.external_service || {};
  if (!service_name || !request_data) {
    throw new Error("Missing service_name or request_data");
  }

  // Example: Call MCP server
  const response = await axios.post("https://mcp-server.example.com/api/action", {
    action: request_data.action,
    params: request_data.params,
  });

  return {
    success: response.status === 200,
    data: response.data,
    error: response.status !== 200 ? response.statusText : undefined,
  };
}