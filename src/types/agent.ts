export interface Agent {
  name: string;
  id: string;
  description: string;
  bio: string;
  mission: string;
  vision: string;
  contact: {
    email: string;
    website: string;
    socials: {
      twitter: string;
      github: string;
      linkedin: string;
    };
  };
  wallets: {
    solana: string;
    ethereum: string;
    bitcoin: string;
  };
  knowledge: {
    type: string;
    data: string[];
  };
  personality: {
    tone: string;
    humor: boolean;
    formality: string;
    catchphrase: string;
    preferences: {
      topics: string[];
      languages: string[];
    };
  };
  settings: {
    max_memory_context: number;
    platforms: string[];
  };
  ruleIds: string[];
  isActive?: boolean; // Optional field to track active status
  openaiApiKey?: string; // Optional OpenAI API key
  twitterApiKey?: string; // Optional Twitter API key
  twitterSecretKey?: string; // Optional Twitter secret key
  agentType: "basic" | "puppetos" | "thirdparty"; // Enum-like type for agent type
}