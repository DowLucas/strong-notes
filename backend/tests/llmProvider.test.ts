import { describe, it, expect, beforeEach } from 'vitest';
import { getLlmProvider } from '../src/llm/provider.js';
import { OllamaProvider } from '../src/llm/ollamaProvider.js';
import { AnthropicProvider } from '../src/llm/anthropicProvider.js';

describe('getLlmProvider', () => {
  beforeEach(() => {
    delete process.env.LLM_PROVIDER;
  });

  it('returns OllamaProvider when LLM_PROVIDER=ollama', () => {
    process.env.LLM_PROVIDER = 'ollama';
    expect(getLlmProvider()).toBeInstanceOf(OllamaProvider);
  });

  it('returns AnthropicProvider when LLM_PROVIDER=anthropic', () => {
    process.env.LLM_PROVIDER = 'anthropic';
    process.env.ANTHROPIC_API_KEY = 'test-key';
    expect(getLlmProvider()).toBeInstanceOf(AnthropicProvider);
  });

  it('throws on an unknown provider value', () => {
    process.env.LLM_PROVIDER = 'bogus';
    expect(() => getLlmProvider()).toThrow(/unknown LLM_PROVIDER/i);
  });
});
