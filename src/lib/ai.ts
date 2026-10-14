export type AiErrorCode = 'configuration' | 'connection' | 'timeout' | 'http' | 'model_missing' | 'invalid_response' | 'internal' | 'storage';
export type AiError = { code: AiErrorCode; message: string };
export function openAiUrl(url: string): string { return url.endsWith('/v1') ? url : `${url}/v1`; }
export type AiConnection = { url: string; ok: boolean; models: string[]; message: string; code?: AiErrorCode };

export function comparableAiUrl(value: string): string {
  try { return new URL(value.trim()).toString().replace(/\/+$/, ''); }
  catch { return value.trim(); }
}

export const DEFAULT_AI_TIMEOUT_SECONDS = 120;
export const MIN_AI_TIMEOUT_SECONDS = 5;
export const MAX_AI_TIMEOUT_SECONDS = 600;
export function validAiTimeout(value: string): boolean {
  return /^\d+$/.test(value) && Number(value) >= MIN_AI_TIMEOUT_SECONDS && Number(value) <= MAX_AI_TIMEOUT_SECONDS;
}
