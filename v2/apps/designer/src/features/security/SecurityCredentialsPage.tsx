import { useEffect, useState } from "react";

import { createCredentialRequest, getCredentialSecretRequest, listAuditRecordsRequest, listCredentialsRequest } from "../../core/api/security";
import type { AuditRecord, CredentialSummary } from "../../shared/types/security";

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];

export function SecurityCredentialsPage() {
  const [credentials, setCredentials] = useState<CredentialSummary[]>([]);
  const [auditRecords, setAuditRecords] = useState<AuditRecord[]>([]);
  const [credentialsTotal, setCredentialsTotal] = useState(0);
  const [credentialsPage, setCredentialsPage] = useState(1);
  const [credentialsPageSize, setCredentialsPageSize] = useState(20);
  const [auditTotal, setAuditTotal] = useState(0);
  const [auditPage, setAuditPage] = useState(1);
  const [auditPageSize, setAuditPageSize] = useState(20);
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [description, setDescription] = useState("");
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [panelError, setPanelError] = useState("");
  const [loading, setLoading] = useState(false);
  const credentialsOffset = (credentialsPage - 1) * credentialsPageSize;
  const auditOffset = (auditPage - 1) * auditPageSize;
  const credentialsTotalPages = Math.max(1, Math.ceil(credentialsTotal / credentialsPageSize));
  const auditTotalPages = Math.max(1, Math.ceil(auditTotal / auditPageSize));

  async function refresh() {
    setLoading(true);
    setPanelError("");
    try {
      const [credsRes, auditRes] = await Promise.all([
        listCredentialsRequest({
          limit: credentialsPageSize,
          offset: credentialsOffset
        }),
        listAuditRecordsRequest({
          limit: auditPageSize,
          offset: auditOffset
        })
      ]);
      if (!credsRes.ok) {
        setPanelError(`${credsRes.error.code}: ${credsRes.error.message}`);
        return;
      }
      if (!auditRes.ok) {
        setPanelError(`${auditRes.error.code}: ${auditRes.error.message}`);
        return;
      }
      setCredentials(credsRes.data.credentials);
      setCredentialsTotal(credsRes.data.total);
      setAuditRecords(auditRes.data.records);
      setAuditTotal(auditRes.data.total);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, [auditOffset, auditPageSize, credentialsOffset, credentialsPageSize]);

  useEffect(() => {
    if (credentialsPage > credentialsTotalPages) {
      setCredentialsPage(credentialsTotalPages);
    }
  }, [credentialsPage, credentialsTotalPages]);

  useEffect(() => {
    if (auditPage > auditTotalPages) {
      setAuditPage(auditTotalPages);
    }
  }, [auditPage, auditTotalPages]);

  async function createCredential() {
    if (!name.trim() || !value.trim()) {
      setPanelError("凭据名称和值不能为空。");
      return;
    }
    const response = await createCredentialRequest({
      name: name.trim(),
      value,
      description: description.trim() || undefined
    });
    if (!response.ok) {
      setPanelError(`${response.error.code}: ${response.error.message}`);
      return;
    }
    setName("");
    setValue("");
    setDescription("");
    setCredentialsPage(1);
    await refresh();
  }

  async function revealSecret(credentialId: string) {
    const response = await getCredentialSecretRequest(credentialId);
    if (!response.ok) {
      setPanelError(`${response.error.code}: ${response.error.message}`);
      return;
    }
    setRevealed(prev => ({ ...prev, [credentialId]: response.data.value }));
  }

  return (
    <div className="flex flex-col gap-6 w-full max-w-6xl mx-auto p-4 sm:p-6 lg:p-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white/60 backdrop-blur p-5 rounded-2xl border border-slate-200/60 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-rose-100 text-rose-500 flex items-center justify-center shadow-sm">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
          </div>
          <div>
            <h2 className="text-xl font-bold text-slate-800 m-0">安全凭证与审计核心</h2>
            <p className="text-sm text-slate-500 m-0 mt-1">集中管理敏感密钥、访问凭据与全局操作安全审计追踪</p>
          </div>
        </div>
        <button
          type="button"
          className="text-slate-500 hover:text-slate-700 bg-slate-50 hover:bg-slate-100 px-3 py-2 border border-slate-200 rounded-lg text-sm font-bold transition-all"
          onClick={() => void refresh()}
          disabled={loading}
          title="刷新全量状态"
        >
          {loading ? (
            <svg className="animate-spin w-4 h-4 inline-block mr-1.5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
          ) : (
            <svg className="w-4 h-4 inline-block mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
          )}
          {loading ? "刷新中..." : "重新载入"}
        </button>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-6">
        <div className="flex items-center gap-2 pb-5 border-b border-slate-100 mb-5 relative">
          <h3 className="m-0 text-sm font-bold text-slate-800 flex items-center gap-2">
            <svg className="w-4 h-4 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" /></svg>
            发行新凭据证书
          </h3>
          <div className="absolute right-0 text-[10px] bg-amber-50 text-amber-600 px-2 py-1 rounded border border-amber-200 font-bold uppercase tracking-wide">
            <svg className="w-3 h-3 inline-block mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            凭证值将被系统不可逆加密存储
          </div>
        </div>
        <div className="flex flex-col md:flex-row items-start md:items-center gap-4">
          <div className="flex-1 w-full space-y-1.5">
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wide ml-1">凭据别名标识 (名称)</span>
            <input
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm transition-all focus:bg-white focus:border-rose-400 focus:ring-2 focus:ring-rose-500/20 outline-none hover:bg-white placeholder:text-slate-400 font-mono"
              value={name}
              onChange={event => setName(event.target.value)}
              placeholder="譬如: prod-db-password"
            />
          </div>
          <div className="flex-1 w-full space-y-1.5">
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wide ml-1">凭据真实内容 (明文)</span>
            <input
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm transition-all focus:bg-white focus:border-rose-400 focus:ring-2 focus:ring-rose-500/20 outline-none hover:bg-white placeholder:text-slate-400"
              type="password"
              value={value}
              onChange={event => setValue(event.target.value)}
              placeholder="将会被加密并防泄漏"
            />
          </div>
          <div className="flex-1 w-full space-y-1.5">
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wide ml-1">用途描述 (可选)</span>
            <input
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm transition-all focus:bg-white focus:border-rose-400 focus:ring-2 focus:ring-rose-500/20 outline-none hover:bg-white placeholder:text-slate-400"
              value={description}
              onChange={event => setDescription(event.target.value)}
              placeholder="简短描述..."
            />
          </div>
          <div className="md:pt-6">
            <button
              type="button"
              className="w-full md:w-auto text-white bg-slate-800 hover:bg-slate-900 px-6 py-2 rounded-lg text-sm font-bold transition-all shadow-sm"
              onClick={() => void createCredential()}
            >
              安全发行入库
            </button>
          </div>
        </div>
      </div>

      {panelError ? (
        <div className="bg-rose-50 border border-rose-200 rounded-xl p-4 flex gap-3 items-center text-rose-600 font-medium text-sm">
          <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
          {panelError}
        </div>
      ) : null}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Credentials List */}
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden flex flex-col min-h-[400px]">
          <header className="px-5 py-4 border-b border-slate-100 bg-slate-50/50 flex flex-col relative overflow-hidden">
            <div className="absolute right-0 top-0 bottom-0 w-32 bg-gradient-to-l from-rose-50 to-transparent pointer-events-none" />
            <h3 className="m-0 text-sm font-bold text-slate-800">环境安全凭据注册表</h3>
          </header>
          {credentials.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center p-8 bg-slate-50/50 text-center">
              <div className="w-16 h-16 rounded-full bg-white border border-slate-200 flex items-center justify-center text-slate-300 mb-4 shadow-sm">
                <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" /></svg>
              </div>
              <span className="text-slate-500 font-bold mb-1">未托管任何全局凭据</span>
              <span className="text-sm text-slate-400">请使用上方表单发行您的第一个访问密钥。</span>
            </div>
          ) : (
            <div className="w-full overflow-x-auto">
              <table className="w-full text-left border-collapse text-sm whitespace-nowrap">
                <thead>
                  <tr className="bg-white text-slate-500 border-b border-slate-200">
                    <th className="font-bold py-3.5 px-5 text-xs uppercase tracking-wider w-[120px]">名称别名</th>
                    <th className="font-bold py-3.5 px-5 text-xs uppercase tracking-wider w-[120px]">审计 ID</th>
                    <th className="font-bold py-3.5 px-5 text-xs uppercase tracking-wider min-w-[200px]">行为鉴证操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {credentials.map(item => (
                    <tr key={item.credentialId} className="hover:bg-slate-50 transition-colors">
                      <td className="py-4 px-5 align-top">
                        <div className="flex flex-col gap-1">
                          <span className="font-bold text-slate-800">{item.name}</span>
                          {item.description && <span className="text-slate-500 text-xs truncate max-w-[150px]" title={item.description}>{item.description}</span>}
                        </div>
                      </td>
                      <td className="py-4 px-5 align-top">
                        <div className="flex flex-col gap-1.5">
                          <span className="text-xs font-mono font-bold text-slate-500 bg-slate-100/50 px-2 py-0.5 rounded border border-slate-200/50 select-all w-fit">
                            {item.credentialId}
                          </span>
                          <span className="text-[10px] text-slate-400 font-mono tracking-tight">{new Date(item.updatedAt).toLocaleDateString("zh-CN")}</span>
                        </div>
                      </td>
                      <td className="py-4 px-5 align-top">
                        <div className="flex flex-col gap-2">
                          <button
                            type="button"
                            className="text-xs font-bold text-slate-600 hover:text-slate-900 bg-white hover:bg-slate-100 px-3 py-1.5 rounded-lg transition-colors border border-slate-200 shadow-sm w-fit flex items-center gap-1.5"
                            onClick={() => void revealSecret(item.credentialId)}
                          >
                            <svg className="w-3.5 h-3.5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                            向审计员解密内容
                          </button>
                          {revealed[item.credentialId] && (
                            <div className="relative group/secret">
                              <code className="block bg-slate-900 text-emerald-400 p-2.5 rounded-lg text-xs font-mono font-bold select-all break-all overflow-hidden border border-slate-800 shadow-inner">
                                {revealed[item.credentialId]}
                              </code>
                              <span className="absolute top-1 right-2 text-[9px] text-slate-500 uppercase tracking-widest font-bold">Revealed</span>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="border-t border-slate-200 bg-slate-50 px-4 py-3 flex items-center justify-between gap-3 text-sm">
            <div className="text-slate-600">
              共 {credentialsTotal} 条，第 {credentialsPage} / {credentialsTotalPages} 页
            </div>
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-2 text-slate-600">
                每页
                <select
                  className="px-2 py-1 border border-slate-300 rounded"
                  value={credentialsPageSize}
                  onChange={event => {
                    setCredentialsPageSize(Number(event.target.value));
                    setCredentialsPage(1);
                  }}
                >
                  {PAGE_SIZE_OPTIONS.map(size => (
                    <option key={size} value={size}>
                      {size}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="px-3 py-1.5 rounded border border-slate-300 text-slate-700 disabled:opacity-50"
                disabled={credentialsPage <= 1 || loading}
                onClick={() => setCredentialsPage(previous => Math.max(1, previous - 1))}
              >
                上一页
              </button>
              <button
                type="button"
                className="px-3 py-1.5 rounded border border-slate-300 text-slate-700 disabled:opacity-50"
                disabled={credentialsPage >= credentialsTotalPages || loading}
                onClick={() => setCredentialsPage(previous => Math.min(credentialsTotalPages, previous + 1))}
              >
                下一页
              </button>
            </div>
          </div>
        </div>

        {/* Audit Logs */}
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden flex flex-col min-h-[400px]">
          <header className="px-5 py-4 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
            <h3 className="m-0 text-sm font-bold text-slate-800">行为鉴权与控制面审计流</h3>
            <span className="text-[10px] bg-slate-200 text-slate-600 px-2 py-0.5 rounded-full font-bold uppercase tracking-widest">{auditTotal} Events</span>
          </header>
          {auditRecords.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center p-8 bg-slate-50/50 text-center">
              <div className="w-16 h-16 rounded-full bg-white border border-slate-200 flex items-center justify-center text-slate-300 mb-4 shadow-sm">
                <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
              </div>
              <span className="text-slate-500 font-bold mb-1">审计日志池为空</span>
              <span className="text-sm text-slate-400">暂无任何凭证增删改查引发的安全操作事件。</span>
            </div>
          ) : (
            <div className="w-full overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs whitespace-nowrap">
                <thead>
                  <tr className="bg-white text-slate-500 border-b border-slate-200">
                    <th className="font-bold py-3 px-4 uppercase tracking-wider">触发时刻</th>
                    <th className="font-bold py-3 px-4 uppercase tracking-wider">动作语义</th>
                    <th className="font-bold py-3 px-4 uppercase tracking-wider">发起者凭证</th>
                    <th className="font-bold py-3 px-4 uppercase tracking-wider">受控客体</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-mono text-[11px]">
                  {auditRecords.map(item => (
                    <tr key={item.auditId} className="hover:bg-slate-50 transition-colors">
                      <td className="py-2.5 px-4 text-slate-500 align-middle">
                        {new Date(item.timestamp).toLocaleString("zh-CN", { hour12: false })}
                      </td>
                      <td className="py-2.5 px-4 align-middle">
                        <span className="bg-sky-50 text-sky-700 px-1.5 py-0.5 rounded border border-sky-100 font-bold opacity-80 uppercase tracking-wide">
                          {item.action}
                        </span>
                      </td>
                      <td className="py-2.5 px-4 font-bold text-slate-800 align-middle">
                        {item.actor}
                      </td>
                      <td className="py-2.5 px-4 text-slate-600 align-middle truncate max-w-[150px]" title={item.target}>
                        {item.target}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="border-t border-slate-200 bg-slate-50 px-4 py-3 flex items-center justify-between gap-3 text-sm">
            <div className="text-slate-600">
              共 {auditTotal} 条，第 {auditPage} / {auditTotalPages} 页
            </div>
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-2 text-slate-600">
                每页
                <select
                  className="px-2 py-1 border border-slate-300 rounded"
                  value={auditPageSize}
                  onChange={event => {
                    setAuditPageSize(Number(event.target.value));
                    setAuditPage(1);
                  }}
                >
                  {PAGE_SIZE_OPTIONS.map(size => (
                    <option key={size} value={size}>
                      {size}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="px-3 py-1.5 rounded border border-slate-300 text-slate-700 disabled:opacity-50"
                disabled={auditPage <= 1 || loading}
                onClick={() => setAuditPage(previous => Math.max(1, previous - 1))}
              >
                上一页
              </button>
              <button
                type="button"
                className="px-3 py-1.5 rounded border border-slate-300 text-slate-700 disabled:opacity-50"
                disabled={auditPage >= auditTotalPages || loading}
                onClick={() => setAuditPage(previous => Math.min(auditTotalPages, previous + 1))}
              >
                下一页
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
