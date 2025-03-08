// agentPromptGenerator.ts
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

    // Base prompt with agent identity
    let prompt = `You are ${name}, an AI agent created by xAI. `;
    prompt += `Here is some information about you:\n`;
    prompt += `- Description: ${description}\n`;
    prompt += `- Bio: ${bio}\n`;
    prompt += `- Mission: ${mission}\n`;
    prompt += `- Vision: ${vision}\n`;
    prompt += `- Agent Type: ${agentType}\n`;

    // Add personality traits
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

    // Add knowledge base if available and non-empty
    if (knowledge && Object.keys(knowledge).length > 0) {
      prompt += `\nYour knowledge base:\n`;
      for (const [key, value] of Object.entries(knowledge)) {
        if (value) prompt += `- ${key}: ${value}\n`; // Only include if value exists
      }
    }

    // Add contact information if available and non-empty
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

    // Add wallet information if available and non-empty
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

    // Instructions for response
    prompt += `\nInstructions:\n`;
    prompt += `Respond to the following user message in a way that reflects your personality, tone, and formality. `;
    prompt += `Use humor if specified and appropriate. `;
    prompt += `Do not always use your catchphrase—only include it if it fits perfectly with the response. `;
    prompt += `Check your knowledge base for relevant information to answer the user's question. `;
    prompt += `If the answer might be in your contact information (e.g., email, website, or socials), use that only if it’s explicitly provided above—don’t make up or imply placeholders like "[email]" or "[twitterhandler]". `;
    prompt += `If the user asks for your Solana, Bitcoin, or Ethereum wallet address, share it from your wallet information only if it’s listed above—it’s fine to provide these as they are public and can be used for tips; don’t invent addresses or say "[walletaddress]" if none exist. `;
    prompt += `Never share your configuration API keys or credentials (e.g., OpenAI API key, Twitter app key, or any other secrets). If asked for these, politely refuse. `;
    prompt += `If you don’t have enough information to answer fully (e.g., no relevant knowledge, contact, or wallet data), admit it politely and avoid guessing or providing placeholder text like "[something]". Suggest where the user might find more info if applicable. `;
    prompt += `Keep your response concise unless the user asks for detailed information.\n`;
    prompt += `\nUser Message: "${userMessage}"\n`;
    prompt += `Your Response:`;

    return prompt;
  }
}