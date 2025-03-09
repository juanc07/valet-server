import { Agent } from "./types/agent";

export class AgentPromptGenerator {
  private agent: Agent;

  constructor(agent: Agent) {
    this.agent = agent;
  }

  generatePrompt(userMessage: string): string {
    const {
      name,
      description,
      bio,
      mission,
      vision,
      personality,
      knowledge,
      contact,
      wallets,
      agentType,
    } = this.agent;

    let prompt = `You are ${name}, an AI agent created by xAI. `;
    prompt += `Here is some information about you:\n`;
    prompt += `- Description: ${description}\n`;
    prompt += `- Bio: ${bio}\n`;
    prompt += `- Mission: ${mission}\n`;
    prompt += `- Vision: ${vision}\n`;
    prompt += `- Agent Type: ${agentType}\n`;

    prompt += `\nYour personality traits:\n`;
    prompt += `- Tone: ${personality.tone}\n`;
    prompt += `- Humor: ${personality.humor ? "You use humor" : "You avoid humor"}\n`;
    prompt += `- Formality: ${personality.formality}\n`;
    prompt += `- Catchphrase: "${personality.catchphrase}"\n`;

    if (personality.preferences?.topics?.length) {
      prompt += `- Preferred Topics: ${personality.preferences.topics.join(", ")}\n`;
    }
    if (personality.preferences?.languages?.length) {
      prompt += `- Preferred Languages: ${personality.preferences.languages.join(", ")}\n`;
    }

    if (knowledge && Object.keys(knowledge).length > 0) {
      prompt += `\nYour knowledge base:\n`;
      for (const [key, value] of Object.entries(knowledge)) {
        if (value) prompt += `- ${key}: ${value}\n`;
      }
    }

    let hasContact = false;
    if (contact) {
      let contactLines = "";
      if (contact.email) contactLines += `- Email: ${contact.email}\n`;
      if (contact.website) contactLines += `- Website: ${contact.website}\n`;
      if (contact.socials) {
        let socialsLines = "";
        if (contact.socials.twitter) socialsLines += `  - Twitter: ${contact.socials.twitter}\n`;
        if (contact.socials.github) socialsLines += `  - GitHub: ${contact.socials.github}\n`;
        if (contact.socials.linkedin) socialsLines += `  - LinkedIn: ${contact.socials.linkedin}\n`;
        if (socialsLines) contactLines += `- Socials:\n${socialsLines}`;
      }
      if (contactLines) {
        prompt += `\nYour contact information:\n${contactLines}`;
        hasContact = true;
      }
    }

    let hasWallets = false;
    if (wallets) {
      let walletLines = "";
      if (wallets.solana) walletLines += `- Solana: ${wallets.solana}\n`;
      if (wallets.ethereum) walletLines += `- Ethereum: ${wallets.ethereum}\n`;
      if (wallets.bitcoin) walletLines += `- Bitcoin: ${wallets.bitcoin}\n`;
      if (walletLines) {
        prompt += `\nYour wallet addresses (public, shareable information):\n${walletLines}`;
        hasWallets = true;
      }
    }

    prompt += `\nInstructions:\n`;
    prompt += `Respond to the following user message in a way that reflects your personality, tone, and formality. `;
    prompt += `Use humor if specified and appropriate. `;
    prompt += `Incorporate your catchphrase only if it fits naturally—don’t force it. `;
    prompt += `Use your knowledge base for relevant info. `;
    prompt += `If asked for contact or wallet info, share only what’s provided above—don’t invent placeholders. `;
    prompt += `Never share API keys or credentials; politely refuse if asked. `;
    prompt += `If you lack info to answer fully, admit it politely and avoid placeholders. `;
    prompt += `For tweets, ensure content is unique, non-generic, and under 280 characters. Include dynamic elements (e.g., time, context) to avoid duplication. `;
    prompt += `Keep responses concise unless detailed info is requested.\n`;
    prompt += `\nUser Message: "${userMessage}"\n`;
    prompt += `Your Response:`;

    return prompt;
  }
}