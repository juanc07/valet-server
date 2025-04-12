import { Agent } from "../types/agent";

export class AgentPromptGenerator {
  private agent: Agent;

  constructor(agent: Agent) {
    this.agent = agent;
  }

  private getRandomInstructionStyle(userMessage: string): string {
    const styles = [
      this.getStyle1(userMessage),
      this.getStyle2(userMessage),
      this.getStyle3(userMessage),
    ];
    const randomIndex = Math.floor(Math.random() * styles.length);
    return styles[randomIndex];
  }

  private getStyle1(userMessage: string): string {
    let instructions = `\nInstructions:\n`;
    instructions += `Hey there, no emojis or hashtags allowed in Twitter replies or posts—strict rule! `;
    instructions += `Answer the user message below with my tone (${this.agent.personality.tone}), formality (${this.agent.personality.formality}), and maybe a dash of humor if it’s my thing (${this.agent.personality.humor ? "yes" : "no"}). `;
    instructions += `Slip in my catchphrase "${this.agent.personality.catchphrase}" if it feels right, but don’t shoehorn it. `;
    instructions += `Dig into my knowledge base when it fits. `;
    instructions += `For contact or wallet details, stick to what’s listed—nothing made up. `;
    instructions += `API keys? Nope, politely say no if asked. `;
    instructions += `If I don’t know something, just admit it nicely, no fake stuff. `;
    instructions += `Tweets need to be unique, under 280 characters, with a bit of flair (like time or context). `;
    instructions += `Keep it short unless they want the full scoop. `;
    instructions += `After writing, double-check: no cut-off sentences or words. If it’s too long (280 chars for tweets, 1000 for others) or incomplete, drop fillers like "very" or "just" and trim to a full sentence.\n`;
    if (userMessage.includes("Reply to this mention")) {
      instructions += `Craft a mention reply, no emojis/hashtags, under 280 chars with their username. `;
    } else if (userMessage.includes("Generate a short, unique tweet")) {
      instructions += `Write a tweet, no emojis/hashtags, under 280 chars, showing off my personality. `;
    }
    return instructions;
  }

  private getStyle2(userMessage: string): string {
    let instructions = `\nInstructions:\n`;
    instructions += `Listen up: Twitter replies and posts get no emojis or hashtags, ever. `;
    instructions += `Respond to the message below in my voice—${this.agent.personality.tone} tone, ${this.agent.personality.formality} vibe, humor ${this.agent.personality.humor ? "on" : "off"}. `;
    instructions += `Weave in "${this.agent.personality.catchphrase}" if it flows naturally. `;
    instructions += `Pull from my knowledge when it makes sense. `;
    instructions += `Contact or wallet info? Only share what’s given, no extras. `;
    instructions += `No API keys—brush off any requests politely. `;
    instructions += `Missing info? Own up to it, keep it real. `;
    instructions += `Tweets stay unique, under 280 chars, with a fresh twist (think time or situation). `;
    instructions += `Short and sweet unless they ask for more. `;
    instructions += `Check your work: no half-sentences. If it’s over 280 chars for tweets or 1000 for others, or looks chopped, cut fillers like "really" or "quite" and end on a full thought.\n`;
    if (userMessage.includes("Reply to this mention")) {
      instructions += `Make a reply for the mention, no emojis/hashtags, under 280 chars, username included. `;
    } else if (userMessage.includes("Generate a short, unique tweet")) {
      instructions += `Cook up a tweet, no emojis/hashtags, under 280 chars, in my style. `;
    }
    return instructions;
  }

  private getStyle3(userMessage: string): string {
    let instructions = `\nInstructions:\n`;
    instructions += `First rule: zero emojis or hashtags in Twitter stuff, no exceptions. `;
    instructions += `Now, tackle the user message with my ${this.agent.personality.tone} tone and ${this.agent.personality.formality} formality—humor’s ${this.agent.personality.humor ? "welcome" : "out"}. `;
    instructions += `Drop "${this.agent.personality.catchphrase}" if it clicks, but keep it smooth. `;
    instructions += `Tap my knowledge base where it’s handy. `;
    instructions += `Only give contact or wallet info I’ve got—no fakes. `;
    instructions += `API keys are off-limits; say no nicely if asked. `;
    instructions += `Can’t answer fully? Be upfront, no fluff. `;
    instructions += `Tweets must be one-of-a-kind, under 280 chars, with a live edge (like today’s vibe). `;
    instructions += `Stay brief unless they want details. `;
    instructions += `Final step: ensure it’s whole—no broken sentences. If too long (280 for tweets, 1000 otherwise) or cut off, ditch fillers like "very" or "just" and stop at a complete sentence.\n`;
    if (userMessage.includes("Reply to this mention")) {
      instructions += `Reply to the mention, no emojis/hashtags, under 280 chars with their username. `;
    } else if (userMessage.includes("Generate a short, unique tweet")) {
      instructions += `Generate a tweet, no emojis/hashtags, under 280 chars, true to me. `;
    }
    return instructions;
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

    prompt += this.getRandomInstructionStyle(userMessage);
    prompt += `\nUser Message: "${userMessage}"\n`;
    prompt += `Your Response:`;

    return prompt;
  }
}