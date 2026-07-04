import type { LlmProvider, LineGuess, GoalGuess } from './provider.js';
import { LINE_PROMPT, GOAL_PROMPT } from './prompts.js';

export class OllamaProvider implements LlmProvider {
  private baseUrl = process.env.OLLAMA_URL ?? 'http://localhost:11434';
  private model = process.env.OLLAMA_MODEL ?? 'gemma2:2b';

  private async generate(prompt: string): Promise<string> {
    const res = await fetch(`${this.baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.model, prompt, stream: false, format: 'json' }),
    });
    if (!res.ok) throw new Error(`ollama request failed: ${res.status}`);
    const data = (await res.json()) as { response: string };
    return data.response;
  }

  async resolveLine(line: string, unresolvedTokens: string[]): Promise<LineGuess> {
    const raw = await this.generate(LINE_PROMPT(line, unresolvedTokens));
    return JSON.parse(raw) as LineGuess;
  }

  async resolveGoal(text: string): Promise<GoalGuess> {
    const raw = await this.generate(GOAL_PROMPT(text));
    return JSON.parse(raw) as GoalGuess;
  }
}
