// src/utils/criteriaUtils.ts
import { Task } from '../types/task';

// Interface for task criteria configuration
interface TaskCriteriaConfig {
  minLength?: number;
  nonsensePatterns?: RegExp;
  emojiOnlyPattern?: RegExp;
  commandKeywords?: RegExp;
  actionVerbs?: RegExp;
  questionIndicators?: RegExp;
  requestIndicators?: RegExp;
  trivialPatterns?: RegExp;
  imageGenerationPattern?: RegExp;
}

// Default configuration for task criteria
const defaultTaskCriteriaConfig: TaskCriteriaConfig = {
  minLength: 3,
  nonsensePatterns: /^(lol|haha|hi|hey|ok|k|yes|no|yeah|yep|nah|wtf|thanks|thx|cool|nice)$/i,
  emojiOnlyPattern: /^[\u{1F600}-\u{1F6FF}\s]+$/u,
  commandKeywords: /^(register|link|generate|fetch|get|start|stop|help|info|data|search|find|show|explain|create|delete|update|list|add|remove|set|reset|configure|sync|connect|disconnect)(\s|$)/i,
  actionVerbs: /(buy|fetch|get|generate|create|search|find|show|explain|tell|do|make|send|give|check|update|delete|add|remove|set|reset|configure|sync|connect|disconnect)/i,
  questionIndicators: /^(what|when|where|why|how|who|which|can|could|will|would|is|are|do|does|did|should|might|may)(\s|$)/i,
  requestIndicators: /(can you|could you|please|would you|kindly|help me|tell me|show me|give me|find me|fetch me|generate me)/i,
  trivialPatterns: /^(what is your name|what's your name|who are you|how are you|how's it going|are you ok|what's up|how do you feel|what do you do|who made you|what are you|hi there|hello there|good morning|good evening|howdy)(\s.*|$|\?)?$/i,
  // Modified: Added "rainbow cat" explicitly
  imageGenerationPattern: /(create|make|draw|generate)\b.*(cat|dog|sunset|rainbow|sky|dragon|tree|unicorn|picture|art|image|rainbow cat)/i,
};

/**
 * Determines if a message should be saved as a task based on defined criteria.
 * @param text The message text to evaluate.
 * @param hasRecentTasks Whether the user has recent tasks in memory (for contextual relevance).
 * @param config Optional configuration to customize the criteria.
 * @returns True if the message should be saved as a task, false otherwise.
 */
export function shouldSaveAsTask(
  text: string,
  hasRecentTasks: boolean,
  config: TaskCriteriaConfig = defaultTaskCriteriaConfig
): boolean {
  const trimmedText = text.trim().toLowerCase();
  const {
    minLength = 3,
    nonsensePatterns = defaultTaskCriteriaConfig.nonsensePatterns!,
    emojiOnlyPattern = defaultTaskCriteriaConfig.emojiOnlyPattern!,
    commandKeywords = defaultTaskCriteriaConfig.commandKeywords!,
    actionVerbs = defaultTaskCriteriaConfig.actionVerbs!,
    questionIndicators = defaultTaskCriteriaConfig.questionIndicators!,
    requestIndicators = defaultTaskCriteriaConfig.requestIndicators!,
    trivialPatterns = defaultTaskCriteriaConfig.trivialPatterns!,
    imageGenerationPattern = defaultTaskCriteriaConfig.imageGenerationPattern!,
  } = config;

  console.log(`shouldSaveAsTask evaluating: "${trimmedText}" (hasRecentTasks: ${hasRecentTasks})`);

  // Criterion 1: Minimum length
  if (trimmedText.length < minLength) {
    console.log(`Message too short: "${trimmedText}"`);
    return false;
  }

  // Criterion 2: Not nonsense or emoji-only
  if (nonsensePatterns.test(trimmedText) || emojiOnlyPattern.test(trimmedText)) {
    console.log(`Message is nonsense or emoji-only: "${trimmedText}"`);
    return false;
  }

  // Modified: Check image generation first
  const isImageGeneration = imageGenerationPattern.test(trimmedText);
  console.log(`Image generation check: ${isImageGeneration} for "${trimmedText}"`);
  if (isImageGeneration) {
    console.log(`Message matches image generation pattern, saving as task: "${trimmedText}"`);
    return true;
  }

  // Criterion 3: Not a trivial message
  const isTrivial = trivialPatterns.test(trimmedText);
  console.log(`Trivial check: ${isTrivial} for "${trimmedText}"`);
  if (isTrivial) {
    console.log(`Message is trivial: "${trimmedText}"`);
    return false;
  }

  // Criterion 4: Commands, actions, requests
  const isCommand = commandKeywords.test(trimmedText);
  const hasActionVerb = actionVerbs.test(trimmedText);
  const isRequest = requestIndicators.test(trimmedText);

  console.log(`Command check: ${isCommand}, Action verb: ${hasActionVerb}, Request: ${isRequest} for "${trimmedText}"`);

  if (isCommand) {
    console.log(`Message is a command, saving as task: "${trimmedText}"`);
    return true;
  }

  if (hasActionVerb) {
    console.log(`Message has action verb, saving as task: "${trimmedText}"`);
    return true;
  }

  if (isRequest) {
    console.log(`Message is a request, saving as task: "${trimmedText}"`);
    return true;
  }

  // Criterion 5: Non-trivial questions
  const isQuestion = questionIndicators.test(trimmedText) || trimmedText.endsWith('?');
  console.log(`Question check: ${isQuestion} for "${trimmedText}"`);
  if (isQuestion) {
    console.log(`Message is a non-trivial question, saving as task: "${trimmedText}"`);
    return true;
  }

  console.log(`Message does not meet task criteria: "${trimmedText}"`);
  return false;
}