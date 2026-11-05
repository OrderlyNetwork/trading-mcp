import { describe, expect, it } from 'vitest';
import { serializeMutation } from '../src/mutex.js';

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

describe('serializeMutation', () => {
  it('runs mutating tasks one at a time, in submission order', async () => {
    const events: string[] = [];
    const first = serializeMutation(async () => {
      events.push('first-start');
      await sleep(40);
      events.push('first-end');
    });
    const second = serializeMutation(async () => {
      events.push('second-start');
      await sleep(5);
      events.push('second-end');
    });
    await Promise.all([first, second]);
    expect(events).toEqual([
      'first-start',
      'first-end',
      'second-start',
      'second-end',
    ]);
  });

  it('keeps the queue alive after a failure', async () => {
    await expect(
      serializeMutation(async () => {
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');
    await expect(serializeMutation(async () => 'ok')).resolves.toBe('ok');
  });
});
