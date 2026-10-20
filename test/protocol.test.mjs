import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

test("real stdio: v2 negotiation, manifests, concurrent reverse-RPC routing and host errors", { timeout: 10_000 }, async t => {
  const child = spawn(process.execPath, [new URL("../executas/report-store/plugin.js", import.meta.url).pathname], { stdio: ["pipe", "pipe", "pipe"] });
  t.after(() => child.kill());
  const waiting = new Map();
  const reverse = [];
  let sequence = 0;
  const send = frame => child.stdin.write(`${JSON.stringify(frame)}\n`);
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence; waiting.set(id, { resolve, reject }); send({ jsonrpc: "2.0", id, method, params });
  });
  child.on("error", error => { for (const request of waiting.values()) request.reject(error); });
  createInterface({ input: child.stdout }).on("line", line => {
    const frame = JSON.parse(line);
    if (frame.method) {
      reverse.push(frame);
      // Respond to the second request first: a blocked stdin loop would deadlock.
      if (reverse.length === 2) {
        for (const request of [...reverse].reverse()) {
          const failure = request.params.context.invoke_id === "call-b";
          send({ jsonrpc: "2.0", id: request.id, ...(failure
            ? { error: { code: -32021, message: "not_granted" } }
            : { result: { items: [], next_cursor: null } }) });
        }
      }
    } else { waiting.get(frame.id)?.resolve(frame); waiting.delete(frame.id); }
  });
  const initialized = await call("initialize", { protocolVersion: "2.0" });
  assert.equal(initialized.result.protocolVersion, "2.0");
  assert.deepEqual(initialized.result.capabilities.storage, {});
  const described = await call("describe");
  assert.deepEqual(described.result.host_capabilities, ["aps.files", "host.upload"]);
  const results = await Promise.all([
    call("invoke", { tool: "list_reports", arguments: {}, context: { invoke_id: "call-a" } }),
    call("invoke", { tool: "list_reports", arguments: {}, context: { invoke_id: "call-b" } }),
  ]);
  assert.equal(results[0].result.success, true);
  assert.equal(results[1].error.code, -32021);
  assert.deepEqual(reverse.map(frame => frame.params.context.invoke_id), ["call-a", "call-b"]);
  assert.ok(reverse.every(frame => frame.params.scope === "user" && frame.method === "files/list"));
});
