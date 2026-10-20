import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

const invocation = new AsyncLocalStorage();
export function bindInvoke(params, operation) {
  const invokeId = params.context?.invoke_id ?? params.invoke_id;
  return invocation.run(typeof invokeId === "string" ? invokeId : null, operation);
}

// Keep reading stdin while an invoke waits for a reverse-RPC response.
// AsyncLocalStorage associates concurrent reverse RPCs with their own invoke.
export function createHostRpc(writeFrame, timeoutMs = 60_000) {
  const pending = new Map();
  function rpc(method, params) {
    const id = `tutorial-${randomUUID()}`;
    const invokeId = invocation.getStore();
    const context = invokeId ? { context: { invoke_id: invokeId } } : {};
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(Object.assign(new Error(`${method} timed out; verify the remote state before retrying a write.`), { code: -32030 }));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      try { writeFrame({ jsonrpc: "2.0", id, method, params: { ...params, ...context } }); }
      catch (error) { clearTimeout(timer); pending.delete(id); reject(error); }
    });
  }
  function receive(frame) {
    const request = pending.get(frame.id);
    if (!request) return;
    pending.delete(frame.id);
    clearTimeout(request.timer);
    if (frame.error) request.reject(Object.assign(new Error(frame.error.message || "Host RPC failed"), { code: frame.error.code }));
    else request.resolve(frame.result);
  }
  return { rpc, receive };
}
