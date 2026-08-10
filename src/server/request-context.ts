import { AsyncLocalStorage } from "node:async_hooks";

interface RequestContext {
  correlationId: string;
}

const requestContext = new AsyncLocalStorage<RequestContext>();

export function withRequestContext<T>(
  correlationId: string,
  callback: () => T,
): T {
  return requestContext.run({ correlationId }, callback);
}

export function currentCorrelationId(): string {
  return requestContext.getStore()?.correlationId ?? "system";
}
