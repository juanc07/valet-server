// src/utils/TaskClassifier.ts
import OpenAI from "openai";
import { Agent } from "../types/agent";
import { Task } from "../types/task";

export interface TaskClassification {
  task_type: Task["task_type"];
  service_name?: string;
  request_data?: any;
  api_key?: string; // Keep if needed specifically by the consumer of this classification
}

// List of common chat patterns - uses regex for flexibility
const simpleChatPatterns = [
  /^h(e|a)llo/i, // hello, hallo
  /^h(i|ey)/i, // hi, hey
  /^(good )?(morning|afternoon|evening)/i, // good morning, afternoon, evening
  /^how are you(\sdrawing)?\??$/i, // how are you, how are you doing? (avoiding 'how are you drawing x')
  /^what'?s up\??$/i, // what's up?, whats up?
  /^thanks?( you)?!?$/i, // thanks, thank you
  /^ok(ay)?!?$/i, // ok, okay
  /^bye!?$/i, // bye
  /^(sounds? )?good!?$/i, // good, sounds good
  /^who are you\??$/i, // who are you?
  /^what'?s? your name\??$/i, // what's your name?, what is your name?
  /^tell me a joke$/i, // tell me a joke
  /^can you talk\??$/i, // can you talk?
  /^\?+$/i, // only question marks
  /^\!+$/i, // only exclamation marks
];

export class TaskClassifier {
  static async classifyTask(message: string, agent: Agent, recentTasks: Task[]): Promise<TaskClassification> {

    // --- Improvement 4: Pre-filtering for simple chat messages ---
    const trimmedMessage = message.trim();
    if (simpleChatPatterns.some(pattern => pattern.test(trimmedMessage))) {
         console.log(`TaskClassifier pre-classified as chat: "${trimmedMessage}"`);
         return { task_type: "chat" };
    }
    // Optional: Add length check for very short, non-keyword messages
    // if (trimmedMessage.length < 10 && !/(generate|draw|make|create|send|fetch|api|mcp|protocol|tx|blockchain)/i.test(trimmedMessage)) {
    //      console.log(`TaskClassifier pre-classified short message as chat: "${trimmedMessage}"`);
    //      return { task_type: "chat" };
    // }
    // --- End of Pre-filtering ---


    try {
      const openai = new OpenAI({ apiKey: agent.openaiApiKey });
      const context = recentTasks
        .map((t) => `Command: ${t.command}, Result: ${t.result || "Pending"}`)
        .join("\n");

      // --- Improvement 1 & 2: Updated Prompt ---
      const prompt = `
You are a precise task classifier for a chatbot. Your primary goal is to distinguish between actionable tasks and general conversation/questions. Given a user's message, determine the intended task type and provide details STRICTLY in the specified JSON format.

Possible Task Types:
- "chat": General conversation, greetings, simple questions (about the bot or general knowledge), expressions of gratitude, conversational filler. Examples: "What is AI?", "What's your name?", "How are you?", "Hello", "Thanks", "Tell me about dogs.", "What is the capital of France?".
- "api_call": External API requests. Requires 'service_name'.
  - service_name: "image_generation": Requests to create, draw, make, generate, or produce a visual subject (e.g., "cat", "dog", "sunset", "sky", "tree", "dragon", "rainbow", "unicorn", "picture", "art", "image"). Requires 'request_data' with a 'prompt' field and the 'api_key'.
  - service_name: "third_party_api": Requests to fetch data or interact with other external services (e.g., "Fetch weather data", "Get stock price for AAPL"). Requires 'request_data' with a 'command' field.
- "blockchain_tx": Blockchain transactions (e.g., "Send 1 SOL to address"). Requires 'service_name' (e.g., "solana") and 'request_data' with a 'command' field.
- "mcp_action": Specific MCP protocol actions (e.g., "Run MCP protocol"). Requires 'service_name' (e.g., "mcp_server") and 'request_data' with a 'command' field.

Instructions:
- **Prioritize "chat"**: Classify greetings (hello, hi), simple questions ("how are you?", "what's your name?"), thanks ("thanks", "thank you"), and general knowledge questions ("what is...?","tell me about...") as "chat" unless they explicitly request a different task type (like image generation).
- **Image Generation Trigger:** Classify any message requesting to create, draw, make, or generate a visual subject (e.g., "cat", "dog", "sunset", "sky", "tree", "dragon", "rainbow", "unicorn", "picture", "art") as "api_call" with service_name "image_generation". Capture the user's full request in the 'request_data.prompt'. Include the provided API key. Conversational phrasing ("can you", "please", "for me") doesn't change this.
- **Other Tasks:** Look for keywords related to blockchain (send, transfer, SOL, address, tx), MCP (mcp, protocol), or generic API calls (fetch, get data, api) for other task types. Capture the user's full request in 'request_data.command'.
- **Output Format:** Respond ONLY with the JSON object containing 'task_type' and other relevant fields ('service_name', 'request_data', 'api_key' for image generation). Do not include any explanations or surrounding text.

Examples:
1. Message: "Generate image of a sunset"
   Response: {"task_type": "api_call", "service_name": "image_generation", "request_data": { "prompt": "Generate image of a sunset" }, "api_key": "${agent.openaiApiKey}"}
2. Message: "Can you create a rainbow cat for me?"
   Response: {"task_type": "api_call", "service_name": "image_generation", "request_data": { "prompt": "Can you create a rainbow cat for me?" }, "api_key": "${agent.openaiApiKey}"}
3. Message: "Draw a colorful dog"
   Response: {"task_type": "api_call", "service_name": "image_generation", "request_data": { "prompt": "Draw a colorful dog" }, "api_key": "${agent.openaiApiKey}"}
4. Message: "Make a starry night sky"
   Response: {"task_type": "api_call", "service_name": "image_generation", "request_data": { "prompt": "Make a starry night sky" }, "api_key": "${agent.openaiApiKey}"}
5. Message: "Please draw a neon tree"
   Response: {"task_type": "api_call", "service_name": "image_generation", "request_data": { "prompt": "Please draw a neon tree" }, "api_key": "${agent.openaiApiKey}"}
6. Message: "Can you make a glowing dragon?"
   Response: {"task_type": "api_call", "service_name": "image_generation", "request_data": { "prompt": "Can you make a glowing dragon?" }, "api_key": "${agent.openaiApiKey}"}
7. Message: "Can you create a sparkling unicorn?"
   Response: {"task_type": "api_call", "service_name": "image_generation", "request_data": { "prompt": "Can you create a sparkling unicorn?" }, "api_key": "${agent.openaiApiKey}"}
8. Message: "Can you tell me about cats?"
   Response: {"task_type": "chat"}
9. Message: "Send 1 SOL to 0x123"
   Response: {"task_type": "blockchain_tx", "service_name": "solana", "request_data": { "command": "Send 1 SOL to 0x123" }}
10. Message: "What is the capital of France?"
    Response: {"task_type": "chat"}
11. Message: "How are you?"
    Response: {"task_type": "chat"}
12. Message: "Hello there"
    Response: {"task_type": "chat"}
13. Message: "Thanks!"
    Response: {"task_type": "chat"}
14. Message: "Fetch weather data for London"
    Response: {"task_type": "api_call", "service_name": "third_party_api", "request_data": { "command": "Fetch weather data for London" }}
15. Message: "Run MCP protocol sequence alpha"
    Response: {"task_type": "mcp_action", "service_name": "mcp_server", "request_data": { "command": "Run MCP protocol sequence alpha" }}

Message: "${message}"
Context (recent tasks): ${context || "None"}

JSON Response:
`; // Added "JSON Response:" to guide the model better

      const response = await openai.chat.completions.create({
        model: "gpt-3.5-turbo", // Or consider "gpt-4o-mini" or "gpt-4o" if available and budget allows for potentially better nuance understanding
        messages: [
          // Use system role for instructions if the model supports it well
          { role: "system", content: prompt },
          // Reiterate the message as user input (some models perform better this way)
          { role: "user", content: message },
        ],
        // --- Improvement 3: Lowered Temperature ---
        temperature: 0.1, // Lower temperature for more deterministic output
        response_format: { type: "json_object" }, // Enforce JSON output if using newer models/APIs
      });

      // Use response_format if available, otherwise parse manually
      let resultJson: any;
      const rawResult = response.choices[0]?.message.content;

      if (!rawResult) {
          throw new Error("No response content from OpenAI");
      }

      try {
          // The model should return *only* JSON because of the prompt and response_format
          resultJson = JSON.parse(rawResult);
      } catch (parseError) {
          console.error(`Error parsing OpenAI JSON response for "${message}":`, rawResult, parseError);
          // Attempt to extract JSON from potentially noisy output (less ideal)
          const jsonMatch = rawResult.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
              try {
                  resultJson = JSON.parse(jsonMatch[0]);
                  console.warn(`Extracted JSON from noisy response: ${jsonMatch[0]}`);
              } catch (nestedParseError) {
                   throw new Error(`Failed to parse even extracted JSON: ${nestedParseError}`);
              }
          } else {
            throw new Error(`No valid JSON found in OpenAI response: ${rawResult}`);
          }
      }


      if (!resultJson || !resultJson.task_type) {
        throw new Error(`Invalid or missing task_type in response from OpenAI: ${JSON.stringify(resultJson)}`);
      }

      console.log(`TaskClassifier LLM result for "${message}":`, resultJson);
      // Ensure the API key is added back if it was part of the response schema but maybe omitted by the LLM
       if (resultJson.task_type === 'api_call' && resultJson.service_name === 'image_generation' && !resultJson.api_key) {
          resultJson.api_key = agent.openaiApiKey;
          console.log(`TaskClassifier added missing api_key for image_generation`);
       }
      return resultJson as TaskClassification;

    } catch (error) {
      console.error(`Error classifying task via LLM for message "${message}":`, error);
      // Fallback if LLM fails or pre-filtering didn't catch it
      const fallbackResult = TaskClassifier.fallbackClassifyTask(message, agent);
      console.log(`TaskClassifier fallback result for "${message}":`, fallbackResult);
      return fallbackResult;
    }
  }

  // Fallback classifier remains similar, but ensure it aligns with desired types
  private static fallbackClassifyTask(message: string, agent: Agent): TaskClassification {
    const lowerMessage = message.toLowerCase().trim();

    // --- Improvement 5: Refined Fallback ---
    // More robust image generation check
     if (
      lowerMessage.includes("generate image") ||
      lowerMessage.includes("create image") ||
      lowerMessage.includes("make image") ||
      lowerMessage.includes("draw a") || // More specific "draw a"
      lowerMessage.match(/(create|make|draw|generate|produce|show me a picture of)\b.*(cat|dog|sunset|rainbow|sky|dragon|tree|unicorn|picture|art|image|visual)/i)
    ) {
      return {
        task_type: "api_call",
        service_name: "image_generation",
        request_data: { prompt: message }, // Use original message for prompt
        api_key: agent.openaiApiKey,
      };
    }
    // Blockchain check
    if (
      lowerMessage.includes("send") && (lowerMessage.includes("sol") || lowerMessage.includes("token")) ||
      lowerMessage.includes("blockchain transaction") ||
      lowerMessage.includes("transfer") && lowerMessage.includes("address")
    ) {
      return {
        task_type: "blockchain_tx",
        service_name: "solana", // Default or make more dynamic if needed
        request_data: { command: message },
      };
    }
    // MCP check
    if (lowerMessage.includes("mcp") || lowerMessage.includes("run protocol")) {
      return {
        task_type: "mcp_action",
        service_name: "mcp_server", // Default or make more dynamic
        request_data: { command: message },
      };
    }
    // Generic API check
    if (lowerMessage.includes("api") || lowerMessage.includes("fetch data") || lowerMessage.includes("get weather") || lowerMessage.includes("stock price")) {
      return {
        task_type: "api_call",
        service_name: "third_party_api",
        request_data: { command: message },
      };
    }

    // Default to chat if none of the above task patterns match
    return { task_type: "chat" };
  }
}