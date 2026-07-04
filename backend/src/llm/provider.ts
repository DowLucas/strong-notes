import { OllamaProvider } from './ollamaProvider.js';
import { AnthropicProvider } from './anthropicProvider.js';

export type LineGuess = {
  exerciseName: string;
  equipment?: string;
  weightKg?: number;
  reps?: number;
  sets?: number;
};

export type GoalGuess = {
  type: 'HYPERTROPHY' | 'STRENGTH' | 'ENDURANCE' | 'CUSTOM';
  muscles: string[];
};

export interface LlmProvider {
  resolveLine(line: string, unresolvedTokens: string[]): Promise<LineGuess>;
  resolveGoal(text: string): Promise<GoalGuess>;
}

export function getLlmProvider(): LlmProvider {
  const provider = process.env.LLM_PROVIDER;
  if (provider === 'ollama') {
    return new OllamaProvider();
  }
  if (provider === 'anthropic') {
    return new AnthropicProvider();
  }
  throw new Error(`unknown LLM_PROVIDER: ${provider}`);
}
