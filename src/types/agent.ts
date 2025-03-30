export interface Agent {
  name: string; // required in creation
  agentId: string; // server will auto generate this
  description: string; // required in creation
  bio: string; // required in creation
  mission: string; // required in creation
  vision: string; // required in creation
  contact: {
    email: string; // optional
    website: string; // optional
    socials: {
      twitter: string; // optional
      github: string; // optional
      linkedin: string; // optional
    };
  };
  wallets: {
    solana: string; // own solana wallet of agent and optional
    ethereum: string; // own etherium wallet of agent and optional
    bitcoin: string; // own btc wallet of agent and optional
  };
  knowledge: {
    [key: string]: string; // Changed to key-value pair
  };
  personality: {
    tone: string; // required in creation
    humor: boolean; // required in creation
    formality: string; // required in creation
    catchphrase: string; // required in creation
    preferences: {
      topics: string[]; // optional
      languages: string[]; // optional
    };
  };
  settings: {
    max_memory_context: number; // optional
    platforms: string[]; // value can be web, twitter, discord and telegram can have one or more optional
  };
  ruleIds: string[]; // optional
  isActive?: boolean; // used by sytem
  openaiApiKey?: string; // required if platform contains web
  twitterAppKey?: string; // required if platform contains twitter
  twitterAppSecret?: string; // required if platform contains twitter
  twitterAccessToken?: string; // required if platform contains twitter
  twitterAccessSecret?: string; // required if platform contains twitter
  twitterHandle?: string; // optional
  enablePostTweet?: boolean;
  postTweetInterval?: number;
  agentType: "basic" | "puppetos" | "thirdparty"; // required in creation default to basic
  createdBy: string;  // userId who created the agent
  profileImageId?: string;
  isTwitterPaid?: boolean;
  telegramBotToken?: string; // Required if platforms includes "telegram"
  telegramHandle?: string;   // Optional, e.g., @AgentName
  telegramGroupId?: string;  // Optional, specific group to monitor
  enableTelegramReplies?: boolean; // Optional, controls auto-replies
}