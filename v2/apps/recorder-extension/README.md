# 录制扩展

这是 V2 阶段 E 的 Recorder 扩展（MV3）。

## 当前能力

1. 录制 `navigate / click / input / select` 事件。
2. 为每个事件生成选择器候选（主选择器 + 备选）并附带评分。
3. Playwright 风格页面拾取器：高亮框、提示气泡、顶部操作条（确认 / 解锁 / Esc 取消）。
4. 支持嵌套 iframe 跟踪：拾取结果返回 `framePath` 和 `framePathString`。
5. Picker 结果包含 fallback 候选链，运行阶段可按候选与 framePath 自动重试。
6. 拾取模式会向子 frame 广播，同步开启/关闭，减少“只选到外层 iframe 容器”的误选。
7. Popup 支持：开始/停止/清空、导出 JSON、复制载荷、发送到 Designer。
8. 桌面模式支持 Native Picker 调度：扩展会轮询桌面 `/api/v1/native-picker/sessions`，并通过 Native Messaging（失败自动回退 HTTP）回传 `session_ready / pick_result / cancel / error`。

## 事件载荷（示例）

```json
{
  "source": "rpa-flow-recorder",
  "schemaVersion": "1.0.0",
  "tabId": 123,
  "exportedAt": "2026-02-23T12:34:56.000Z",
  "events": [
    {
      "action": "click",
      "selector": "#submit",
      "selectorType": "css",
      "selectorCandidates": [
        { "type": "css", "value": "#submit", "score": 0.98, "primary": true, "reason": "id" },
        { "type": "role", "value": "role=button[name=\"Submit\"]", "score": 0.86, "primary": false }
      ],
      "page": { "url": "https://example.com", "title": "Example" },
      "frame": {
        "isTop": true,
        "url": "https://example.com",
        "path": [],
        "segments": []
      }
    }
  ]
}
```

## 文件

- `manifest.json`
- `background.js`
- `content.js`
- `picker-rules/selector-rules.json`
- `picker-rules/frame-rules.json`
- `popup.html`
- `popup.js`

## 规则配置（复杂页面 / 嵌套 iframe）

页面拾取器会在运行时加载下面两个规则文件，优先使用规则生成候选：

1. `picker-rules/selector-rules.json`
2. `picker-rules/frame-rules.json`

调整规则后，重新加载扩展即可生效（开发态无需重新打包 zip/exe）。

## 开发态联调（无需打包）

1. 启动桌面开发模式：`pnpm --filter @rpa/desktop dev:tauri`
2. Chrome 加载解压目录：`v2/apps/recorder-extension`
3. 修改 `content.js/background.js/picker-rules/*.json` 后，点击 `chrome://extensions` 的“刷新”
4. 在扩展 Service Worker 控制台观察日志：
   - `[rpa-picker] rule files loaded`
   - `[rpa-picker] route pick result via native session`
   - 如果出现 `[rpa-picker] skip API port without native-picker support:`，说明自动避开了不兼容端口

## 在 Chrome 中加载

1. 打开 `chrome://extensions/`。
2. 开启开发者模式。
3. 点击“加载已解压的扩展程序”。
4. 选择 `v2/apps/recorder-extension`。
5. 扩展 ID 固定为：`kgchhdlfghhamnpaoigghhgjihcfnnpn`（由 manifest `key` 固定，便于桌面端自动注册 Native Host）。

## 与 Designer 联调

1. 在目标网页开始录制并产生事件。
2. 打开 Designer 页面（建议与目标页分标签）。
3. 在扩展 Popup 点击 `Send to Designer`。
4. 在 Designer 的“录制导入”面板中选择策略并应用。

如果无法直推：
1. 点击 `Export` 或 `Copy Payload`。
2. 在 Designer 面板粘贴或上传 JSON 解析后应用。

## 最小回归命令

- 在 `v2` 根目录运行：`pnpm test:picker:smoke`
- 默认测试链路 `pnpm test` 已包含该 smoke，用于在 Python 测试后验证扩展路由回传。
