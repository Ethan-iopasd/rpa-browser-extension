import { handleDesktopCloseDecision } from "./bridge";

interface DesktopCloseDialogProps {
    /** 是否显示弹窗 */
    open: boolean;
    /** 用户做出决定后的回调（关闭弹窗） */
    onClose: () => void;
}

/**
 * 桌面端关闭确认弹窗。
 * 取代 window.confirm，因为 Tauri webview 默认屏蔽原生弹窗。
 */
export function DesktopCloseDialog({ open, onClose }: DesktopCloseDialogProps) {
    if (!open) {
        return null;
    }

    async function handleMinimize() {
        onClose();
        await handleDesktopCloseDecision("minimize");
    }

    async function handleExit() {
        onClose();
        await handleDesktopCloseDecision("exit");
    }

    return (
        <div
            style={{
                position: "fixed",
                inset: 0,
                zIndex: 9999,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "rgba(0,0,0,0.45)",
                backdropFilter: "blur(4px)",
            }}
        >
            <div
                style={{
                    background: "#fff",
                    borderRadius: "16px",
                    padding: "32px 28px 24px",
                    maxWidth: "360px",
                    width: "100%",
                    boxShadow: "0 20px 60px rgba(0,0,0,0.18)",
                    display: "flex",
                    flexDirection: "column",
                    gap: "8px",
                }}
            >
                {/* 标题 */}
                <div style={{ fontSize: "17px", fontWeight: 700, color: "#0f172a", marginBottom: "4px" }}>
                    关闭 RPA Flow Desktop
                </div>

                {/* 描述 */}
                <div style={{ fontSize: "14px", color: "#64748b", lineHeight: 1.6 }}>
                    请选择关闭方式：最小化到系统托盘可让任务在后台继续运行。
                </div>

                {/* 按钮区 */}
                <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginTop: "20px" }}>
                    <button
                        type="button"
                        onClick={() => void handleMinimize()}
                        style={{
                            padding: "11px 0",
                            borderRadius: "10px",
                            border: "none",
                            background: "linear-gradient(135deg, #2563eb, #4f46e5)",
                            color: "#fff",
                            fontWeight: 600,
                            fontSize: "14px",
                            cursor: "pointer",
                            letterSpacing: "0.02em",
                        }}
                    >
                        最小化到托盘（继续后台运行）
                    </button>

                    <button
                        type="button"
                        onClick={() => void handleExit()}
                        style={{
                            padding: "11px 0",
                            borderRadius: "10px",
                            border: "1.5px solid #e2e8f0",
                            background: "#f8fafc",
                            color: "#475569",
                            fontWeight: 600,
                            fontSize: "14px",
                            cursor: "pointer",
                        }}
                    >
                        完全退出程序
                    </button>
                </div>
            </div>
        </div>
    );
}
