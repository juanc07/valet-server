import { Request, Response } from "express";
import OpenAI from "openai";
import { connectToDatabase } from "../services/dbService";
import { AgentPromptGenerator } from "../agentPromptGenerator";
import { Agent } from "../types/agent";

interface ChatParams {
  agentId: string;
}

export const chatWithAgent = async (req: Request<ChatParams>, res: Response) => {
  try {
    const db = await connectToDatabase();
    const agentId = req.params.agentId;
    const { message } = req.body;

    if (!message) {
      res.status(400).json({ error: "Message is required" });
      return;
    }

    const agent = await db.collection("agents").findOne({ agentId: agentId }) as Agent | null;
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

    const promptGenerator = new AgentPromptGenerator(agent);
    const prompt = promptGenerator.generatePrompt(message);

    const openai = new OpenAI({ apiKey: agent.openaiApiKey });
    const response = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [{ role: "system", content: prompt }],
    });

    const reply = response.choices[0].message.content;
    res.status(200).json({ agentId, reply });
  } catch (error) {
    console.error("Chat error:", error);
    res.status(500).json({ error: "Failed to get response from agent" });
  }
};

export const chatWithAgentStream = async (req: Request<ChatParams>, res: Response) => {
  try {
    const db = await connectToDatabase();
    const agentId = req.params.agentId;
    const { message } = req.body;

    if (!message) {
      res.status(400).json({ error: "Message is required" });
      return;
    }

    const agent = await db.collection("agents").findOne({ agentId: agentId }) as Agent | null;
    if (!agent) {
      res.status(404).json({ error: "Agent not found" });
      return;
    }

    if (agent.isActive === false) {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.write(`data: ${JSON.stringify({ agentId, content: "Sorry, this agent is currently inactive." })}\n\n`);
      res.write("data: [DONE]\n\n");
      res.end();
      return;
    }

    if (!agent.openaiApiKey || agent.openaiApiKey.trim() === "") {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.write(`data: ${JSON.stringify({ agentId, content: "OPENAI API key is required to process your request." })}\n\n`);
      res.write("data: [DONE]\n\n");
      res.end();
      return;
    }

    const promptGenerator = new AgentPromptGenerator(agent);
    const prompt = promptGenerator.generatePrompt(message);

    const openai = new OpenAI({ apiKey: agent.openaiApiKey });

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    const stream = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [{ role: "system", content: prompt }],
      stream: true,
    });

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content || "";
      if (content) {
        res.write(`data: ${JSON.stringify({ agentId, content })}\n\n`);
      }
    }

    res.write("data: [DONE]\n\n");
    res.end();
  } catch (error) {
    console.error("Streaming chat error:", error);
    res.status(500).send("Error streaming response from agent");
  }
};