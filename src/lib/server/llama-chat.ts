import type { EmitActivity } from '$lib/ai-stream';
import { openAiUrl } from '$lib/ollama';
import { OllamaError } from './ai';
import type { aiRequestOptions, ChatMessage, ToolCall } from './ollama-chat';

/** llama.cpp uses SSE and fragmented OpenAI tool calls, unlike Ollama's NDJSON. */
async function readEvents(response: Response, receive: (value: any) => void) {
  if (!response.body) throw new OllamaError('invalid_response', 'The AI server returned no stream.');
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let pending = '', data: string[] = [], ended = false;
  function line(value: string) {
    if (!value) {
      const event = data.join('\n'); data = [];
      if (event === '[DONE]') ended = true;
      else if (event) receive(JSON.parse(event));
    } else if (value.startsWith('data:')) data.push(value.slice(5).replace(/^ /, ''));
  }
  try {
    while (!ended) {
      const {value, done} = await reader.read();
      pending += decoder.decode(value, {stream: !done});
      if (pending.length + data.join('').length > 1_000_000) throw new OllamaError('invalid_response', 'The AI stream exceeded its size limit.');
      let newline: number;
      while (!ended && (newline = pending.indexOf('\n')) >= 0) {
        line(pending.slice(0, newline).replace(/\r$/, '')); pending = pending.slice(newline + 1);
      }
      if (done) { if (pending) line(pending.replace(/\r$/, '')); line(''); break; }
    }
    if (!ended) throw new OllamaError('invalid_response', 'The AI stream ended before completion. Retry your saved message.');
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

export async function llamaChat(messages: ChatMessage[], options: ReturnType<typeof aiRequestOptions>, emit: EmitActivity, extra: {tools?: unknown[]; format?: object}): Promise<ChatMessage> {
  const wireMessages = messages.map(({role, content, thinking, tool_calls, tool_call_id}) => ({
    role, content,
    ...(thinking ? {reasoning_content: thinking} : {}),
    ...(tool_call_id ? {tool_call_id} : {}),
    ...(tool_calls ? {tool_calls: tool_calls.map(call => ({id: call.id, type: 'function', function: {
      name: call.function.name, arguments: typeof call.function.arguments === 'string' ? call.function.arguments : JSON.stringify(call.function.arguments)
    }}))} : {})
  }));
  const response = await fetch(`${openAiUrl(options.url)}/chat/completions`, {
    method: 'POST', headers: {'content-type': 'application/json'}, signal: options.signal,
    body: JSON.stringify({model: options.settings.model, messages: wireMessages, stream: true,
      temperature: 0, seed: 42, cache_prompt: false,
      ...(extra.tools ? {tools: extra.tools} : {}),
      ...(extra.format ? {response_format: {type: 'json_schema', json_schema: {name: 'anii_response', schema: extra.format}}} : {})})
  });
  if (!response.ok) {
    let detail = '';
    try { const body = await response.json(); detail = String(body.error?.message ?? body.error ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 400); } catch {}
    throw new OllamaError('http', `llama.cpp returned HTTP ${response.status}${detail ? `: ${detail}` : '. Check the server address and logs.'}`);
  }
  let content = '', thinking = '', finished = false, size = 0;
  const calls = new Map<number, ToolCall>();
  await readEvents(response, chunk => {
    if (chunk.error) throw new OllamaError('invalid_response', `llama.cpp stopped: ${String(chunk.error.message ?? chunk.error).slice(0, 400)}`);
    const choice = chunk.choices?.[0];
    if (!choice) return; // Usage-only event.
    const delta = choice.delta ?? {};
    if (typeof delta.content === 'string') {
      if (!content && delta.content) emit({type: 'status', message: 'AI is preparing its response…'});
      content += delta.content; size += delta.content.length;
    }
    if (typeof delta.reasoning_content === 'string') {
      thinking += delta.reasoning_content; size += delta.reasoning_content.length;
      emit({type: 'thinking', text: delta.reasoning_content});
    }
    for (const fragment of delta.tool_calls ?? []) {
      if (!Number.isInteger(fragment.index) || fragment.index < 0 || fragment.index > 7) throw new OllamaError('invalid_response', 'The model returned an invalid tool call index.');
      const call = calls.get(fragment.index) ?? {id: '', function: {name: '', arguments: ''}};
      if (fragment.id) { call.id = fragment.id; size += String(fragment.id).length; }
      for (const key of ['name', 'arguments'] as const) if (typeof fragment.function?.[key] === 'string') {
        call.function[key] += fragment.function[key]; size += fragment.function[key].length;
      }
      calls.set(fragment.index, call);
    }
    if (size > 60_000) throw new OllamaError('invalid_response', 'The model exceeded the response limit. Try a narrower request.');
    if (choice.finish_reason != null) {
      if (!['stop', 'tool_calls'].includes(choice.finish_reason)) throw new OllamaError('invalid_response', 'The AI response was cut short. Try a narrower request or increase the server token limit.');
      finished = true;
    }
  });
  if (!finished) throw new OllamaError('invalid_response', 'llama.cpp did not finish its response. Retry your saved message.');
  const tool_calls = [...calls.entries()].sort(([a], [b]) => a - b).map(([, call]) => call);
  if (tool_calls.some(call => !call.id || !call.function.name) || new Set(tool_calls.map(call => call.id)).size !== tool_calls.length) throw new OllamaError('invalid_response', 'The model returned incomplete or duplicate tool calls.');
  return {role: 'assistant', content, ...(thinking ? {thinking} : {}), ...(tool_calls.length ? {tool_calls} : {})};
}
