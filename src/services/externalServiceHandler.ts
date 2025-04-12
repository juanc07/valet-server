import { Task } from "../types/task";
import axios from "axios";
import OpenAI from "openai";

interface ProcessResult {
  success: boolean;
  data?: any;
  error?: string;
}

export async function processExternalTask(task: Task): Promise<ProcessResult> {
  console.log(`Processing external task ${task.task_id}: type=${task.task_type}, service=${task.external_service?.service_name}`);
  try {
    switch (task.task_type) {
      case "api_call":
        return await handleApiCall(task);
      case "blockchain_tx":
        return await handleBlockchainTx(task);
      case "mcp_action":
        return await handleMcpAction(task);
      default:
        console.error(`Unsupported task type for task ${task.task_id}: ${task.task_type}`);
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
    console.error(`Missing service_name or request_data for task ${task.task_id}`);
    throw new Error("Missing service_name or request_data");
  }

  if (service_name === "image_generation") {
    console.log(`Handling image generation for task ${task.task_id}`);
    const prompt = request_data.prompt;
    if (!prompt || typeof prompt !== "string" || prompt.trim() === "") {
      console.error(`Invalid or missing prompt for task ${task.task_id}: ${prompt}`);
      throw new Error("Invalid or missing prompt for image generation");
    }
    console.log(`Using prompt for task ${task.task_id}: "${prompt}"`);

    if (!api_key && !process.env.OPENAI_API_KEY) {
      console.error(`No OpenAI API key provided for task ${task.task_id}`);
      throw new Error("No OpenAI API key provided for image generation");
    }
    console.log(`API key status for task ${task.task_id}: ${api_key ? "provided" : "using env"}`);

    try {
      const openai = new OpenAI({
        apiKey: api_key || process.env.OPENAI_API_KEY,
      });
      console.log(`Calling OpenAI image generation for task ${task.task_id}`);
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
        console.error(`No image URL returned for task ${task.task_id}`);
        throw new Error("No image URL returned from OpenAI");
      }

      console.log(`Generated image URL for task ${task.task_id}: ${imageUrl}`);
      return {
        success: true,
        data: imageUrl,
      };
    } catch (error) {
      console.error(`Image generation failed for task ${task.task_id}:`, error);
      throw new Error(`Image generation failed: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }

  // Handle other API calls
  console.log(`Handling generic API call for task ${task.task_id}: service=${service_name}`);
  const response = await axios({
    method: request_data.method || "GET",
    url: service_name,
    data: request_data.body,
    headers: request_data.headers,
  });

  console.log(`Generic API call succeeded for task ${task.task_id}`);
  return {
    success: true,
    data: response.data,
  };
}

async function handleBlockchainTx(task: Task): Promise<ProcessResult> {
  const { service_name, request_data } = task.external_service || {};
  if (!service_name || !request_data) {
    console.error(`Missing service_name or request_data for blockchain task ${task.task_id}`);
    throw new Error("Missing service_name or request_data");
  }

  console.log(`Handling blockchain transaction for task ${task.task_id}: service=${service_name}`);
  // Example: Solana transaction
  if (service_name === "solana") {
    // Use solana/web3.js to send a transaction
    // Placeholder: Implement actual logic
    console.log(`Mock blockchain transaction for task ${task.task_id}`);
    return {
      success: true,
      data: { txId: "mock_transaction_id" },
    };
  }

  console.error(`Unsupported blockchain service for task ${task.task_id}: ${service_name}`);
  throw new Error(`Unsupported blockchain service: ${service_name}`);
}

async function handleMcpAction(task: Task): Promise<ProcessResult> {
  const { service_name, request_data } = task.external_service || {};
  if (!service_name || !request_data) {
    console.error(`Missing service_name or request_data for MCP task ${task.task_id}`);
    throw new Error("Missing service_name or request_data");
  }

  console.log(`Handling MCP action for task ${task.task_id}: service=${service_name}`);
  const response = await axios.post("https://mcp-server.example.com/api/action", {
    action: request_data.action,
    params: request_data.params,
  });

  const success = response.status === 200;
  console.log(`MCP action for task ${task.task_id}: success=${success}`);
  return {
    success,
    data: response.data,
    error: success ? undefined : response.statusText,
  };
}