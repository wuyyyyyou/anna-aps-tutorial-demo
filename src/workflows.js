export const PREFERENCES_KEY = "aps-tutorial/preferences";

export async function listAllReports(invoke) {
  const items = [];
  const cursors = new Set();
  let cursor;
  for (let pageNumber = 0; pageNumber < 100; pageNumber++) {
    const page = await invoke("list_reports", cursor ? { cursor } : {});
    if (!Array.isArray(page.items)) throw new Error("文件列表格式无效。");
    items.push(...page.items);
    cursor = page.next_cursor;
    if (!cursor) return items;
    if (typeof cursor !== "string" || cursors.has(cursor)) throw new Error("分页游标无效或重复，请重新刷新。");
    cursors.add(cursor);
  }
  throw new Error("超过 demo 的 100 页读取限制，请缩小数据量。");
}

// Diagnostic records contain object references, never signed URLs or tokens.
export function redact(value) {
  if (typeof value === "string") return value.replace(/https?:\/\/[^\s"<>]+/g, "[URL hidden]");
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key,
    /url|token|authorization|content_b64/i.test(key) ? "[hidden]" : redact(entry)]));
}
