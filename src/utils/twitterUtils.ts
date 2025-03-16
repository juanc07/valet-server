import { Agent } from "../types/agent";
import { TWITTER_API_MODE, TWITTER_APP_KEY, TWITTER_APP_SECRET, TWITTER_INTEGRATION } from "../config";

export function hasValidTwitterCredentials(agent: Agent): boolean {
  // Base checks that always apply
  const hasValidHandle = typeof agent.twitterHandle === "string" && agent.twitterHandle.trim() !== "";
  const hasValidAccessToken = typeof agent.twitterAccessToken === "string" && agent.twitterAccessToken.trim() !== "";
  const hasValidAccessSecret = typeof agent.twitterAccessSecret === "string" && agent.twitterAccessSecret.trim() !== "";

  if (TWITTER_API_MODE === "paid") {
    // In paid mode, only check handle and access credentials since app credentials come from config
    if (TWITTER_INTEGRATION === "advance") {
      const hasValidAppKey = typeof agent.twitterAppKey === "string" && agent.twitterAppKey.trim() !== "";
      const hasValidAppSecret = typeof agent.twitterAppSecret === "string" && agent.twitterAppSecret.trim() !== "";

      return hasValidHandle && hasValidAppKey && hasValidAppSecret && hasValidAccessToken && hasValidAccessSecret;
    } else {
      const hasValidConfigCredentials =
        typeof TWITTER_APP_KEY === "string" && TWITTER_APP_KEY.trim() !== "" &&
        typeof TWITTER_APP_SECRET === "string" && TWITTER_APP_SECRET.trim() !== "";

      return hasValidHandle && hasValidAccessToken && hasValidAccessSecret && hasValidConfigCredentials;
    }
  } else {
    // In free mode or other modes, check all agent credentials
    const hasValidAppKey = typeof agent.twitterAppKey === "string" && agent.twitterAppKey.trim() !== "";
    const hasValidAppSecret = typeof agent.twitterAppSecret === "string" && agent.twitterAppSecret.trim() !== "";

    return hasValidHandle && hasValidAppKey && hasValidAppSecret && hasValidAccessToken && hasValidAccessSecret;
  }
}