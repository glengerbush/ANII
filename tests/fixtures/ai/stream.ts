export function chatEvents(events: unknown[], split = 7) {
  const bytes = new TextEncoder().encode(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n');
  return new Response(new ReadableStream({start(controller) {
    for (let i = 0; i < bytes.length; i += split) controller.enqueue(bytes.slice(i, i + split));
    controller.close();
  }}), {headers: {'content-type': 'text/event-stream'}});
}
export function chatResponse(content: string) {
  return chatEvents([{choices: [{delta: {content}, finish_reason: 'stop'}]}]);
}
