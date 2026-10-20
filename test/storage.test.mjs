import assert from "node:assert/strict";
import test from "node:test";
import { saveReport, reportBytes, listReports, getReportUrl, deleteReport, temporaryReport } from "../executas/report-store/storage.js";
import { listAllReports, redact } from "../src/workflows.js";

const input = { title: "Test report", body: "Notes from a café ☕. Count UTF-8 bytes, including accents and emoji." };
const path = "aps-tutorial/reports/2026-10-20-example.md";

test("APS upload: direct PUT, signed headers, UTF-8 size, complete before exposing the reference", async () => {
  const events = [];
  let actualPath;
  const rpc = async (method, args) => {
    events.push(method);
    assert.equal(args.scope, "user");
    if (method === "files/upload_begin") {
      actualPath = args.path;
      assert.ok(actualPath.startsWith("aps-tutorial/reports/"));
      assert.equal(args.size_bytes, reportBytes(input).length);
      return { put_url: "https://objects.example/put", headers: { "Content-Type": "text/markdown", "x-signed": "keep" } };
    }
    assert.equal(method, "files/upload_complete");
    assert.equal(args.path, actualPath);
    assert.equal(args.etag, "r2-etag");
    return { etag: "canonical-aps-etag", size_bytes: reportBytes(input).length };
  };
  const fetchImpl = async (url, options) => {
    events.push("PUT");
    assert.equal(url, "https://objects.example/put");
    assert.equal(options.method, "PUT");
    assert.deepEqual(options.headers, { "Content-Type": "text/markdown", "x-signed": "keep" });
    assert.deepEqual(options.body, reportBytes(input));
    return new Response(null, { status: 200, headers: { etag: "r2-etag" } });
  };
  const result = await saveReport(rpc, input, fetchImpl);
  assert.deepEqual(events, ["files/upload_begin", "PUT", "files/upload_complete"]);
  assert.equal(result.etag, "canonical-aps-etag");
  assert.equal(result.path, actualPath);
  assert.equal(result.scope, "user");
  assert.ok(!JSON.stringify(result).includes("https://"));
});

test("failed PUT is never finalized; quota failure never starts a PUT", async () => {
  const calls = [];
  const rpc = async method => { calls.push(method); return { put_url: "https://objects.example/put", headers: {} }; };
  await assert.rejects(saveReport(rpc, input, async () => new Response(null, { status: 403 })), /HTTP 403/);
  assert.deepEqual(calls, ["files/upload_begin"]);
  let uploaded = false;
  await assert.rejects(saveReport(async () => { throw new Error("quota_exceeded"); }, input,
    async () => { uploaded = true; }), /quota_exceeded/);
  assert.equal(uploaded, false);
});

test("unique uploads do not overwrite earlier reports", async () => {
  const rpc = async method => method === "files/upload_begin"
    ? { put_url: "https://objects.example/put" } : { etag: "v1" };
  const send = async () => new Response(null, { status: 200 });
  const first = await saveReport(rpc, input, send);
  const second = await saveReport(rpc, input, send);
  assert.notEqual(first.path, second.path);
});

test("invalid report content fails before any host call", async () => {
  let calls = 0;
  for (const bad of [{ ...input, title: "\n" }, { ...input, body: "" }, { ...input, body: "📄".repeat(3073) }]) {
    await assert.rejects(saveReport(async () => { calls++; }, bad));
  }
  assert.equal(calls, 0);
});

test("listing is scoped and bounded; malformed responses cannot masquerade as an empty directory", async () => {
  await listReports(async (method, args) => {
    assert.equal(method, "files/list");
    assert.deepEqual(args, { scope: "user", prefix: "aps-tutorial/reports/", limit: 20, cursor: "page-2" });
    return { items: [{ path, etag: "v1", size_bytes: 20 }], next_cursor: null };
  }, { cursor: "page-2" });
  await assert.rejects(listReports(async () => ({})), /APS list response/);
  await assert.rejects(listReports(async () => ({ items: [{ path: "private/notes.md" }] })), /Only Markdown reports/);
});

test("all pages are read and repeated cursors are rejected", async () => {
  const calls = [];
  const result = await listAllReports(async (method, args) => {
    calls.push(args);
    return args.cursor ? { items: [{ path: "second" }], next_cursor: null }
      : { items: [{ path: "first" }], next_cursor: "page-2" };
  });
  assert.deepEqual(calls, [{}, { cursor: "page-2" }]);
  assert.equal(result.length, 2);
  await assert.rejects(listAllReports(async () => ({ items: [], next_cursor: "same" })), /repeated/);
});

test("fresh URLs use the original scope and path; traversal never reaches the host", async () => {
  const result = await getReportUrl(async (method, args) => {
    assert.equal(method, "files/download_url");
    assert.deepEqual(args, { scope: "user", path, ttl_seconds: 300 });
    return { get_url: "https://objects.example/get", expires_at: "2026-10-20T12:00:00Z" };
  }, { path });
  assert.equal(result.url, "https://objects.example/get");
  let calls = 0;
  for (const bad of ["", "/" + path, "aps-tutorial/reports/../private.md", "aps-tutorial/reports-other/a.md", "other/a.md"]) {
    await assert.rejects(getReportUrl(async () => { calls++; }, { path: bad }));
  }
  assert.equal(calls, 0);
});

test("deletion requires matching preview, ETag and exact confirmation; conflicts are never retried", async () => {
  let calls = 0;
  const rpc = async (method, args) => {
    calls++;
    assert.equal(method, "files/delete");
    assert.deepEqual(args, { scope: "user", path, if_match: "v1" });
    throw Object.assign(new Error("precondition_failed"), { code: -32023 });
  };
  for (const args of [{ path, etag: "", confirmation: path }, { path, etag: "v1", confirmation: "wrong" }]) {
    await assert.rejects(deleteReport(rpc, args));
  }
  assert.equal(calls, 0);
  await assert.rejects(deleteReport(rpc, { path, etag: "v1", confirmation: path }), /precondition_failed/);
  assert.equal(calls, 1);
  await assert.rejects(deleteReport(async () => ({}), { path, etag: "v1", confirmation: path }), /did not confirm deletion/);
});

test("temporary negotiate flow confirms the same opaque key and never calls APS", async () => {
  const phases = [];
  const key = "opaque-key-from-host";
  const result = await temporaryReport(async (method, args) => {
    assert.equal(method, "host/uploadFile"); phases.push(args.mode);
    if (args.mode === "negotiate") {
      assert.equal(args.expected_bytes, reportBytes(input).length);
      assert.equal("size_bytes" in args, false);
      return { r2_key: key, put_url: "https://objects.example/put", headers: { "Content-Type": "text/markdown" } };
    }
    assert.equal(args.r2_key, key);
    return { r2_key: key, download_url: "https://objects.example/get", size_bytes: 80, expires_in: 1800 };
  }, { ...input, mode: "negotiate" }, async (url, options) => {
    phases.push("PUT"); assert.equal(options.headers["Content-Type"], "text/markdown");
    return new Response(null, { status: 200 });
  });
  assert.deepEqual(phases, ["negotiate", "PUT", "confirm"]);
  assert.equal(result.provider, "host.upload");
});

test("temporary inline accepts raw UTF-8 report bytes without an extra PUT", async () => {
  const result = await temporaryReport(async (method, args) => {
    assert.equal(method, "host/uploadFile"); assert.equal(args.mode, "inline");
    assert.deepEqual(Buffer.from(args.content_b64, "base64"), reportBytes(input));
    return { r2_key: "opaque", download_url: "https://objects.example/get", expires_in: 1800 };
  }, { ...input, mode: "inline" }, async () => { throw new Error("No PUT expected"); });
  assert.equal(result.mode, "inline");
});

test("call records redact bearer URLs, tokens and Base64 even in error strings", () => {
  const hidden = redact({ url: "https://objects.example/signed?secret=1", token: "secret", content_b64: "secret",
    path, nested: [{ error: "Fetch failed https://objects.example/signed?secret=2" }] });
  assert.ok(!JSON.stringify(hidden).includes("secret"));
  assert.equal(hidden.path, path);
});
