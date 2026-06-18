import { describe, it, expect } from 'vitest';
import { parseSSEStream, serializeSSEStream, streamHeaders } from '../../utils/sse';
import type { SSEEvent } from '../../types';

async function collectStream<T>(stream: ReadableStream<T>): Promise<T[]> {
  const reader = stream.getReader();
  const items: T[] = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    items.push(value);
  }
  return items;
}

function toByteStream(text: string): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });
}

describe('parseSSEStream', () => {
  it('parses single event correctly', async () => {
    const input = 'data: hello world\n\n';
    const stream = parseSSEStream(toByteStream(input));
    const events = await collectStream(stream);
    expect(events).toEqual([{ data: 'hello world' }]);
  });

  it('parses event with event type', async () => {
    const input = 'event: message\ndata: hello\n\n';
    const stream = parseSSEStream(toByteStream(input));
    const events = await collectStream(stream);
    expect(events).toEqual([{ event: 'message', data: 'hello' }]);
  });

  it('handles multi-line data fields', async () => {
    const input = 'data: line1\ndata: line2\n\n';
    const stream = parseSSEStream(toByteStream(input));
    const events = await collectStream(stream);
    expect(events).toEqual([{ data: 'line1\nline2' }]);
  });

  it('skips comments (lines starting with :)', async () => {
    const input = ': this is a comment\ndata: hello\n\n';
    const stream = parseSSEStream(toByteStream(input));
    const events = await collectStream(stream);
    expect(events).toEqual([{ data: 'hello' }]);
  });

  it('handles \\r\\n line endings', async () => {
    const input = 'data: hello\r\n\r\n';
    const stream = parseSSEStream(toByteStream(input));
    const events = await collectStream(stream);
    expect(events).toEqual([{ data: 'hello' }]);
  });

  it('handles multiple events in sequence', async () => {
    const input = 'data: first\n\ndata: second\n\n';
    const stream = parseSSEStream(toByteStream(input));
    const events = await collectStream(stream);
    expect(events).toEqual([{ data: 'first' }, { data: 'second' }]);
  });
});

describe('serializeSSEStream', () => {
  it('serializes event with data', async () => {
    const events: SSEEvent[] = [{ data: 'hello' }];
    const input = new ReadableStream<SSEEvent>({
      start(controller) {
        for (const e of events) controller.enqueue(e);
        controller.close();
      },
    });
    const stream = serializeSSEStream(input);
    const chunks = await collectStream(stream);
    const text = chunks.map((c) => new TextDecoder().decode(c)).join('');
    expect(text).toBe('data: hello\n\n');
  });

  it('serializes event with event type', async () => {
    const events: SSEEvent[] = [{ event: 'message', data: 'hello' }];
    const input = new ReadableStream<SSEEvent>({
      start(controller) {
        for (const e of events) controller.enqueue(e);
        controller.close();
      },
    });
    const stream = serializeSSEStream(input);
    const chunks = await collectStream(stream);
    const text = chunks.map((c) => new TextDecoder().decode(c)).join('');
    expect(text).toBe('event: message\ndata: hello\n\n');
  });

  it('multi-line data gets separate data: lines', async () => {
    const events: SSEEvent[] = [{ data: 'line1\nline2' }];
    const input = new ReadableStream<SSEEvent>({
      start(controller) {
        for (const e of events) controller.enqueue(e);
        controller.close();
      },
    });
    const stream = serializeSSEStream(input);
    const chunks = await collectStream(stream);
    const text = chunks.map((c) => new TextDecoder().decode(c)).join('');
    expect(text).toBe('data: line1\ndata: line2\n\n');
  });
});

describe('streamHeaders', () => {
  it('returns correct headers', () => {
    const headers = streamHeaders();
    expect(headers['Content-Type']).toBe('text/event-stream');
    expect(headers['Cache-Control']).toBe('no-cache');
    expect(headers['Connection']).toBe('keep-alive');
  });
});
