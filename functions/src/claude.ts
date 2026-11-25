import Anthropic from '@anthropic-ai/sdk';
import { defineSecret, defineString } from 'firebase-functions/params';

export const anthropicApiKey = defineSecret('ANTHROPIC_API_KEY');
// Emulator tests point this at a fake, as MESHY_BASE_URL works for Meshy.
const anthropicBaseUrl = defineString('ANTHROPIC_BASE_URL', { default: 'https://api.anthropic.com' });

export type ClaudeRequest = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;

// Made on the first call in each instance, so the secret is read only when it's needed. One retry covers a brief 429 or
// 529, and the 30-second timeout keeps two attempts inside agentAssist's 90 seconds.
let client: Anthropic | undefined;
export function askClaude(params: ClaudeRequest) {
  client ??= new Anthropic({ apiKey: anthropicApiKey.value(), baseURL: anthropicBaseUrl.value(), timeout: 30_000, maxRetries: 1 });
  return client.beta.messages.create(params);
}
