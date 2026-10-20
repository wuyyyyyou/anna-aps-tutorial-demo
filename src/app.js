import { AnnaAppRuntime } from "/static/anna-apps/_sdk/latest/index.js";
import { listAllReports, PREFERENCES_KEY, redact } from "./workflows.js";

const $ = id => document.getElementById(id);
let anna;
let toolId;
let busy = false;
let preferences = null;
let deleteTarget = null;
const records = [];
const expiryTimers = new Map();

function record(method, result) {
  records.unshift({ time: new Date().toISOString(), method, result: redact(result) });
  records.splice(30);
  $("records").textContent = JSON.stringify(records, null, 2);
}
function controls() {
  for (const button of document.querySelectorAll("main button")) button.disabled = busy || !anna || !toolId;
  $("title").disabled = busy;
  $("body").disabled = busy;
  $("mode").disabled = busy;
}
function status(text, error = false) {
  $("status").textContent = text;
  $("status").dataset.error = String(error);
}
async function run(operation) {
  if (busy) return;
  busy = true;
  controls();
  try { await operation(); }
  catch (error) { status(redact(error.message || String(error)), true); }
  finally { busy = false; controls(); }
}
async function invoke(method, args = {}) {
  const reply = await anna.tools.invoke({ tool_id: toolId, method, args }, { timeoutMs: 180_000 });
  if (reply?.success === false) throw new Error(typeof reply.error === "string" ? reply.error : reply.error?.message || "Tool failed");
  const result = reply?.data ?? reply;
  if (!result || typeof result !== "object") throw new Error("Executa 返回格式无效。");
  record(method, result);
  return result;
}
function reportInput() { return { title: $("title").value, body: $("body").value }; }
function clearLink(id) {
  clearTimeout(expiryTimers.get(id));
  expiryTimers.delete(id);
  $(id).replaceChildren();
  $(id).hidden = true;
}
function showLink(id, result) {
  clearLink(id);
  const url = new URL(result.url);
  if (url.protocol !== "https:") throw new Error("Host 未返回 HTTPS 链接。");
  const expires = result.expires_at ? Date.parse(/(?:Z|[+-]\d\d:\d\d)$/.test(result.expires_at)
    ? result.expires_at : `${result.expires_at}Z`) : Date.now() + Number(result.expires_in) * 1000;
  if (!Number.isFinite(expires) || expires <= Date.now()) throw new Error("下载链接有效期无效，请重新获取。");
  const link = document.createElement("a");
  link.href = url.href;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = "打开 / 下载文件 ↗";
  const expiry = document.createElement("small");
  expiry.textContent = `链接有效至 ${new Date(expires).toLocaleString()}。仅保留在当前页面，过期后重新获取。`;
  $(id).append(link, expiry);
  $(id).hidden = false;
  expiryTimers.set(id, setTimeout(() => {
    clearLink(id);
    $(id).hidden = false;
    $(id).textContent = "下载链接已过期，请重新获取。";
  }, Math.min(expires - Date.now(), 2_147_483_647)));
}
async function refresh() {
  clearLink("file-link");
  const items = await listAllReports(invoke);
  $("files").replaceChildren();
  $("file-summary").textContent = `${items.length} 份报告 · scope: user`;
  for (const item of items) {
    const row = document.createElement("div"); row.className = "file";
    const title = document.createElement("strong"); title.textContent = item.title || "Markdown 报告";
    const path = document.createElement("p"); const code = document.createElement("code"); code.textContent = item.path; path.append(code);
    const info = document.createElement("p"); info.className = "hint"; info.textContent = `${item.size_bytes ?? "?"} bytes · ETag: ${item.etag || "未返回"}`;
    const actions = document.createElement("div"); actions.className = "actions";
    const download = document.createElement("button"); download.textContent = "获取新下载链接";
    download.addEventListener("click", () => void run(async () => {
      showLink("file-link", await invoke("get_report_url", { path: item.path }));
      status("已按 APS path 获取新的短期链接。文件无需重复上传。");
    }));
    const remove = document.createElement("button"); remove.textContent = "删除…"; remove.className = "danger";
    remove.addEventListener("click", () => {
      deleteTarget = item;
      $("delete-path").textContent = item.path;
      $("confirmation").value = "";
      $("confirm-delete").disabled = true;
      $("delete-dialog").returnValue = "";
      $("delete-dialog").showModal();
    });
    actions.append(download, remove); row.append(title, path, info, actions); $("files").append(row);
  }
}
async function loadPreferences() {
  preferences = await anna.storage.get({ scope: "app", key: PREFERENCES_KEY });
  record("storage.get", preferences);
  if (preferences.exists && typeof preferences.value?.title === "string") $("title").value = preferences.value.title;
  $("preferences-info").textContent = preferences.exists
    ? `已读取 · scope: app · ETag: ${preferences.etag ?? "未返回"}` : "尚未保存偏好 · scope: app";
}

$("save").addEventListener("click", () => void run(async () => {
  status("正在申请 APS 上传、PUT 文件并完成登记…");
  const result = await invoke("save_report", reportInput());
  $("saved-reference").hidden = false;
  const label = document.createElement("strong"); label.textContent = "已保存：这是稳定的对象引用";
  const json = document.createElement("pre"); json.textContent = JSON.stringify(result, null, 2);
  $("saved-reference").replaceChildren(label, json);
  await refresh();
  status("报告已保存到个人 APS。可以刷新页面，再从列表重新找回。");
}));
$("refresh").addEventListener("click", () => void run(async () => { await refresh(); status("已读取本 demo 的全部文件分页。"); }));
$("load-preferences").addEventListener("click", () => void run(async () => { await loadPreferences(); status("已重新读取 APS KV 偏好。"); }));
$("save-preferences").addEventListener("click", () => void run(async () => {
  if (!preferences) throw new Error("请先点击“重新读取”，取得当前偏好的 ETag。");
  if (preferences.exists && !preferences.etag) throw new Error("现有偏好缺少 ETag，请检查是否使用真实 APS 后端。");
  const result = await anna.storage.set({ scope: "app", key: PREFERENCES_KEY,
    value: { title: $("title").value }, ...(preferences.exists ? { if_match: preferences.etag } : {}) });
  record("storage.set", result);
  await loadPreferences();
  status("已保存标题偏好。其他窗口发生冲突时，请重新读取并确认要保留的标题。");
}));
$("temporary").addEventListener("click", () => void run(async () => {
  clearLink("temporary-link");
  status("正在创建临时上传副本…");
  const result = await invoke("temporary_report", { ...reportInput(), mode: $("mode").value });
  showLink("temporary-link", result);
  status("临时副本已上传。刷新 APS 文件列表时，它不会出现在其中。");
}));
$("confirmation").addEventListener("input", () => {
  $("confirm-delete").disabled = !deleteTarget?.etag || $("confirmation").value !== deleteTarget.path;
});
$("delete-dialog").addEventListener("close", () => {
  const item = deleteTarget;
  const confirmed = $("confirmation").value;
  deleteTarget = null;
  if ($("delete-dialog").returnValue !== "delete" || !item) return;
  void run(async () => {
    try {
      await invoke("delete_report", { path: item.path, etag: item.etag, confirmation: confirmed });
      await refresh();
      status("已删除这份报告。APS 软删除后，底层对象由平台回收。");
    } catch (error) {
      clearLink("file-link");
      $("files").replaceChildren();
      $("file-summary").textContent = "旧列表已失效，请刷新核实云端状态后再操作。";
      throw error;
    }
  });
});

try {
  toolId = window.__ANNA_TOOL_IDS__?.["report-store"];
  if (!toolId) throw new Error("缺少 report-store 工具映射，请从本 demo 目录运行 npm run dev。");
  anna = await AnnaAppRuntime.connect();
  $("connection").textContent = "已连接 Anna";
  await run(async () => {
    await loadPreferences();
    await refresh();
    status("已连接真实 APS。先保存一份报告，再刷新找回。");
  });
} catch (error) { $("connection").textContent = "连接失败"; status(error.message, true); }
controls();
