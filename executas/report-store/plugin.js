import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { bindInvoke, createHostRpc } from "./rpc.js";
import { saveReport, listReports, getReportUrl, deleteReport, temporaryReport } from "./storage.js";

const manifest = JSON.parse(readFileSync(new URL("manifest.json", import.meta.url), "utf8"));
const writeFrame = frame => process.stdout.write(`${JSON.stringify(frame)}\n`);
const { rpc, receive } = createHostRpc(writeFrame);
const methods = { save_report: saveReport, list_reports: listReports, get_report_url: getReportUrl,
  delete_report: deleteReport, temporary_report: temporaryReport };

async function handle(frame) {
  if (!frame.method) { receive(frame); return; }
  if (frame.id == null) return;
  try {
    let result;
    switch (frame.method) {
      case "initialize":
        result = { protocolVersion: "2.0", serverInfo: { name: manifest.display_name, version: manifest.version },
          capabilities: { storage: {}, upload: {} }, client_capabilities: { upload: {} } };
        break;
      case "describe": result = manifest; break;
      case "health": result = { status: "healthy" }; break;
      case "shutdown": result = {}; break;
      case "invoke": {
        const params = frame.params ?? {};
        const operation = methods[params.tool];
        if (!operation) throw new Error("Unknown tool");
        result = await bindInvoke(params, async () => ({ success: true,
          data: await operation(rpc, params.arguments ?? {}), tool: params.tool }));
        break;
      }
      default: throw Object.assign(new Error("Method not found"), { code: -32601 });
    }
    writeFrame({ jsonrpc: "2.0", id: frame.id, result });
  } catch (error) {
    // Never dump params, tokens or signed URLs into stdout/stderr.
    writeFrame({ jsonrpc: "2.0", id: frame.id, error: {
      code: Number.isInteger(error.code) ? error.code : -32603, message: error.message || "Request failed",
    } });
  }
}

createInterface({ input: process.stdin }).on("line", line => {
  try { void handle(JSON.parse(line)); }
  catch { writeFrame({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Invalid JSON" } }); }
});
