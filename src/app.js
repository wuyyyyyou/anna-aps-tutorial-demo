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
  if (!result || typeof result !== "object") throw new Error("Invalid response format from Executa.");
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
  if (url.protocol !== "https:") throw new Error("The host did not return an HTTPS link.");
  const expires = result.expires_at ? Date.parse(/(?:Z|[+-]\d\d:\d\d)$/.test(result.expires_at)
    ? result.expires_at : `${result.expires_at}Z`) : Date.now() + Number(result.expires_in) * 1000;
  if (!Number.isFinite(expires) || expires <= Date.now()) throw new Error("The download link has an invalid expiry time. Get a new link.");
  const link = document.createElement("a");
  link.href = url.href;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = "Open / download file ↗";
  const expiry = document.createElement("small");
  expiry.textContent = `Link expires ${new Date(expires).toLocaleString("en-US", { timeZoneName: "short" })}. Stored only on this page. Get a new link after it expires.`;
  $(id).append(link, expiry);
  $(id).hidden = false;
  expiryTimers.set(id, setTimeout(() => {
    clearLink(id);
    $(id).hidden = false;
    $(id).textContent = "This download link has expired. Get a new link.";
  }, Math.min(expires - Date.now(), 2_147_483_647)));
}
async function refresh() {
  clearLink("file-link");
  const items = await listAllReports(invoke);
  $("files").replaceChildren();
  $("file-summary").textContent = `${items.length} ${items.length === 1 ? "report" : "reports"} · scope: user`;
  for (const item of items) {
    const row = document.createElement("div"); row.className = "file";
    const title = document.createElement("strong"); title.textContent = item.title || "Markdown report";
    const path = document.createElement("p"); const code = document.createElement("code"); code.textContent = item.path; path.append(code);
    const info = document.createElement("p"); info.className = "hint"; info.textContent = `${item.size_bytes ?? "?"} bytes · ETag: ${item.etag || "not returned"}`;
    const actions = document.createElement("div"); actions.className = "actions";
    const download = document.createElement("button"); download.textContent = "Get download link";
    download.addEventListener("click", () => void run(async () => {
      showLink("file-link", await invoke("get_report_url", { path: item.path }));
      status("Created a new short-lived link from the APS path. The saved file is ready to download.");
    }));
    const remove = document.createElement("button"); remove.textContent = "Delete…"; remove.className = "danger";
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
    ? `Loaded · scope: app · ETag: ${preferences.etag ?? "not returned"}` : "No saved preferences · scope: app";
}

$("save").addEventListener("click", () => void run(async () => {
  status("Saving to APS: requesting an upload, sending bytes via PUT, and finalizing…");
  const result = await invoke("save_report", reportInput());
  $("saved-reference").hidden = false;
  const label = document.createElement("strong"); label.textContent = "Saved: a stable object reference";
  const json = document.createElement("pre"); json.textContent = JSON.stringify(result, null, 2);
  $("saved-reference").replaceChildren(label, json);
  await refresh();
  status("Report saved to your personal APS space. Reload the page to find it again in the list.");
}));
$("refresh").addEventListener("click", () => void run(async () => { await refresh(); status("Loaded all pages of reports for this demo."); }));
$("load-preferences").addEventListener("click", () => void run(async () => { await loadPreferences(); status("Reloaded preferences from APS KV."); }));
$("save-preferences").addEventListener("click", () => void run(async () => {
  if (!preferences) throw new Error('Click "Reload preferences" first to get the current ETag.');
  if (preferences.exists && !preferences.etag) throw new Error("Saved preferences have no ETag. Check that you are using the real APS backend.");
  const result = await anna.storage.set({ scope: "app", key: PREFERENCES_KEY,
    value: { title: $("title").value }, ...(preferences.exists ? { if_match: preferences.etag } : {}) });
  record("storage.set", result);
  await loadPreferences();
  status('Title preference saved. If another window causes a conflict, click "Reload preferences" and confirm which title to keep.');
}));
$("temporary").addEventListener("click", () => void run(async () => {
  clearLink("temporary-link");
  status("Uploading a temporary copy…");
  const result = await invoke("temporary_report", { ...reportInput(), mode: $("mode").value });
  showLink("temporary-link", result);
  status("Temporary copy uploaded. It will not appear when you refresh the APS file list.");
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
      status("Report deleted. APS uses soft deletion; the platform reclaims the underlying object later.");
    } catch (error) {
      clearLink("file-link");
      $("files").replaceChildren();
      $("file-summary").textContent = "This list is out of date. Refresh to check the current server state before continuing.";
      throw error;
    }
  });
});

try {
  toolId = window.__ANNA_TOOL_IDS__?.["report-store"];
  if (!toolId) throw new Error("The report-store tool mapping is missing. Run npm run dev from this demo's directory.");
  anna = await AnnaAppRuntime.connect();
  $("connection").textContent = "Connected to Anna";
  await run(async () => {
    await loadPreferences();
    await refresh();
    status("Connected to the real APS backend. Save a report, then reload to find it again.");
  });
} catch (error) { $("connection").textContent = "Connection failed"; status(error.message, true); }
controls();
