// src/utils/TaskClassifier.ts
import OpenAI from "openai";
import { Agent } from "../types/agent";
import { Task } from "../types/task";

export interface TaskClassification {
  task_type: Task["task_type"];
  service_name?: string;
  request_data?: any;
  api_key?: string;
}

export class TaskClassifier {
  static async classifyTask(message: string, agent: Agent, recentTasks: Task[]): Promise<TaskClassification> {
    try {
      const openai = new OpenAI({ apiKey: agent.openaiApiKey });
      const context = recentTasks
        .map((t) => `Command: ${t.command}, Result: ${t.result || "Pending"}`)
        .join("\n");

      // Modified: Added negative example and clarified instructions
      const prompt = `
You are a task classifier for a chatbot. Given a user's message, determine the intended task type and provide details in JSON format. The possible task types are:
- "chat": General conversation or questions (e.g., "What is AI?", "What's your name?", "Can you tell me about cats?").
- "api_call": External API requests, with subtypes:
  - service_name: "image_generation" (e.g., "Generate image of a sunset", "Can you create a rainbow cat for me?", "Draw a colorful dog", "Make a starry night sky", "Please draw a neon tree", "Can you make a glowing dragon?", "Can you create a sparkling unicorn?").
  - service_name: "third_party_api" (e.g., "Fetch weather data").
- "blockchain_tx": Blockchain transactions (e.g., "Send 1 SOL to address").
- "mcp_action": MCP protocol actions (e.g., "Run MCP protocol").

Instructions:
- Classify any message requesting to create, draw, make, or generate a visual subject (e.g., "cat", "dog", "sunset", "sky", "tree", "dragon", "rainbow", "unicorn", "picture", "art") as "api_call" with service_name "image_generation", even if "image" is not mentioned.
- Messages asking for information or descriptions (e.g., "tell me about", "what is") should be "chat" unless they involve visual creation.
- Conversational phrasing (e.g., "can you", "please", "for me") does not affect classification.
- Prioritize "image_generation" for any visual creation request, regardless of tone, qualifiers, or context.
- Return a JSON object with:
  - task_type: The task type.
  - service_name: For api_call tasks, specify "image_generation" or "third_party_api".
  - request_data: Relevant data (e.g., { prompt: "..." } for image_generation, { command: "..." } for others).
  - api_key: Include the provided API key for image_generation tasks.

Examples:
1. Message: "Generate image of a sunset"
   Response: {
     "task_type": "api_call",
     "service_name": "image_generation",
     "request_data": { "prompt": "Generate image of a sunset" },
     "api_key": "${agent.openaiApiKey}"
   }
2. Message: "Can you create a rainbow cat for me?"
   Response: {
     "task_type": "api_call",
     "service_name": "image_generation",
     "request_data": { "prompt": "Can you create a rainbow cat for me?" },
     "api_key": "${agent.openaiApiKey}"
   }
3. Message: "Draw a colorful dog"
   Response: {
     "task_type": "api_call",
     "service_name": "image_generation",
     "request_data": { "prompt": "Draw a colorful dog" },
     "api_key": "${agent.openaiApiKey}"
   }
4. Message: "Make a starry night sky"
   Response: {
     "task_type": "api_call",
     "service_name": "image_generation",
     "request_data": { "prompt": "Make a starry night sky" },
     "api_key": "${agent.openaiApiKey}"
   }
5. Message: "Please draw a neon tree"
   Response: {
     "task_type": "api_call",
     "service_name": "image_generation",
     "request_data": { "prompt": "Please draw a neon tree" },
     "api_key": "${agent.openaiApiKey}"
   }
6. Message: "Can you make a glowing dragon?"
   Response: {
     "task_type": "api_call",
     "service_name": "image_generation",
     "request_data": { "prompt": "Can you make a glowing dragon?" },
     "api_key": "${agent.openaiApiKey}"
   }
7. Message: "Can you create a sparkling unicorn?"
   Response: {
     "task_type": "api_call",
     "service_name": "image_generation",
     "request_data": { "prompt": "Can you create a sparkling unicorn?" },
     "api_key": "${agent.openaiApiKey}"
   }
8. Message: "Can you tell me about cats?"
   Response: { "task_type": "chat" }
9. Message: "Send 1 SOL to 0x123"
   Response: {
     "task_type": "blockchain_tx",
     "service_name": "solana",
     "request_data": { "command": "Send 1 SOL to 0x123" }
   }
10. Message: "What is the capital of France?"
    Response: { "task_type": "chat" }

Message: "${message}"
Context (recent tasks): ${context || "None"}

Provide the JSON response (no explanation).
`;

      const response = await openai.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages: [
          { role: "system", content: prompt },
          { role: "user", content: message },
        ],
        // Modified: Increased temperature
        temperature: 0.5,
      });

      const result = response.choices[0]?.message.content;
      if (!result) {
        throw new Error("No response from OpenAI");
      }

      const parsed = JSON.parse(result);
      if (!parsed.task_type) {
        throw new Error("Invalid task type response from OpenAI");
      }

      console.log(`TaskClassifier LLM result for "${message}":`, parsed);
      return parsed;
    } catch (error) {
      console.error(`Error classifying task for message "${message}":`, error);
      const fallbackResult = TaskClassifier.fallbackClassifyTask(message, agent);
      console.log(`TaskClassifier fallback result for "${message}":`, fallbackResult);
      return fallbackResult;
    }
  }

  private static fallbackClassifyTask(message: string, agent: Agent): TaskClassification {
    const lowerMessage = message.toLowerCase();
    if (
      lowerMessage.includes("generate image") ||
      lowerMessage.includes("create image") ||
      lowerMessage.includes("draw") ||
      lowerMessage.includes("make image") ||
      lowerMessage.match(/(create|make|draw|generate)\b.*(cat|dog|sunset|rainbow|sky|dragon|tree|unicorn|picture|art|image)/i)
    ) {
      return {
        task_type: "api_call",
        service_name: "image_generation",
        request_data: { prompt: message },
        api_key: agent.openaiApiKey,
      };
    }
    if (
      lowerMessage.includes("send sol") ||
      lowerMessage.includes("transaction") ||
      lowerMessage.includes("transfer")
    ) {
      return {
        task_type: "blockchain_tx",
        service_name: "solana",
        request_data: { command: message },
      };
    }
    if (lowerMessage.includes("mcp") || lowerMessage.includes("protocol")) {
      return {
        task_type: "mcp_action",
        service_name: "mcp_server",
        request_data: { command: message },
      };
    }
    if (lowerMessage.includes("api") || lowerMessage.includes("fetch data")) {
      return {
        task_type: "api_call",
        service_name: "third_party_api",
        request_data: { command: message },
      };
    }
    return { task_type: "chat" };
  }
}