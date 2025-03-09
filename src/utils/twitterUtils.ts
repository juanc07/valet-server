import { Agent } from "../types/agent";

export function hasValidTwitterCredentials(agent: Agent): boolean {
  return (
    typeof agent.twitterHandle === "string" && agent.twitterHandle.trim() !== "" &&
    typeof agent.twitterAppKey === "string" && agent.twitterAppKey.trim() !== "" &&
    typeof agent.twitterAppSecret === "string" && agent.twitterAppSecret.trim() !== "" &&
    typeof agent.twitterAccessToken === "string" && agent.twitterAccessToken.trim() !== "" &&
    typeof agent.twitterAccessSecret === "string" && agent.twitterAccessSecret.trim() !== ""
  );
}