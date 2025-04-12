// src/utils/TaskClassifier.test.ts
import { TaskClassifier } from "./TaskClassifier";
import { Agent } from "../types/agent";
import OpenAI from "openai";

jest.mock("openai");

describe("TaskClassifier", () => {
  const mockAgent: Agent = {
    agentId: "test-agent",
    name: "Test Agent",
    description: "Test",
    bio: "Test",
    mission: "Test",
    vision: "Test",
    contact: { email: "", website: "", socials: { twitter: "", github: "", linkedin: "" } },
    wallets: { solana: "", ethereum: "", bitcoin: "" },
    knowledge: {},
    personality: { tone: "neutral", humor: false, formality: "informal", catchphrase: "Test", preferences: { topics: [], languages: [] } },
    settings: { max_memory_context: 5, platforms: ["web"] },
    ruleIds: [],
    isActive: true,
    openaiApiKey: "sk-test-key",
    agentType: "basic",
    createdBy: "test-user",
    enablePostTweet: false,
    isTwitterPaid: false,
    enableTelegramReplies: false,
  };

  let mockCreate: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockCreate = jest.fn();
    (OpenAI as jest.MockedClass<typeof OpenAI>).mockImplementation(() => ({
      chat: {
        completions: {
          create: mockCreate,
        },
      },
    } as any));
  });

  it("classifies image generation task", async () => {
    mockCreate.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              task_type: "api_call",
              service_name: "image_generation",
              request_data: { prompt: "Generate image of a sunset" },
              api_key: mockAgent.openaiApiKey,
            }),
          },
          finish_reason: "stop",
        },
      ],
      id: "test-id",
      created: Math.floor(Date.now() / 1000),
      model: "gpt-3.5-turbo",
      object: "chat.completion",
    });

    const result = await TaskClassifier.classifyTask("Generate image of a sunset", mockAgent, []);
    expect(result).toEqual({
      task_type: "api_call",
      service_name: "image_generation",
      request_data: { prompt: "Generate image of a sunset" },
      api_key: mockAgent.openaiApiKey,
    });
    expect(mockCreate).toHaveBeenCalled();
  });

  it("falls back on API failure", async () => {
    mockCreate.mockRejectedValue(new Error("API failure"));

    const invalidAgent: Agent = {
      ...mockAgent,
      openaiApiKey: "",
    };
    const result = await TaskClassifier.classifyTask("Generate image of a sunset", invalidAgent, []);
    expect(result).toEqual({
      task_type: "api_call",
      service_name: "image_generation",
      request_data: { prompt: "Generate image of a sunset" },
      api_key: "",
    });
    expect(mockCreate).toHaveBeenCalled();
  });
});