import type { LlmProvider, LineGuess, GoalGuess } from './provider.js';

const LINE_PROMPT = (line: string, unresolved: string[]) => `You are a gym-log parser. Given this logged line: "${line}"
The unrecognized tokens are: ${unresolved.join(', ')}.
Respond ONLY with JSON: {"exerciseName": string, "equipment": string|null, "weightKg": number|null, "reps": number|null, "sets": number|null}`;

const GOAL_PROMPT = (text: string) => `You are a fitness goal classifier. Given this goal description: "${text}"
Respond ONLY with JSON: {"type": "HYPERTROPHY"|"STRENGTH"|"ENDURANCE"|"CUSTOM", "muscles": string[]} where muscles are from
["GLUTES","QUADS","HAMSTRINGS","CHEST","BACK","SHOULDERS","ARMS","CORE","CALVES"].`;

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
