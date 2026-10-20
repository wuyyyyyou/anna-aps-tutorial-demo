# Anna APS Report Archive Demo

Save a Markdown report, reload the page, and find it again. This standalone Anna App accompanies an APS tutorial and demonstrates three storage workflows:

| Feature | API | Where the data lives |
| --- | --- | --- |
| Remember a report title | App SDK `anna.storage.get/set` | APS KV, `scope: app` |
| Save, list, download, and delete reports | Executa `files/*` reverse RPC | APS Files, `scope: user`, under `aps-tutorial/reports/` |
| Create a temporary copy | Executa `host/uploadFile` | Host Upload; not registered as an APS file |

The report body is limited to **12 KiB of UTF-8 text** to keep inputs and responses small and make the protocol easy to inspect. This is a teaching limit, not the APS file size limit. This demo makes no model calls.

## Run the demo

Install Node.js 22+, npm, Git, and [uv](https://docs.astral.sh/uv/getting-started/installation/). The Anna CLI is pinned to **0.1.59** and installed through npm.

```bash
git clone https://github.com/wuyyyyyou/anna-aps-tutorial-demo.git
cd anna-aps-tutorial-demo
npm ci
npm exec -- anna-app login --host https://staging.anna.partners
npm run dev -- --llm-account https://staging.anna.partners
```

Open the dashboard URL printed in the terminal, normally `http://localhost:5180/`. If that port is already in use:

```bash
npm run dev -- --port 5184 --llm-account https://staging.anna.partners
```

`npm run dev` builds the app, then runs `anna-app dev --storage aps --no-watch`. Use the same host for CLI login, the dev command, and the browser's storage page. Restart the demo after switching accounts.

After editing source files, stop the server and run `npm run dev` again. This rebuilds both the bundle and the CLI's temporary tool mapping. Automatic rebuilding is disabled in this demo.

**Keep `--storage aps`.** The default `legacy` backend is primarily for offline development and cannot verify real APS persistence. In this CLI version, real APS mode requires the authenticated bridge and cannot be combined with `--no-llm` or `--mock-llm`. The bridge provides access to platform capabilities; the demo itself makes no model calls. Keep the strict capability gate enabled.

## Try it

1. Wait for **Connected to Anna**. Edit the title and click **Save preferences**. Reload the page; the title should be restored.
2. Click **Save to APS**. A new report appears in the file list, with its `scope/path/etag` object reference below.
3. Reload the entire dashboard, then click **Refresh files**. The report should still be listed.
4. Click **Get download link**, then open the link. Get a new link when it expires; the file stays in APS.
5. Refresh the [personal storage page](https://staging.anna.partners/storage) in the same account and open `aps-tutorial/reports/` to find the report. The title preference is in the app's private KV space, separate from this personal directory.
6. Click **Upload temporary copy** and try both `inline` and `negotiate → PUT → confirm`. Neither temporary copy appears in the APS report list.
7. To clean up, click **Delete…** on a report, enter its full path, and click **Confirm deletion**. Check that it is a tutorial report you intend to delete.

Call history redacts URLs, tokens, and Base64 content. Download links remain only in the current page's memory and link elements. They are not written to KV, persistent browser storage, or the repository. For screenshots, capture the app itself and leave out the surrounding harness URL and RPC LOG.

## Code map

```text
src/app.js                          App SDK connection, KV preferences, UI interactions
src/workflows.js                    Complete pagination and diagnostic log redaction
executas/report-store/storage.js    APS upload, download, deletion, and temporary Upload
executas/report-store/rpc.js        Reverse RPC correlation for concurrent invocations
executas/report-store/plugin.js     stdio protocol: initialize / describe / invoke
manifest.json                      App permissions
executas/report-store/manifest.json Executa capability declarations
```

The frontend sends a small amount of report text and control parameters to Executa, which constructs the file. APS uploads and temporary uploads in `negotiate` mode send bytes directly to object storage via HTTP PUT. For large files, let whichever component already holds the bytes upload them directly. Avoid encoding a browser file as Base64 just to pass it through `tools.invoke`.

Each APS save creates a UUID-based filename to avoid overwriting earlier reports. The object reference is returned only after the upload is finalized. Listing reads 20 items per page, and the frontend follows `next_cursor` until all pages are loaded. Deletion is restricted to this demo's paths, requires the preview ETag as `if_match`, and is not retried automatically. Server enforcement of conditional Files deletion depends on the deployed version, so avoid concurrent writes during cleanup.

`scope: user` suits the reports this demo delivers to the user. Plugin caches usually belong in `tool`, and app-private state usually belongs in `app`. Choose the scope for your own data's ownership and lifecycle.

## Checks and troubleshooting

Stop the dev server before these checks: the build recreates `bundle/`. Restart it with `npm run dev` afterward.

```bash
npm run check
npm test
npm run build
npm run validate
```

Automated tests use mock hosts and object storage, including a concurrency test with a real stdio process. They do not connect to or delete data from a real account. Use the steps above to verify the live integration.

| Symptom | What to check |
| --- | --- |
| `not_granted` / `-32021` | App and Executa `host_capabilities`, v2 `initialize`, and the current account's grants |
| `precondition_failed` / `-32023` | Reload KV or the file list, inspect the latest version, then retry the action |
| `quota_exceeded` / `rate_limited` | Resolve the storage quota or call budget issue before retrying |
| PUT 403 | Use the host's returned headers unchanged and check whether the URL has expired |
| Missing report | Login host, account, `scope: user`, directory prefix, and pagination |
| Deletion timeout | Deletion may already have succeeded; refresh the list before deciding what to do next |

## Official documentation

- [Documentation index](https://staging.anna.partners/llms.txt)
- [APS guide](https://staging.anna.partners/developers/tools/executa-storage.md)
- [APS reverse RPC](https://staging.anna.partners/developers/reference/executa-persistent-storage.md)
- [App KV](https://staging.anna.partners/developers/reference/host-api-storage.md)
- [App Files](https://staging.anna.partners/developers/reference/host-api-files.md)
- [Host Upload](https://staging.anna.partners/developers/tools/executa-host-upload.md)
- [Local development with APS](https://staging.anna.partners/developers/apps/local-dev.md)

MIT License.
