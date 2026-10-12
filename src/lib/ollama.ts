export type OllamaErrorCode = 'configuration' | 'connection' | 'timeout' | 'http' | 'model_missing' | 'invalid_response' | 'internal' | 'storage';
export type AiError = { code: OllamaErrorCode; message: string };
export type OllamaConnection = { url: string; ok: boolean; models: string[]; message: string; code?: OllamaErrorCode };

export function comparableOllamaUrl(value: string): string {
  try { return new URL(value.trim()).toString().replace(/\/+$/, ''); }
  catch { return value.trim(); }
}
