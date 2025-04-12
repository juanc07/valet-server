import { Request, Response } from "express";
import OpenAI from "openai";
import { connectToDatabase } from "../services/dbService";
import { AgentPromptGenerator } from "../utils/agentPromptGenerator";
import { Agent } from "../types/agent";
import { Task } from "../types/task";
import { TemporaryUser } from "../types/user";
import { v4 as uuidv4 } from "uuid";
import { shouldSaveAsTask } from "../utils/criteriaUtils"; // Modified: Re-imported
import { saveTask, getRecentTasks, updateTask } from "../controllers/taskController";
import { WithId } from "mongodb";
import { TaskClassifier } from "../utils/TaskClassifier";

interface ChatParams {
  agentId: string;
}

interface ChatRequestBody {
  message: string;
  userId?: string;
}

export const chatWithAgent = async (req: Request<ChatParams, any, ChatRequestBody>, res: Response) => {
  const agentId = req.params.agentId;
  try {
    const db = await connectToDatabase();
    const { message, userId } = req.body;

    if (!message) {
      res.status(400).json({ error: "Message is required" });
      return;
    }

    const agent = (await db.collection("agents").findOne({ agentId })) as Agent | null;
    if (!agent) {
      res.status(404).json({ error: "Agent not found" });
      return;
    }

    if (agent.isActive === false) {
      res.status(403).json({ agentId, reply: "Sorry, this agent is currently inactive." });
      return;
    }

    if (!agent.openaiApiKey || agent.openaiApiKey.trim() === "") {
      res.status(400).json({ agentId, reply: "OPENAI API key is required to process your request." });
      return;
    }

    // Identify registered or unregistered user
    let unified_user_id: string | undefined;
    let temporary_user_id: string | undefined;
    let channel_user_id: string | undefined;

    if (userId) {
      const user = await db.collection("users").findOne({ userId });
      if (user) {
        unified_user_id = user.userId;
        console.log(`Registered user found: ${unified_user_id}`);
      } else {
        console.log(`No registered user found for userId: ${userId}`);
      }
    }

    if (!unified_user_id) {
      channel_user_id = userId || `web_${uuidv4()}`;
      let tempUser: WithId<TemporaryUser> | null = (await db
        .collection("temporaryUsers")
        .findOne({
          "linked_channels.web_user_id": channel_user_id,
        })) as WithId<TemporaryUser> | null;

      if (!tempUser) {
        const newTempUser: TemporaryUser = {
          temporary_user_id: uuidv4(),
          linked_channels: { web_user_id: channel_user_id },
          created_at: new Date(),
          expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        };
        const insertResult = await db.collection("temporaryUsers").insertOne(newTempUser);
        tempUser = { ...newTempUser, _id: insertResult.insertedId };
      }
      temporary_user_id = tempUser.temporary_user_id;
      console.log(`Temporary user: ${temporary_user_id} for web_user_id: ${channel_user_id}`);

      // Handle unregistered users
      const reply = `Please visit valetapp.xyz to connect your wallet and register!`;
      res.status(200).json({ agentId, reply, task_id: undefined, isTask: false });
      return; // Skip further processing for unregistered users
    }

    // Retrieve recent tasks for context
    const recentTasks = await getRecentTasks(
      {
        unified_user_id,
        temporary_user_id,
        channel_user_id,
      },
      agent.settings?.max_memory_context || 5
    );
    const hasRecentTasks = recentTasks.length > 0;
    const context = recentTasks
      .map((t) => `Command: ${t.command}, Result: ${t.result || "Pending"}`)
      .join("\n");

    // Knowledge base check
    let canAnswerFromKnowledge = false;
    const lowerMessage = message.toLowerCase();
    if (lowerMessage.includes("name") || lowerMessage.includes("who are you") || lowerMessage.includes("who're you")) {
      canAnswerFromKnowledge = true;
    } else if (agent.knowledge && Object.keys(agent.knowledge).length > 0) {
      for (const [key, value] of Object.entries(agent.knowledge)) {
        if (lowerMessage.includes(key.toLowerCase()) && value) {
          canAnswerFromKnowledge = true;
          break;
        }
      }
    }

    let reply: string;
    let task_id: string | undefined;
    let isTask = false;

    if (!canAnswerFromKnowledge) {
      // Modified: Combine TaskClassifier and shouldSaveAsTask
      const classification = await TaskClassifier.classifyTask(message, agent, recentTasks);
      const shouldSave = shouldSaveAsTask(message, hasRecentTasks);
      console.log(`Classification for "${message}":`, {
        taskClassifier: classification,
        shouldSaveAsTask: shouldSave,
      });

      if (classification.task_type !== "chat" || shouldSave) {
        // Save as task
        task_id = uuidv4();
        isTask = true;
        const task: Task = {
          task_id,
          channel_id: "web",
          channel_user_id: channel_user_id || temporary_user_id || unified_user_id || "unknown",
          unified_user_id,
          temporary_user_id,
          command: message,
          status: "pending",
          created_at: new Date(),
          completed_at: null,
          agent_id: agentId,
          task_type: classification.task_type !== "chat" ? classification.task_type : "chat",
          external_service:
            classification.task_type !== "chat"
              ? {
                  service_name: classification.service_name || "third_party_api",
                  request_data: classification.request_data,
                  status: "pending",
                  api_key: classification.api_key,
                }
              : undefined,
          max_retries: classification.task_type !== "chat" ? 3 : undefined,
        };
        await saveTask(task);
        console.log(`Saved task: ${task_id} for message: "${message}" (type: ${task.task_type})`);
        reply = `Your request has been queued for processing (Task ID: ${task_id}). You'll be notified once it's complete.`;
      } else {
        // Handle chat messages
        const promptGenerator = new AgentPromptGenerator(agent);
        const prompt = promptGenerator.generatePrompt(
          `${message}\nPrevious interactions:\n${context || "None"}`
        );

        const openai = new OpenAI({ apiKey: agent.openaiApiKey });
        const response = await openai.chat.completions.create({
          model: "gpt-3.5-turbo",
          messages: [{ role: "system", content: prompt }],
        });

        reply = response.choices[0].message.content || "Sorry, I couldn't generate a response.";
      }
    } else {
      // Handle knowledge-based responses
      if (lowerMessage.includes("name") || lowerMessage.includes("who are you") || lowerMessage.includes("who're you")) {
        reply = agent.name ? `I'm ${agent.name}! Nice to chat with you.` : "I'm your friendly assistant! Nice to chat with you.";
      } else {
        const promptGenerator = new AgentPromptGenerator(agent);
        const prompt = promptGenerator.generatePrompt(
          `${message}\nPrevious interactions:\n${context || "None"}`
        );

        const openai = new OpenAI({ apiKey: agent.openaiApiKey });
        const response = await openai.chat.completions.create({
          model: "gpt-3.5-turbo",
          messages: [{ role: "system", content: prompt }],
        });

        reply = response.choices[0].message.content || "Sorry, I couldn't generate a response.";
      }
    }

    res.status(200).json({ agentId, reply, task_id, isTask });
  } catch (error) {
    console.error(`Chat error for agent ${agentId}:`, error);
    res.status(500).json({ agentId, error: "Failed to get response from agent" });
  }
};

export const chatWithAgentStream = async (req: Request<ChatParams, any, ChatRequestBody>, res: Response) => {
  const agentId = req.params.agentId;
  try {
    const db = await connectToDatabase();
    const { message, userId } = req.body;

    if (!message) {
      res.status(400).json({ error: "Message is required" });
      return;
    }

    const agent = (await db.collection("agents").findOne({ agentId })) as Agent | null;
    if (!agent) {
      res.status(404).json({ error: "Agent not found" });
      return;
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("Transfer-Encoding", "chunked");

    if (agent.isActive === false) {
      res.write(`data: ${JSON.stringify({ agentId, content: "Sorry, this agent is currently inactive." })}\n\n`);
      res.write("data: [DONE]\n\n");
      res.end();
      return;
    }

    if (!agent.openaiApiKey || agent.openaiApiKey.trim() === "") {
      res.write(
        `data: ${JSON.stringify({ agentId, content: "OPENAI API key is required to process your request." })}\n\n`
      );
      res.write("data: [DONE]\n\n");
      res.end();
      return;
    }

    let unified_user_id: string | undefined;
    let temporary_user_id: string | undefined;
    let channel_user_id: string | undefined;

    if (userId) {
      const user = await db.collection("users").findOne({ userId });
      if (user) {
        unified_user_id = user.userId;
        console.log(`Registered user found: ${unified_user_id}`);
      } else {
        console.log(`No registered user found for userId: ${userId}`);
      }
    }

    if (!unified_user_id) {
      channel_user_id = userId || `web_${uuidv4()}`;
      let tempUser: WithId<TemporaryUser> | null = (await db
        .collection("temporaryUsers")
        .findOne({
          "linked_channels.web_user_id": channel_user_id,
        })) as WithId<TemporaryUser> | null;

      if (!tempUser) {
        const newTempUser: TemporaryUser = {
          temporary_user_id: uuidv4(),
          linked_channels: { web_user_id: channel_user_id },
          created_at: new Date(),
          expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        };
        const insertResult = await db.collection("temporaryUsers").insertOne(newTempUser);
        tempUser = { ...newTempUser, _id: insertResult.insertedId };
      }
      temporary_user_id = tempUser.temporary_user_id;
      console.log(`Temporary user: ${temporary_user_id} for web_user_id: ${channel_user_id}`);

      // Handle unregistered users
      const reply = `Please visit valetapp.xyz to connect your wallet and register!`;
      res.write(`data: ${JSON.stringify({ agentId, content: reply, task_id: undefined, isTask: false })}\n\n`);
      res.write("data: [DONE]\n\n");
      res.end();
      return; // Skip further processing for unregistered users
    }

    const recentTasks = await getRecentTasks(
      {
        unified_user_id,
        temporary_user_id,
        channel_user_id,
      },
      agent.settings?.max_memory_context || 5
    );
    const hasRecentTasks = recentTasks.length > 0;
    const context = recentTasks
      .map((t) => `Command: ${t.command}, Result: ${t.result || "Pending"}`)
      .join("\n");

    // Knowledge base check
    let canAnswerFromKnowledge = false;
    const lowerMessage = message.toLowerCase();
    if (lowerMessage.includes("name") || lowerMessage.includes("who are you") || lowerMessage.includes("who're you")) {
      canAnswerFromKnowledge = true;
    } else if (agent.knowledge && Object.keys(agent.knowledge).length > 0) {
      for (const [key, value] of Object.entries(agent.knowledge)) {
        if (lowerMessage.includes(key.toLowerCase()) && value) {
          canAnswerFromKnowledge = true;
          break;
        }
      }
    }

    if (canAnswerFromKnowledge) {
      // Handle knowledge-based responses
      if (lowerMessage.includes("name") || lowerMessage.includes("who are you") || lowerMessage.includes("who're you")) {
        const reply = agent.name ? `I'm ${agent.name}! Nice to chat with you.` : "I'm your friendly assistant! Nice to chat with you.";
        res.write(`data: ${JSON.stringify({ agentId, content: reply })}\n\n`);
        res.write("data: [DONE]\n\n");
        res.end();
      } else {
        const promptGenerator = new AgentPromptGenerator(agent);
        const prompt = promptGenerator.generatePrompt(
          `${message}\nPrevious interactions:\n${context || "None"}`
        );

        const openai = new OpenAI({ apiKey: agent.openaiApiKey });
        const stream = await openai.chat.completions.create({
          model: "gpt-3.5-turbo",
          messages: [{ role: "system", content: prompt }],
          stream: true,
        });

        console.log(`Stream started for agent ${agentId} at:`, new Date().toISOString());
        let fullReply = "";
        for await (const chunk of stream) {
          const content = chunk.choices[0]?.delta?.content || "";
          if (content) {
            fullReply += content;
            console.log(`Chunk for agent ${agentId}:`, content);
            res.write(`data: ${JSON.stringify({ agentId, content })}\n\n`);
          }
        }

        console.log(`Stream ended for agent ${agentId} at:`, new Date().toISOString());
        res.write("data: [DONE]\n\n");
        res.end();
      }
    } else {
      // Modified: Combine TaskClassifier and shouldSaveAsTask
      const classification = await TaskClassifier.classifyTask(message, agent, recentTasks);
      const shouldSave = shouldSaveAsTask(message, hasRecentTasks);
      console.log(`Classification for "${message}":`, {
        taskClassifier: classification,
        shouldSaveAsTask: shouldSave,
      });

      if (classification.task_type !== "chat" || shouldSave) {
        // Save as task
        const task_id = uuidv4();
        const task: Task = {
          task_id,
          channel_id: "web",
          channel_user_id: channel_user_id || temporary_user_id || unified_user_id || "unknown",
          unified_user_id,
          temporary_user_id,
          command: message,
          status: "pending",
          created_at: new Date(),
          completed_at: null,
          agent_id: agentId,
          task_type: classification.task_type !== "chat" ? classification.task_type : "chat",
          external_service:
            classification.task_type !== "chat"
              ? {
                  service_name: classification.service_name || "third_party_api",
                  request_data: classification.request_data,
                  status: "pending",
                  api_key: classification.api_key,
                }
              : undefined,
          max_retries: classification.task_type !== "chat" ? 3 : undefined,
        };
        await saveTask(task);
        console.log(`Saved task: ${task_id} for message: "${message}" (type: ${task.task_type})`);

        const queuedMessage = `Your request has been queued for processing (Task ID: ${task_id}). You'll be notified once it's complete.`;
        res.write(`data: ${JSON.stringify({ agentId, content: queuedMessage, task_id, isTask: true })}\n\n`);

        console.log(`Stream ended for agent ${agentId} at:`, new Date().toISOString());
        res.write("data: [DONE]\n\n");
        res.end();
      } else {
        // Handle chat messages
        const promptGenerator = new AgentPromptGenerator(agent);
        const prompt = promptGenerator.generatePrompt(
          `${message}\nPrevious interactions:\n${context || "None"}`
        );

        const openai = new OpenAI({ apiKey: agent.openaiApiKey });
        const stream = await openai.chat.completions.create({
          model: "gpt-3.5-turbo",
          messages: [{ role: "system", content: prompt }],
          stream: true,
        });

        console.log(`Stream started for agent ${agentId} at:`, new Date().toISOString());
        let fullReply = "";
        for await (const chunk of stream) {
          const content = chunk.choices[0]?.delta?.content || "";
          if (content) {
            fullReply += content;
            console.log(`Chunk for agent ${agentId}:`, content);
            res.write(`data: ${JSON.stringify({ agentId, content })}\n\n`);
          }
        }

        console.log(`Stream ended for agent ${agentId} at:`, new Date().toISOString());
        res.write("data: [DONE]\n\n");
        res.end();
      }
    }
  } catch (error) {
    console.error(`Streaming chat error for agent ${agentId}:`, error);
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.write(`data: ${JSON.stringify({ agentId, error: "Error streaming response from agent" })}\n\n`);
    res.write("data: [DONE]\n\n");
    res.end();
  }
};