# Anna APS 报告存档 Demo

保存一份 Markdown 报告，刷新页面后重新找到它。这个独立 Anna App 配合 APS 入门教程，演示三件事：

| 功能 | 接口 | 数据放在哪里 |
| --- | --- | --- |
| 记住标题偏好 | App SDK `anna.storage.get/set` | APS KV，`scope: app` |
| 保存、列举、下载和删除报告 | Executa `files/*` reverse RPC | APS Files，`scope: user`，`aps-tutorial/reports/` |
| 创建临时副本 | Executa `host/uploadFile` | Host Upload；不登记成 APS 文件 |

报告正文限制为 **12 KiB UTF-8**，这是教学示例的限制。它让输入和返回值都保持很小，方便观察协议；不是 APS 的文件大小上限。此示例不调用模型。

## 运行

需要 Node.js 22+、npm、Git 和 [uv](https://docs.astral.sh/uv/getting-started/installation/)。CLI 固定为 **0.1.59**，由 npm 安装，不需要克隆 Anna 平台源码。

```bash
git clone https://github.com/wuyyyyyou/anna-aps-tutorial-demo.git
cd anna-aps-tutorial-demo
npm ci
npm exec -- anna-app login --host https://staging.anna.partners
npm run dev -- --llm-account https://staging.anna.partners
```

打开终端打印的 dashboard 地址，默认 `http://localhost:5180/`。如端口被占用：

```bash
npm run dev -- --port 5184 --llm-account https://staging.anna.partners
```

`npm run dev` 会先构建，再运行 `anna-app dev --storage aps --no-watch`。登录 Host、运行参数和浏览器里查看存储的 Host 必须一致。切换登录账号后，重启 demo。

**保留 `--storage aps`。** 默认 legacy 后端主要用于离线开发，不能用来验证真实 APS 持久化。此 CLI 的真实 APS 模式依赖真实登录桥接，不能搭配 `--no-llm` 或 `--mock-llm`；这不代表本 demo 会调用模型。不要关闭 strict capability gate。

## 跟着做

1. 等页面显示“已连接 Anna”。修改标题，点击“保存偏好”。刷新页面，标题应恢复。
2. 点击“保存到 APS”。报告列表会出现一个新文件，下面显示 `scope/path/etag` 对象引用。
3. 刷新整个 dashboard，再点击“刷新文件列表”。报告应仍在列表中。
4. 点击“获取新下载链接”，再打开链接。链接过期后重新获取，文件无需重复上传。
5. 在同一账号的 [个人存储页](https://staging.anna.partners/storage) 中刷新，进入 `aps-tutorial/reports/` 找到报告。App KV 偏好保存在 App 私有空间，不等同于这个个人目录。
6. 点击“临时上传副本”，分别试试 `inline` 和 `negotiate → PUT → confirm`。它们都不会出现在 APS 报告列表。
7. 需要清理时，点击某份报告的“删除…”，输入完整路径后确认。只删除你核对过的教学报告。

调用记录会隐藏 URL、token 和 Base64。下载链接只保存在当前页面内存和链接元素里，不写入 KV、浏览器持久缓存或仓库。截图时建议只截 App 本身，避开外层 harness 的 URL 和 RPC LOG。

## 代码入口

```text
src/app.js                         App SDK 连接、KV 偏好、界面交互
src/workflows.js                   完整分页、调用记录脱敏
executas/report-store/storage.js   APS 上传、下载、删除及临时 Upload
executas/report-store/rpc.js       并发安全的 reverse RPC 关联
executas/report-store/plugin.js    stdio 协议、initialize / describe / invoke
manifest.json                     App 权限
executas/report-store/manifest.json Executa 能力声明
```

前端只把小段报告文本和控制参数传给 Executa。文件由 Executa 构造，APS 和 negotiate 模式的字节通过 HTTP PUT 直达对象存储。大文件接入时，应让持有字节的一方直接上传，不要先把浏览器文件转成 Base64 塞进 `tools.invoke`。

每次 APS 保存都创建 UUID 文件名，避免覆盖。上传完成登记后才返回对象引用。列表每次读取 20 条，前端继续读取 `next_cursor` 直到结束。删除只允许本 demo 的路径，必须携带预览 ETag 作为 `if_match`，不自动重试；服务端是否执行 Files 条件删除取决于部署版本，清理期间仍应避免并发写入。

`scope: user` 适合本示例向用户交付的报告；插件缓存通常用 `tool`，App 私有状态通常用 `app`。不要把本示例的 scope 当成所有业务的默认值。

## 检查

```bash
npm run check
npm test
npm run build
npm run validate
```

自动测试使用模拟 Host 与对象存储，包括真实 stdio 进程的并发测试，不连接或删除真实账号的数据。真实联调需按上面的交互步骤执行。

常见错误：

| 现象 | 检查 |
| --- | --- |
| `not_granted` / `-32021` | App 与 Executa 的 `host_capabilities`、v2 `initialize`、当前账号授权 |
| `precondition_failed` / `-32023` | 重新读取 KV 或文件列表，确认新版本后再操作 |
| `quota_exceeded` / `rate_limited` | 解决存储额度或调用预算问题，不在原调用内无限重试 |
| PUT 403 | 原样使用 Host 返回的 headers，检查 URL 是否过期 |
| 报告找不到 | 登录 Host、账号、`scope: user`、目录前缀和分页 |
| 删除超时 | 删除可能已生效，刷新核实后再决定下一步 |

## 官方文档

- [文档总入口](https://staging.anna.partners/llms.txt)
- [APS 指南](https://staging.anna.partners/developers/tools/executa-storage.md)
- [APS reverse RPC](https://staging.anna.partners/developers/reference/executa-persistent-storage.md)
- [App KV](https://staging.anna.partners/developers/reference/host-api-storage.md)
- [App Files](https://staging.anna.partners/developers/reference/host-api-files.md)
- [Host Upload](https://staging.anna.partners/developers/tools/executa-host-upload.md)
- [本地 APS 开发](https://staging.anna.partners/developers/apps/local-dev.md)

MIT License.
