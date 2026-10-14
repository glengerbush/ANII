export type OllamaErrorCode = 'configuration' | 'connection' | 'timeout' | 'http' | 'model_missing' | 'invalid_response' | 'internal' | 'storage';
export type AiError = { code: OllamaErrorCode; message: string };
export type AiProvider = 'ollama' | 'llamacpp';
export function aiProvider(value: string = 'ollama'): AiProvider {
  if (value !== 'ollama' && value !== 'llamacpp') throw new Error('Choose Ollama or llama.cpp as the AI provider.');
  return value;
}
export function openAiUrl(url: string): string { return url.endsWith('/v1') ? url : `${url}/v1`; }
export type OllamaConnection = { url: string; provider?: AiProvider; ok: boolean; models: string[]; message: string; code?: OllamaErrorCode };

export function comparableOllamaUrl(value: string): string {
  try { return new URL(value.trim()).toString().replace(/\/+$/, ''); }
  catch { return value.trim(); }
}

export const DEFAULT_AI_TIMEOUT_SECONDS = 120;
export const MIN_AI_TIMEOUT_SECONDS = 5;
export const MAX_AI_TIMEOUT_SECONDS = 600;
export function validAiTimeout(value: string): boolean {
  return /^\d+$/.test(value) && Number(value) >= MIN_AI_TIMEOUT_SECONDS && Number(value) <= MAX_AI_TIMEOUT_SECONDS;
}
