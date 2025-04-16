// src/utils/criteriaUtils.ts
import { Task } from '../types/task'; // Assuming Task might be needed elsewhere, keep import

// Interface for task criteria configuration
interface TaskCriteriaConfig {
    minLength: number;
    // Patterns that explicitly identify messages that should NOT be tasks
    nonTaskPatterns: RegExp;
    emojiOnlyPattern: RegExp;
    // Patterns that positively indicate a task
    imageGenerationPattern: RegExp;
    blockchainPattern: RegExp;
    mcpPattern: RegExp;
    apiCallPattern: RegExp;
    explicitCommandPattern: RegExp; // More specific commands
    // General indicators (use with caution, checked later)
    actionRequestQuestionPattern: RegExp;
}

// Default configuration for task criteria - Refined Patterns
const defaultTaskCriteriaConfig: TaskCriteriaConfig = {
    minLength: 3, // Keep short messages out unless very specific
    // Combined and expanded list of greetings, pleasantries, simple answers, bot questions
    nonTaskPatterns: /^(h(e|a)llo|hi|hey|yo|sup|howdy|ola)|(good morning|good afternoon|good evening)|(how are you|how's it going|how goes it|how do you do|what'?s up|u good\??)|(ok(ay)?|k|fine|good|great|cool|nice|awesome|perfect|sounds good|got it|i see|understood)|(y(es|eah|ep)?|no|nah|nope)|(lol|lmao|rofl|haha|hehe|xd)|(thanks|thank you|thx|ty|cheers)|(bye|goodbye|see ya|later)|(what is your name|what'?s your name|who are you|what are you|who made you|tell me about yourself)|(tell me a joke|say something funny)|(can you talk|are you there)|(please|kindly)$/i,
    emojiOnlyPattern: /^[\u{1F600}-\u{1F6FF}\u{1F300}-\u{1F5FF}\u{1F900}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\s]+$/u, // Emojis and whitespace only

    // --- Positive Task Indicators (more specific first) ---
    // Image Generation: Strong indicator
    imageGenerationPattern: /\b(generate|create|make|draw|produce|show me a picture of|an image of|a drawing of)\b.*\b(cat|dog|sunset|rainbow|sky|dragon|tree|unicorn|person|object|scene|art|image|picture|visual|logo|design|illustration|photo)\b/i,
    // Blockchain: Keywords for transactions
    blockchainPattern: /\b(send|transfer|transact|bridge|stake|unstake|delegate|undelegate)\b.*\b(sol|eth|btc|token|crypto|nft|lamports|gwei|satoshi|to address|wallet)\b|\b(0x[a-fA-F0-9]{40}|[1-9A-HJ-NP-Za-km-z]{32,44})\b/i, // Includes common address patterns
    // MCP Actions: Specific keywords
    mcpPattern: /\b(mcp|multi-chain protocol|run protocol|execute mcp)\b/i,
    // General API Calls: Fetching data etc.
    apiCallPattern: /\b(fetch|get|retrieve|pull|query|look up|find)\b.*\b(data|info|weather|stock|price|api|news|results|details)\b/i,
    // Explicit Commands: Verbs often starting commands, excluding simple chat verbs
    explicitCommandPattern: /^\s*(register|link|start|stop|help|info|search|delete|update|list|add|remove|set|reset|configure|sync|connect|disconnect|execute|run|deploy|build|compile)\b/i,

    // --- General Indicators (Checked last, broader match) ---
    // Action Verbs, Requests, Questions (potentially overlapping with chat, less reliable alone)
    // Excludes simple question starters if they are part of nonTaskPatterns
    // Requires more than just the indicator word itself (e.g. "tell me", not just "tell")
    actionRequestQuestionPattern: /\b(buy|sell|explain|tell me|show me|give me|check|compare|calculate|convert|summarize|translate|define|analyze|recommend)\b|^(can|could|will|would|should|may|might|do|does|did|is|are|was|were)\s+(you|i|we|they)\b|\b(what|when|where|why|how|who|which)\b.*\?/i,
};

/**
 * Determines if a message likely represents an actionable task based on defined criteria.
 * This focuses on filtering out simple chat before checking for task keywords.
 * @param text The message text to evaluate.
 * @param config Optional configuration to customize the criteria.
 * @returns True if the message seems like a task, false if it seems like simple chat/greeting.
 */
export function shouldSaveAsTask(
    text: string,
    // hasRecentTasks: boolean, // Parameter kept for potential future use, but not used in this logic
    config: TaskCriteriaConfig = defaultTaskCriteriaConfig
): boolean {
    const trimmedText = text.trim(); // Keep original case for some checks if needed, but use lower for patterns
    const lowerTrimmedText = trimmedText.toLowerCase();

    const {
        minLength,
        nonTaskPatterns,
        emojiOnlyPattern,
        imageGenerationPattern,
        blockchainPattern,
        mcpPattern,
        apiCallPattern,
        explicitCommandPattern,
        actionRequestQuestionPattern
    } = config;

    console.log(`shouldSaveAsTask evaluating: "${trimmedText}"`);

    // --- Step 1: Basic Filters (Definitely NOT a task) ---

    // Criterion 1: Minimum length
    if (trimmedText.length < minLength) {
        console.log(`-> Filtered: Message too short.`);
        return false;
    }

    // Criterion 2: Emoji only
    if (emojiOnlyPattern.test(trimmedText)) {
        console.log(`-> Filtered: Message is emoji-only.`);
        return false;
    }

    // Criterion 3: Matches common non-task patterns (greetings, thanks, simple answers, simple bot questions)
    // Test against the full pattern list designed to catch chat.
    if (nonTaskPatterns.test(lowerTrimmedText)) {
         // Double-check: ensure it doesn't ALSO contain a very strong task indicator
         // This prevents filtering out "thanks, now generate an image of a cat"
         const hasStrongTaskIndicator =
             imageGenerationPattern.test(lowerTrimmedText) ||
             blockchainPattern.test(lowerTrimmedText) ||
             mcpPattern.test(lowerTrimmedText) ||
             apiCallPattern.test(lowerTrimmedText) ||
             explicitCommandPattern.test(lowerTrimmedText); // Check explicit commands too

         if (!hasStrongTaskIndicator) {
             console.log(`-> Filtered: Message matches non-task pattern.`);
             return false;
         } else {
             console.log(`-> Info: Matched non-task pattern but also has strong task indicator, proceeding.`);
         }
    }


    // --- Step 2: Positive Task Indicators (Likely IS a task) ---
    // Check for specific, high-confidence task types first.

    // Criterion 4: Image Generation Request
    if (imageGenerationPattern.test(lowerTrimmedText)) {
        console.log(`-> Task Reason: Matches image generation pattern.`);
        return true;
    }

    // Criterion 5: Blockchain Transaction Request
    if (blockchainPattern.test(lowerTrimmedText)) {
        console.log(`-> Task Reason: Matches blockchain pattern.`);
        return true;
    }

    // Criterion 6: MCP Action Request
    if (mcpPattern.test(lowerTrimmedText)) {
        console.log(`-> Task Reason: Matches MCP pattern.`);
        return true;
    }

    // Criterion 7: General API Call Request
    if (apiCallPattern.test(lowerTrimmedText)) {
        console.log(`-> Task Reason: Matches API call pattern.`);
        return true;
    }

    // Criterion 8: Explicit Command Keyword at the start
    if (explicitCommandPattern.test(trimmedText)) { // Check original case potentially if commands are case-sensitive? Usually not. Use lowerTrimmedText if case-insensitive.
        console.log(`-> Task Reason: Matches explicit command pattern.`);
        return true;
    }

    // --- Step 3: General Indicators (Possibly a task, less certain) ---
    // Check for broader actions, requests, or non-trivial questions ONLY if not filtered out previously.

    // Criterion 9: Contains general action verbs, request phrases, or is a question not caught by nonTaskPatterns
    if (actionRequestQuestionPattern.test(lowerTrimmedText) || (trimmedText.includes('?') && trimmedText.length > 10)) { // Add length check for lone '?' or short questions
        console.log(`-> Task Reason: Matches general action/request/question pattern.`);
        // This is the category where "Tell me about dogs" or "What is the capital of France?" might land.
        // We are accepting these as potential tasks for the downstream classifier to handle.
        return true;
    }

    // --- Step 4: Default ---
    // If none of the above criteria were met, assume it's likely chat.
    console.log(`-> Filtered: Message does not meet any task criteria.`);
    return false;
}