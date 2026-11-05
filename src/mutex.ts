/**
 * Serialize mutating CLI calls. Parallel MCP tool calls must not double-submit
 * an order or race two cancels against the same position.
 */
let chain: Promise<void> = Promise.resolve();

export function serializeMutation<T>(task: () => Promise<T>): Promise<T> {
  const next = chain.then(task, task);
  chain = next.then(
    () => undefined,
    () => undefined
  );
  return next;
}
