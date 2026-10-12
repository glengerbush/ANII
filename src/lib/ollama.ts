export type OllamaErrorCode = 'configuration' | 'connection' | 'timeout' | 'http' | 'model_missing' | 'invalid_response' | 'internal' | 'storage';
export type AiError = { code: OllamaErrorCode; message: string };
export type OllamaConnection = { url: string; ok: boolean; models: string[]; message: string; code?: OllamaErrorCode };

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
