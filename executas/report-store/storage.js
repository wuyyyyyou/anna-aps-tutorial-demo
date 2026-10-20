import { randomUUID } from "node:crypto";

export const REPORT_PREFIX = "aps-tutorial/reports/";
const CONTENT_TYPE = "text/markdown";

export function reportBytes({ title, body }) {
  if (typeof title !== "string" || !title.trim() || title.length > 120 || /[\r\n\x00-\x1f]/.test(title)) {
    throw new Error("Title must contain 1–120 characters, with no line breaks or control characters.");
  }
  if (typeof body !== "string" || !body.trim() || Buffer.byteLength(body, "utf8") > 12 * 1024) {
    throw new Error("Report body must not be empty or exceed 12 KiB in UTF-8. This is a teaching limit for the demo.");
  }
  return Buffer.from(`# ${title.trim()}\n\n${body}\n`, "utf8");
}

export function reportPath(value) {
  if (typeof value !== "string" || !/^aps-tutorial\/reports\/[a-zA-Z0-9][a-zA-Z0-9._-]{0,120}\.md$/.test(value) || value.includes("..")) {
    throw new Error("Only Markdown reports in this demo's aps-tutorial/reports/ directory are allowed.");
  }
  return value;
}

function httpsUrl(value) {
  if (typeof value !== "string" || new URL(value).protocol !== "https:") throw new Error("The host did not return a valid HTTPS URL.");
  return value;
}

export async function saveReport(rpc, input, fetchImpl = fetch) {
  const bytes = reportBytes(input);
  // Unique paths avoid overwriting an earlier report or another writer.
  const path = `${REPORT_PREFIX}${new Date().toISOString().slice(0, 10)}-${randomUUID()}.md`;
  const upload = await rpc("files/upload_begin", {
    scope: "user", path, content_type: CONTENT_TYPE, size_bytes: bytes.length,
    metadata: { tutorial: "aps-basics", title: input.title.trim() },
  });
  const response = await fetchImpl(httpsUrl(upload.put_url ?? upload.presigned_url), {
    method: "PUT", headers: upload.headers ?? upload.fields ?? {}, body: bytes,
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`APS PUT failed: HTTP ${response.status}`);
  const completed = await rpc("files/upload_complete", {
    scope: "user", path, etag: response.headers.get("etag") ?? undefined, size_bytes: bytes.length,
  });
  if (typeof completed?.etag !== "string" || !completed.etag) throw new Error("APS did not return an ETag after finalizing the upload. Refresh the file list to check its state.");
  return { provider: "aps.files", scope: "user", path, etag: completed.etag,
    size_bytes: completed.size_bytes ?? bytes.length, content_type: CONTENT_TYPE };
}

export async function listReports(rpc, { cursor } = {}) {
  if (cursor != null && (typeof cursor !== "string" || cursor.length > 4096)) throw new Error("Invalid cursor.");
  const page = await rpc("files/list", {
    scope: "user", prefix: REPORT_PREFIX, limit: 20, ...(cursor ? { cursor } : {}),
  });
  const rows = page?.items ?? page?.entries ?? page?.objects;
  if (!Array.isArray(rows)) throw new Error("Unrecognized APS list response. It cannot be treated as an empty directory.");
  const items = rows.map(item => ({
    path: reportPath(item.path), etag: item.etag, size_bytes: item.size_bytes,
    content_type: item.content_type, title: item.metadata?.title ?? item.entry_metadata?.title ?? "",
  }));
  const next = page.next_cursor ?? null;
  if (next !== null && typeof next !== "string") throw new Error("Invalid APS pagination cursor.");
  return { items, next_cursor: next };
}

export async function getReportUrl(rpc, { path }) {
  const result = await rpc("files/download_url", { scope: "user", path: reportPath(path), ttl_seconds: 300 });
  return { path, url: httpsUrl(result.url ?? result.get_url), expires_at: result.expires_at };
}

export async function deleteReport(rpc, { path, etag, confirmation }) {
  reportPath(path);
  if (confirmation !== path || typeof etag !== "string" || !etag) throw new Error("Deletion requires the exact full path and the ETag from the preview.");
  // Do not retry deletion automatically. A timeout does not prove it failed.
  const result = await rpc("files/delete", { scope: "user", path, if_match: etag });
  const matched = result?.path === undefined || result.path === path;
  if (!matched || (result?.deleted !== true && !(result?.ok === true && result.path === path))
      || result?.deleted === false || result?.ok === false) throw new Error("The server did not confirm deletion. Refresh the file list to check its state.");
  return { deleted: true, path };
}

export async function temporaryReport(rpc, input, fetchImpl = fetch) {
  const bytes = reportBytes(input);
  const base = { filename: "temporary-report.md", mime_type: CONTENT_TYPE, purpose: "user_artifact" };
  let result;
  if (input.mode === "inline") {
    result = await rpc("host/uploadFile", { ...base, mode: "inline", content_b64: bytes.toString("base64") });
  } else if (input.mode === "negotiate") {
    const upload = await rpc("host/uploadFile", { ...base, mode: "negotiate", expected_bytes: bytes.length });
    if (typeof upload.r2_key !== "string" || !upload.r2_key) throw new Error("The host did not return r2_key.");
    const response = await fetchImpl(httpsUrl(upload.put_url), {
      method: "PUT", headers: upload.headers ?? {}, body: bytes, signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) throw new Error(`Host Upload PUT failed: HTTP ${response.status}`);
    result = await rpc("host/uploadFile", { mode: "confirm", r2_key: upload.r2_key });
  } else throw new Error("mode must be inline or negotiate.");
  return { provider: "host.upload", mode: input.mode, r2_key: result.r2_key,
    url: httpsUrl(result.download_url ?? result.url), size_bytes: result.size_bytes ?? result.bytes ?? bytes.length,
    expires_at: result.expires_at, expires_in: result.expires_in };
}
