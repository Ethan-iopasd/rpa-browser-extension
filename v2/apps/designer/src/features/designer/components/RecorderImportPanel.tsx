import type { RecorderImportStrategy, RecorderPreview } from "../../../shared/types/recorder";

type RecorderImportPanelProps = {
  payloadText: string;
  strategy: RecorderImportStrategy;
  preview: RecorderPreview | null;
  panelError: string;
  extensionBridgeEnabled: boolean;
  extensionBridgeHint?: string;
  onSetPayloadText: (text: string) => void;
  onSetStrategy: (strategy: RecorderImportStrategy) => void;
  onPullFromExtension: () => void;
  onLoadFromText: () => void;
  onLoadFromFile: (file: File) => Promise<void>;
  onApplyImport: () => void;
  onClear: () => void;
};

export function RecorderImportPanel(props: RecorderImportPanelProps) {
  const {
    payloadText,
    strategy,
    preview,
    panelError,
    extensionBridgeEnabled,
    extensionBridgeHint,
    onSetPayloadText,
    onSetStrategy,
    onPullFromExtension,
    onLoadFromText,
    onLoadFromFile,
    onApplyImport,
    onClear
  } = props;

  return (
    <section className="panel">
      <header className="panel-header">
        <div>
          <h2>录制导入</h2>
          <p className="muted-text">
            {extensionBridgeEnabled
              ? "支持扩展直连拉取、粘贴 JSON、上传文件。"
              : extensionBridgeHint || "桌面端不支持浏览器扩展直连，请使用粘贴 JSON 或上传文件。"}
          </p>
        </div>
      </header>

      <label className="form-label">
        导入策略
        <select value={strategy} onChange={event => onSetStrategy(event.target.value as RecorderImportStrategy)}>
          <option value="preview">仅预览</option>
          <option value="replace">替换当前流程</option>
          <option value="append">追加到当前流程</option>
        </select>
      </label>

      <label className="form-label">
        录制载荷 JSON
        <textarea
          className="code-textarea"
          value={payloadText}
          onChange={event => onSetPayloadText(event.target.value)}
          placeholder="在这里粘贴 Recorder 导出的 payload JSON..."
        />
      </label>

      <div className="toolbar-row">
        <button
          type="button"
          onClick={onPullFromExtension}
          disabled={!extensionBridgeEnabled}
          title={!extensionBridgeEnabled ? extensionBridgeHint : undefined}
        >
          从扩展拉取
        </button>
        <button type="button" onClick={onLoadFromText}>
          解析载荷
        </button>
        <label className="file-upload-button">
          上传文件
          <input
            type="file"
            accept="application/json"
            onChange={event => {
              const file = event.target.files?.[0];
              if (file) {
                void onLoadFromFile(file);
              }
              event.target.value = "";
            }}
          />
        </label>
        <button type="button" className="button-secondary" onClick={onApplyImport}>
          应用导入
        </button>
        <button type="button" className="link-danger" onClick={onClear}>
          清空
        </button>
      </div>

      {preview ? (
        <div className="preview-box">
          <div>事件数：{preview.eventCount}</div>
          <div>生成节点：{preview.generatedNodeCount}</div>
          <div>生成连线：{preview.generatedEdgeCount}</div>
          <div>冲突修复：{preview.conflictResolvedCount}</div>
          {preview.warnings.length > 0 ? (
            <ul className="warning-list">
              {preview.warnings.map(item => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : (
        <p className="muted-text">尚未解析录制载荷。</p>
      )}

      {panelError ? <p className="inline-error">{panelError}</p> : null}
    </section>
  );
}
