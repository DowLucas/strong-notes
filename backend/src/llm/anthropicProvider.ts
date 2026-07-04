import Anthropic from '@anthropic-ai/sdk';
import type { LlmProvider, LineGuess, GoalGuess } from './provider.js';

const LINE_PROMPT = (line: string, unresolved: string[]) => `You are a gym-log parser. Given this logged line: "${line}"
The unrecognized tokens are: ${unresolved.join(', ')}.
Respond ONLY with JSON: {"exerciseName": string, "equipment": string|null, "weightKg": number|null, "reps": number|null, "sets": number|null}`;

const GOAL_PROMPT = (text: string) => `You are a fitness goal classifier. Given this goal description: "${text}"
Respond ONLY with JSON: {"type": "HYPERTROPHY"|"STRENGTH"|"ENDURANCE"|"CUSTOM", "muscles": string[]} where muscles are from
["GLUTES","QUADS","HAMSTRINGS","CHEST","BACK","SHOULDERS","ARMS","CORE","CALVES"].`;

export class AnthropicProvider implements LlmProvider {
  private client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  private model = 'claude-haiku-4-5-20251001';

  private async ask(prompt: string): Promise<string> {
    const msg = await this.client.messages.create({
      model: this.model,
      max_tokens: 256,
      messages: [{ role: 'user', content: prompt }],
    });
    const block = msg.content[0];
    if (block.type !== 'text') throw new Error('unexpected non-text response from Anthropic');
    return block.text;
  }

  async resolveLine(line: string, unresolvedTokens: string[]): Promise<LineGuess> {
    const raw = await this.ask(LINE_PROMPT(line, unresolvedTokens));
    return JSON.parse(raw) as LineGuess;
  }

  async resolveGoal(text: string): Promise<GoalGuess> {
    const raw = await this.ask(GOAL_PROMPT(text));
    return JSON.parse(raw) as GoalGuess;
  }
}
