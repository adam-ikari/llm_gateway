import type { SSEEvent } from '../types';

/**
 * Parse a ReadableStream<Uint8Array> of SSE bytes into individual SSEEvent objects.
 * Handles multi-line data fields, event types, and comments.
 */
export function parseSSEStream(upstream: ReadableStream<Uint8Array>): ReadableStream<SSEEvent> {
  const reader = upstream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  return new ReadableStream<SSEEvent>({
    async pull(controller) {
      while (true) {
        // Try to extract a complete event from the buffer
        const eventEnd = buffer.indexOf('\n\n');
        if (eventEnd !== -1) {
          const rawEvent = buffer.slice(0, eventEnd);
          buffer = buffer.slice(eventEnd + 2);
          const event = parseSingleEvent(rawEvent);
          if (event) {
            controller.enqueue(event);
            return;
          }
          continue; // Skip empty/comment-only events and try again
        }

        // Need more data
        const { value, done } = await reader.read();
        if (done) {
          // Process any remaining data in buffer
          if (buffer.trim()) {
            const event = parseSingleEvent(buffer);
            if (event) controller.enqueue(event);
          }
          controller.close();
          return;
        }
        buffer += decoder.decode(value, { stream: true });
      }
    },
    cancel() {
      reader.cancel();
    },
  });
}

function parseSingleEvent(raw: string): SSEEvent | null {
  const lines = raw.split('\n');
  let eventType: string | undefined;
  const dataLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith(':')) continue; // comment, skip
    if (line.startsWith('event:')) {
      eventType = line.slice(6).trim();
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trimStart()); // preserve leading space if present
    } else if (line.includes(':')) {
      // Unknown field, skip
    }
  }

  if (dataLines.length === 0) return null;
  return { event: eventType, data: dataLines.join('\n') };
}

/**
 * Serialize a ReadableStream<SSEEvent> into a ReadableStream<Uint8Array> of SSE bytes.
 */
export function serializeSSEStream(events: ReadableStream<SSEEvent>): ReadableStream<Uint8Array> {
  const reader = events.getReader();
  const encoder = new TextEncoder();

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { value, done } = await reader.read();
      if (done) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(serializeSingleEvent(value)));
    },
    cancel() {
      reader.cancel();
    },
  });
}

function serializeSingleEvent(event: SSEEvent): string {
  let out = '';
  if (event.event) {
    out += `event: ${event.event}\n`;
  }
  // Split data by newlines — each line gets its own data: prefix
  const dataLines = event.data.split('\n');
  for (const line of dataLines) {
    out += `data: ${line}\n`;
  }
  out += '\n';
  return out;
}

/**
 * Create a streaming Response with proper SSE headers.
 */
export function streamHeaders(): Record<string, string> {
  return {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  };
}
