import { useEffect, useState } from 'react';
import { ArrowLeft, ChevronDown, Plus, Pencil, Trash2, Server, X, Check } from 'lucide-react';
import { useAppStore } from '@/stores/appStore';
import { aiService } from '@/services/aiService';
import { SettingsTopBar } from '@/components/layout/TopBar';
import type { AIConfig, SshShortcut } from '@/types';

type Section = 'general' | 'model' | 'ssh';

interface SettingsPageProps {
  onBack: () => void;
}

/**
 * Full-screen settings view with a left menu and a right content pane.
 */
export function SettingsPage({ onBack }: SettingsPageProps) {
  const [section, setSection] = useState<Section>('general');
  const leftWidth = useAppStore((s) => s.leftWidth);

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden" style={{ backgroundColor: 'var(--color-bg-primary)' }}>
      <SettingsTopBar onBack={onBack} />

      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Left menu */}
        <div
          className="flex flex-col h-full"
          style={{
            width: leftWidth,
            flexShrink: 0,
            borderRight: '1px solid var(--color-border)',
            backgroundColor: 'var(--color-sidebar-left)',
          }}
        >
          <div className="flex-1 overflow-y-auto py-2">
            <MenuItem
              label="常规"
              active={section === 'general'}
              onClick={() => setSection('general')}
            />
            <MenuItem
              label="大模型设置"
              active={section === 'model'}
              onClick={() => setSection('model')}
            />
            <MenuItem
              label="SSH 快捷方式"
              active={section === 'ssh'}
              onClick={() => setSection('ssh')}
            />
          </div>
        </div>

        {/* Right content */}
        <div
          className="flex-1 min-w-0 h-full overflow-y-auto"
          style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}
        >
          {section === 'general' && <GeneralSettings />}
          {section === 'model' && <ModelSettings />}
          {section === 'ssh' && <SshSettings />}
        </div>
      </div>
    </div>
  );
}

function MenuItem({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className="terminal-item"
      style={{
        margin: '2px 8px',
        color: active ? 'var(--color-accent)' : 'var(--color-text-primary)',
        textTransform: 'none',
        letterSpacing: 0,
        fontWeight: active ? 600 : 400,
      }}
    >
      <span>{label}</span>
    </div>
  );
}

/** Common monospace font stacks offered in the picker. */
const FONT_OPTIONS: { label: string; value: string }[] = [
  { label: 'SF Mono', value: "'SF Mono', 'Monaco', 'Consolas', monospace" },
  { label: 'Monaco', value: "'Monaco', 'Menlo', 'Consolas', monospace" },
  { label: 'Menlo', value: "'Menlo', 'Monaco', 'Consolas', monospace" },
  { label: 'Consolas', value: "'Consolas', 'Menlo', 'Monaco', monospace" },
  { label: 'Fira Code', value: "'Fira Code', 'SF Mono', 'Consolas', monospace" },
  { label: 'JetBrains Mono', value: "'JetBrains Mono', 'SF Mono', 'Consolas', monospace" },
  { label: 'Source Code Pro', value: "'Source Code Pro', 'SF Mono', 'Consolas', monospace" },
  { label: 'Courier New', value: "'Courier New', 'Courier', monospace" },
];

const FONT_SIZE_OPTIONS = [8, 9, 10, 11, 12, 13, 14, 15, 16, 18, 20, 24, 28, 32];

function GeneralSettings() {
  const fontFamily = useAppStore((s) => s.fontFamily);
  const fontSize = useAppStore((s) => s.fontSize);
  const setTerminalFontFamily = useAppStore((s) => s.setTerminalFontFamily);
  const setDefaultFontSize = useAppStore((s) => s.setDefaultFontSize);

  const labelStyle: React.CSSProperties = {
    fontSize: 12,
    fontWeight: 500,
    color: 'var(--color-text-secondary)',
    marginBottom: 6,
    display: 'block',
  };
  const hintStyle: React.CSSProperties = {
    fontSize: 11,
    color: 'var(--color-text-muted)',
    marginTop: 4,
  };

  return (
    <div style={{ width: '100%', maxWidth: 560, padding: '32px 40px' }}>
      <h1
        style={{
          fontSize: 20,
          fontWeight: 600,
          marginBottom: 6,
          color: 'var(--color-text-primary)',
        }}
      >
        常规
      </h1>
      <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 28 }}>
        配置终端字体与默认字号。字体对所有终端生效；默认字号用于新建终端，已有终端的字号可在顶部栏单独调整。
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div>
          <label style={labelStyle}>字体</label>
          <div className="field-wrap">
            <select
              className="field-select"
              value={
                FONT_OPTIONS.find((f) => f.value === fontFamily)?.value ??
                FONT_OPTIONS[0].value
              }
              onChange={(e) => void setTerminalFontFamily(e.target.value)}
            >
              {FONT_OPTIONS.map((f) => (
                <option key={f.label} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
            <span className="field-chevron">
              <ChevronDown size={16} strokeWidth={1.75} />
            </span>
          </div>
          <div style={hintStyle}>
            仅当系统已安装所选字体时生效，否则回退到默认等宽字体。
          </div>
        </div>

        <div>
          <label style={labelStyle}>默认字号</label>
          <div className="field-wrap">
            <select
              className="field-select"
              value={String(fontSize)}
              onChange={(e) => {
                const next = Number(e.target.value);
                if (next) void setDefaultFontSize(next);
              }}
            >
              {FONT_SIZE_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s} px
                </option>
              ))}
            </select>
            <span className="field-chevron">
              <ChevronDown size={16} strokeWidth={1.75} />
            </span>
          </div>
          <div style={hintStyle}>
            新建终端的初始字号（基准 13px = 100%）。已有终端可用顶部栏 +/− 单独缩放。
          </div>
        </div>
      </div>
    </div>
  );
}

function ModelSettings() {
  const aiConfig = useAppStore((s) => s.aiConfig);
  const saveAiConfig = useAppStore((s) => s.saveAiConfig);
  const loadAiConfig = useAppStore((s) => s.loadAiConfig);

  const [provider, setProvider] = useState('openai');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [contextLines, setContextLines] = useState(50);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  useEffect(() => {
    void loadAiConfig();
  }, [loadAiConfig]);

  useEffect(() => {
    if (aiConfig) {
      setProvider((aiConfig as AIConfig).provider ?? 'openai');
      setBaseUrl((aiConfig as AIConfig).baseUrl ?? '');
      setModel((aiConfig as AIConfig).model ?? '');
      setContextLines((aiConfig as AIConfig).terminalContextLines ?? 50);
      setApiKey('');
    }
  }, [aiConfig]);

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    const settings: Record<string, string> = { provider };
    if (baseUrl.trim()) settings.baseUrl = baseUrl.trim();
    if (model.trim()) settings.model = model.trim();
    if (apiKey.trim()) settings.apiKey = apiKey.trim();
    settings.terminalContextLines = String(contextLines);
    await saveAiConfig(settings);
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      // Test against the currently SAVED config, so save first if you changed it.
      const result = await aiService.test();
      setTestResult(result);
    } catch (e) {
      setTestResult({ ok: false, message: String(e) });
    } finally {
      setTesting(false);
    }
  };

  const fieldStyle: React.CSSProperties = {
    width: '100%',
    padding: '8px 10px',
    borderRadius: 6,
    border: '1px solid var(--color-border)',
    backgroundColor: 'var(--color-bg-primary)',
    color: 'var(--color-text-primary)',
    fontSize: 13,
    outline: 'none',
  };
  const labelStyle: React.CSSProperties = {
    fontSize: 12,
    fontWeight: 500,
    color: 'var(--color-text-secondary)',
    marginBottom: 6,
    display: 'block',
  };
  const hintStyle: React.CSSProperties = {
    fontSize: 11,
    color: 'var(--color-text-muted)',
    marginTop: 4,
  };

  return (
    <div style={{ width: '100%', maxWidth: 560, padding: '32px 40px' }}>
      <h1
        style={{
          fontSize: 20,
          fontWeight: 600,
          marginBottom: 6,
          color: 'var(--color-text-primary)',
        }}
      >
        大模型设置
      </h1>
      <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 28 }}>
        配置 OpenAI 兼容的大模型服务（OpenAI、Ollama、DeepSeek、Moonshot 等）。
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div>
          <label style={labelStyle}>Provider</label>
          <div className="field-wrap">
            <select
              className="field-select"
              value={provider}
              onChange={(e) => {
                const p = e.target.value;
                setProvider(p);
                // Preset common base URLs when the field is empty or matches a known preset.
                const presets: Record<string, string> = {
                  openai: 'https://api.openai.com',
                  anthropic: 'https://api.anthropic.com',
                  ollama: 'http://localhost:11434',
                  deepseek: 'https://api.deepseek.com',
                  moonshot: 'https://api.moonshot.cn',
                };
                if (presets[p] && (!baseUrl || Object.values(presets).includes(baseUrl))) {
                  setBaseUrl(presets[p]);
                }
              }}
            >
              <option value="openai">OpenAI</option>
              <option value="anthropic">Anthropic (Claude)</option>
              <option value="ollama">Ollama (本地)</option>
              <option value="deepseek">DeepSeek</option>
              <option value="moonshot">Moonshot (Kimi)</option>
            </select>
            <span className="field-chevron">
              <ChevronDown size={16} strokeWidth={1.75} />
            </span>
          </div>
        </div>

        <div>
          <label style={labelStyle}>Base URL</label>
          <input
            type="text"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://api.openai.com"
            style={fieldStyle}
          />
          <div style={hintStyle}>
            OpenAI 兼容端点，不要带 <code>/v1</code> 后缀。例如：<code>https://api.openai.com</code>
          </div>
        </div>

        <div>
          <label style={labelStyle}>
            API Key{' '}
            {aiConfig?.hasApiKey && (
              <span style={{ color: 'var(--color-success)', fontWeight: 400 }}>
                （已设置，留空则保持不变）
              </span>
            )}
          </label>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={provider === 'ollama' ? '本地模型无需 API Key' : 'sk-...'}
            style={fieldStyle}
          />
        </div>

        <div>
          <label style={labelStyle}>Model</label>
          <input
            type="text"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder={
              provider === 'ollama'
                ? 'llama3.2'
                : provider === 'anthropic'
                  ? 'claude-3-5-sonnet-latest'
                  : 'gpt-4o-mini'
            }
            style={fieldStyle}
          />
          <div style={hintStyle}>模型名称，需与服务端可用模型一致。</div>
        </div>

        <div>
          <label style={labelStyle}>AI 读取终端行数</label>
          <div className="field-wrap">
            <select
              className="field-select"
              value={String(contextLines)}
              onChange={(e) => setContextLines(Number(e.target.value))}
            >
              <option value="0">不读取</option>
              <option value="20">20 行</option>
              <option value="50">50 行（默认）</option>
              <option value="100">100 行</option>
              <option value="200">200 行</option>
              <option value="500">500 行</option>
            </select>
            <span className="field-chevron">
              <ChevronDown size={16} strokeWidth={1.75} />
            </span>
          </div>
          <div style={hintStyle}>
            发送 AI 消息时，自动将当前终端最近 N 行输出作为上下文一并发出。设为「不读取」可保护隐私或节省 token。
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 8, alignItems: 'center' }}>
          <button
            className="btn btn-primary"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? '保存中…' : '保存'}
          </button>
          <button className="btn btn-secondary" onClick={handleTest} disabled={testing}>
            {testing ? '测试中…' : '测试连接'}
          </button>
          {saved && (
            <span style={{ fontSize: 12, color: 'var(--color-success)' }}>✓ 已保存</span>
          )}
          {testResult && (
            <span
              style={{
                fontSize: 12,
                color: testResult.ok ? 'var(--color-success)' : 'var(--color-danger)',
                maxWidth: 320,
              }}
              title={testResult.message}
            >
              {testResult.ok ? '✓ ' : '✗ '}
              {testResult.message}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ---- SSH shortcuts management ----------------------------------------------

const emptyForm = { name: '', host: '', port: '22', user: '', identityFile: '', password: '' };
type SshForm = typeof emptyForm;

function SshSettings() {
  const shortcuts = useAppStore((s) => s.sshShortcuts);
  const addSshShortcut = useAppStore((s) => s.addSshShortcut);
  const editSshShortcut = useAppStore((s) => s.editSshShortcut);
  const removeSshShortcut = useAppStore((s) => s.removeSshShortcut);

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<SshForm>(emptyForm);

  const resetForm = () => {
    setForm(emptyForm);
    setEditingId(null);
    setShowForm(false);
  };

  const startEdit = (s: SshShortcut) => {
    setForm({
      name: s.name,
      host: s.host,
      port: String(s.port),
      user: s.user,
      identityFile: s.identityFile ?? '',
      password: s.password ?? '',
    });
    setEditingId(s.id);
    setShowForm(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || !form.host.trim() || !form.user.trim()) return;
    const payload = {
      name: form.name.trim(),
      host: form.host.trim(),
      port: Number(form.port) || 22,
      user: form.user.trim(),
      identityFile: form.identityFile.trim() || undefined,
      // New: omit password when blank (don't store). Edit: blank clears it.
      password: form.password || (editingId ? '' : undefined),
    };
    if (editingId) {
      await editSshShortcut(editingId, payload);
    } else {
      await addSshShortcut(payload);
    }
    resetForm();
  };

  // Form view replaces the list (independent page).
  if (showForm) {
    return (
      <div style={{ width: '100%', maxWidth: 560, padding: '32px 40px' }}>
        <button
          className="collapse-button"
          onClick={resetForm}
          title="返回列表"
          style={{ marginBottom: 16 }}
        >
          <ArrowLeft size={16} strokeWidth={1.75} />
        </button>
        <h1
          style={{
            fontSize: 20,
            fontWeight: 600,
            marginBottom: 6,
            color: 'var(--color-text-primary)',
          }}
        >
          {editingId ? '编辑 SSH 快捷方式' : '新建 SSH 快捷方式'}
        </h1>
        <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 24 }}>
          {editingId ? '修改连接信息，保存后立即生效。' : '填写连接信息，保存后可在左侧边栏快速连接。'}
        </p>
        <SshFormView
          form={form}
          setForm={setForm}
          editingId={editingId}
          onSubmit={handleSubmit}
          onCancel={resetForm}
        />
      </div>
    );
  }

  return (
    <div style={{ width: '100%', maxWidth: 640, padding: '32px 40px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <h1
          style={{
            fontSize: 20,
            fontWeight: 600,
            color: 'var(--color-text-primary)',
          }}
        >
          SSH 快捷方式
        </h1>
        <button
          className="btn btn-primary"
          onClick={() => {
            setForm(emptyForm);
            setEditingId(null);
            setShowForm(true);
          }}
          style={{ fontSize: 12, padding: '5px 12px' }}
        >
          <Plus size={14} strokeWidth={1.75} />
          新建
        </button>
      </div>
      <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 24 }}>
        管理常用的 SSH 连接。在左侧边栏点击快捷方式即可快速打开新终端并连接。
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {shortcuts.length === 0 ? (
          <div
            style={{
              padding: '32px 16px',
              textAlign: 'center',
              color: 'var(--color-text-muted)',
              fontSize: 13,
              border: '1px dashed var(--color-border)',
              borderRadius: 8,
            }}
          >
            暂无 SSH 快捷方式，点击「新建」添加。
          </div>
        ) : (
          shortcuts.map((s) => (
            <SshRow
              key={s.id}
              shortcut={s}
              onEdit={() => startEdit(s)}
              onDelete={() => void removeSshShortcut(s.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}

function SshRow({
  shortcut,
  onEdit,
  onDelete,
}: {
  shortcut: SshShortcut;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const hostLabel = `${shortcut.user}@${shortcut.host}${shortcut.port !== 22 ? `:${shortcut.port}` : ''}`;
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '10px 12px',
        borderRadius: 8,
        border: '1px solid var(--color-border)',
        backgroundColor: 'var(--color-bg-secondary)',
      }}
    >
      <span style={{ display: 'inline-flex', color: 'var(--color-accent)' }}>
        <Server size={16} strokeWidth={1.75} />
      </span>
      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
        <span style={{ fontSize: 13, color: 'var(--color-text-primary)' }}>{shortcut.name}</span>
        <span
          style={{
            fontSize: 11,
            fontFamily: 'var(--font-mono)',
            color: 'var(--color-text-muted)',
          }}
          title={hostLabel}
        >
          {hostLabel}
          {shortcut.identityFile ? `  ·  -i ${shortcut.identityFile}` : ''}
        </span>
      </div>
      <button className="btn-icon" title="编辑" onClick={onEdit} style={{ width: 28, height: 28, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
        <Pencil size={14} strokeWidth={1.75} />
      </button>
      <button className="btn-icon" title="删除" onClick={onDelete} style={{ width: 28, height: 28, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-danger)' }}>
        <Trash2 size={14} strokeWidth={1.75} />
      </button>
    </div>
  );
}

function SshFormView({
  form,
  setForm,
  editingId,
  onSubmit,
  onCancel,
}: {
  form: SshForm;
  setForm: React.Dispatch<React.SetStateAction<SshForm>>;
  editingId: string | null;
  onSubmit: (e: React.FormEvent) => void;
  onCancel: () => void;
}) {
  const labelStyle: React.CSSProperties = {
    fontSize: 12,
    fontWeight: 500,
    color: 'var(--color-text-secondary)',
    marginBottom: 6,
    display: 'block',
  };
  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '8px 10px',
    borderRadius: 6,
    border: '1px solid var(--color-border)',
    backgroundColor: 'var(--color-bg-primary)',
    color: 'var(--color-text-primary)',
    fontSize: 13,
    outline: 'none',
  };

  return (
    <form
      onSubmit={onSubmit}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
      }}
    >
      <div>
        <label style={labelStyle}>名称</label>
        <input
          type="text"
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          placeholder="生产服务器"
          style={inputStyle}
          autoFocus
        />
      </div>

      <div style={{ display: 'flex', gap: 12 }}>
        <div style={{ flex: 2 }}>
          <label style={labelStyle}>Host</label>
          <input
            type="text"
            value={form.host}
            onChange={(e) => setForm((f) => ({ ...f, host: e.target.value }))}
            placeholder="192.168.1.10"
            style={inputStyle}
          />
        </div>
        <div style={{ flex: 1 }}>
          <label style={labelStyle}>Port</label>
          <input
            type="number"
            value={form.port}
            onChange={(e) => setForm((f) => ({ ...f, port: e.target.value }))}
            placeholder="22"
            style={inputStyle}
          />
        </div>
      </div>

      <div>
        <label style={labelStyle}>用户名</label>
        <input
          type="text"
          value={form.user}
          onChange={(e) => setForm((f) => ({ ...f, user: e.target.value }))}
          placeholder="root"
          style={inputStyle}
        />
      </div>

      <div>
        <label style={labelStyle}>Identity File（可选）</label>
        <input
          type="text"
          value={form.identityFile}
          onChange={(e) => setForm((f) => ({ ...f, identityFile: e.target.value }))}
          placeholder="~/.ssh/id_rsa"
          style={inputStyle}
        />
      </div>

      <div>
        <label style={labelStyle}>
          密码（可选）{' '}
          {editingId && (
            <span style={{ color: 'var(--color-success)', fontWeight: 400 }}>
              （已设置，留空则保持不变）
            </span>
          )}
        </label>
        <input
          type="password"
          value={form.password}
          onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
          placeholder={editingId ? '留空保持不变' : '仅限内网/测试机，密码明文存储'}
          style={inputStyle}
        />
        <div style={{ fontSize: 11, color: 'var(--color-warning)', marginTop: 4 }}>
          ⚠ 密码以明文存储在本地数据库，仅建议用于内网/测试环境。生产环境请使用密钥认证。
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-start' }}>
        <button type="button" className="btn btn-secondary" onClick={onCancel}>
          <X size={14} strokeWidth={1.75} />
          取消
        </button>
        <button
          type="submit"
          className="btn btn-primary"
          disabled={!form.name.trim() || !form.host.trim() || !form.user.trim()}
        >
          <Check size={14} strokeWidth={1.75} />
          {editingId ? '保存' : '添加'}
        </button>
      </div>
    </form>
  );
}
