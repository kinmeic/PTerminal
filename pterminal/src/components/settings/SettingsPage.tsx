import { useEffect, useState } from 'react';
import { ArrowLeft, ChevronDown, Plus, Pencil, Trash2, Server, X, Check, Settings, Bot, Wand2, type LucideIcon } from 'lucide-react';
import { useAppStore } from '@/stores/appStore';
import { useI18n } from '@/i18n/I18nProvider';
import { LANGUAGE_OPTIONS } from '@/i18n/translations';
import { aiService } from '@/services/aiService';
import { SettingsTopBar } from '@/components/layout/TopBar';
import { loadProxyConfig, saveProxyConfig, type ProxyConfig } from '@/services/proxyService';
import type { AIConfig, AISettings, Command, SshShortcut } from '@/types';

type Section = 'general' | 'model' | 'ssh' | 'completion';

interface SettingsPageProps {
  onBack: () => void;
}

/**
 * Full-screen settings view with a left menu and a right content pane.
 */
export function SettingsPage({ onBack }: SettingsPageProps) {
  const [section, setSection] = useState<Section>('general');
  const leftWidth = useAppStore((s) => s.leftWidth);
  const { t } = useI18n();

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
              label={t('settings.menu.general')}
              icon={Settings}
              active={section === 'general'}
              onClick={() => setSection('general')}
            />
            <MenuItem
              label={t('settings.menu.model')}
              icon={Bot}
              active={section === 'model'}
              onClick={() => setSection('model')}
            />
            <MenuItem
              label={t('settings.menu.ssh')}
              icon={Server}
              active={section === 'ssh'}
              onClick={() => setSection('ssh')}
            />
            <MenuItem
              label={t('settings.menu.completion')}
              icon={Wand2}
              active={section === 'completion'}
              onClick={() => setSection('completion')}
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
          {section === 'completion' && <CompletionSettings />}
        </div>
      </div>
    </div>
  );
}

function MenuItem({
  label,
  icon: Icon,
  active,
  onClick,
}: {
  label: string;
  icon: LucideIcon;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className="terminal-item"
      style={{
        margin: '2px 8px',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        color: active ? 'var(--color-accent)' : 'var(--color-text-primary)',
        textTransform: 'none',
        letterSpacing: 0,
        fontWeight: active ? 600 : 400,
      }}
    >
      <Icon size={15} strokeWidth={1.75} style={{ flexShrink: 0 }} />
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
  const lineHeight = useAppStore((s) => s.lineHeight);
  const terminalAutocompleteEnabled = useAppStore((s) => s.terminalAutocompleteEnabled);
  const aiAutocompleteEnabled = useAppStore((s) => s.autocompleteEnabled);
  const setTerminalFontFamily = useAppStore((s) => s.setTerminalFontFamily);
  const setDefaultFontSize = useAppStore((s) => s.setDefaultFontSize);
  const setLineHeight = useAppStore((s) => s.setLineHeight);
  const setTerminalAutocompleteEnabled = useAppStore((s) => s.setTerminalAutocompleteEnabled);
  const setAutocompleteEnabled = useAppStore((s) => s.setAutocompleteEnabled);
  const language = useAppStore((s) => s.language);
  const setLanguage = useAppStore((s) => s.setLanguage);
  const { t, effectiveLocale } = useI18n();

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
        {t('settings.general.title')}
      </h1>
      <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 28 }}>
        {t('settings.general.description')}
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div>
          <label style={labelStyle}>{t('settings.general.language')}</label>
          <div className="field-wrap">
            <select
              className="field-select"
              value={language ?? ''}
              onChange={(e) => {
                const v = e.target.value;
                setLanguage(v === '' ? null : (v as 'en' | 'zh-CN'));
              }}
            >
              {LANGUAGE_OPTIONS.map((opt) => (
                <option key={String(opt.value)} value={opt.value ?? ''}>
                  {opt.label[effectiveLocale]}
                </option>
              ))}
            </select>
            <span className="field-chevron">
              <ChevronDown size={16} strokeWidth={1.75} />
            </span>
          </div>
          <div style={hintStyle}>{t('settings.general.languageHint')}</div>
        </div>

        <div>
          <label style={labelStyle}>{t('settings.general.font')}</label>
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
            {t('settings.general.fontHint')}
          </div>
        </div>

        <div>
          <label style={labelStyle}>{t('settings.general.defaultFontSize')}</label>
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
            {t('settings.general.fontSizeHint')}
          </div>
        </div>

        <div>
          <label style={labelStyle}>{t('settings.general.lineHeight')}</label>
          <div className="field-wrap">
            <select
              className="field-select"
              value={String(lineHeight)}
              onChange={(e) => void setLineHeight(Number(e.target.value))}
            >
              <option value="0.8">{t('lineHeight.compact')}</option>
              <option value="0.9">{t('lineHeight.tight')}</option>
              <option value="1">{t('lineHeight.standard')}</option>
              <option value="1.1">{t('lineHeight.loose')}</option>
              <option value="1.2">{t('lineHeight.wide')}</option>
              <option value="1.3">{t('lineHeight.wider')}</option>
              <option value="1.5">{t('lineHeight.widest')}</option>
            </select>
            <span className="field-chevron">
              <ChevronDown size={16} strokeWidth={1.75} />
            </span>
          </div>
          <div style={hintStyle}>
            {t('settings.general.lineHeightHint')}
          </div>
        </div>

        <div>
          <label style={labelStyle}>{t('settings.general.autocompleteGroup')}</label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <SettingsCheckbox
              label={t('settings.general.enableCompletion')}
              checked={terminalAutocompleteEnabled}
              onChange={(checked) => void setTerminalAutocompleteEnabled(checked)}
            />
            <SettingsCheckbox
              label={t('settings.general.enableAiCompletion')}
              checked={aiAutocompleteEnabled}
              disabled={!terminalAutocompleteEnabled}
              onChange={(checked) => void setAutocompleteEnabled(checked)}
            />
          </div>
          <div style={hintStyle}>
            {t('settings.general.autocompleteHint')}
          </div>
        </div>
      </div>

      <SocksProxySection />
    </div>
  );
}

/** SOCKS5 proxy config (需求 3). Persists to settings + rebuilds the live
 * HTTP client via `proxy_reload`. Applies to AI and HTTP traffic
 * independently, and bypasses localhost/LAN automatically. */
function SocksProxySection() {
  const [cfg, setCfg] = useState<ProxyConfig>({ socksUrl: '', applyAi: true, applyHttp: true });
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const { t } = useI18n();

  useEffect(() => {
    let cancelled = false;
    void loadProxyConfig()
      .then((c) => {
        if (!cancelled) {
          setCfg(c);
          setLoaded(true);
        }
      })
      .catch(() => setLoaded(true));
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    try {
      await saveProxyConfig(cfg);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
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
    <>
      <div style={{ height: 1, backgroundColor: 'var(--color-border)', margin: '12px 0' }} />
      <h2
        style={{
          fontSize: 14,
          fontWeight: 600,
          margin: '0 0 4px',
          color: 'var(--color-text-primary)',
        }}
      >
        {t('settings.proxy.title')}
      </h2>
      <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 16 }}>
        {t('settings.proxy.description')}
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <label style={labelStyle}>{t('settings.proxy.address')}</label>
          <input
            type="text"
            value={cfg.socksUrl}
            onChange={(e) => setCfg((c) => ({ ...c, socksUrl: e.target.value }))}
            placeholder="socks5://127.0.0.1:1080"
            disabled={!loaded}
            style={inputStyle}
          />
          <div style={hintStyle}>
            {t('settings.proxy.emptyDirect')} <code>socks5://</code> / <code>socks5h://</code>{' '}
            {t('settings.proxy.dnsHint')}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <ProxyCheckbox
            label={t('settings.proxy.applyAi')}
            checked={cfg.applyAi}
            onChange={(v) => setCfg((c) => ({ ...c, applyAi: v }))}
          />
          <ProxyCheckbox
            label={t('settings.proxy.applyHttp')}
            checked={cfg.applyHttp}
            onChange={(v) => setCfg((c) => ({ ...c, applyHttp: v }))}
          />
        </div>

        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <button
            className="btn btn-primary"
            onClick={handleSave}
            disabled={saving || !loaded}
          >
            {saving ? t('settings.proxy.saving') : t('settings.proxy.saveApply')}
          </button>
          {saved && (
            <span style={{ fontSize: 12, color: 'var(--color-success)' }}>{t('settings.proxy.applied')}</span>
          )}
        </div>
      </div>
    </>
  );
}

function SettingsCheckbox({
  label,
  checked,
  onChange,
  disabled = false,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        cursor: disabled ? 'not-allowed' : 'pointer',
        fontSize: 13,
        color: 'var(--color-text-primary)',
        opacity: disabled ? 0.55 : 1,
        userSelect: 'none',
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        style={{ width: 15, height: 15, accentColor: 'var(--color-accent)' }}
      />
      {label}
    </label>
  );
}

const ProxyCheckbox = SettingsCheckbox;

function ModelSettings() {
  const aiConfig = useAppStore((s) => s.aiConfig);
  const saveAiConfig = useAppStore((s) => s.saveAiConfig);
  const loadAiConfig = useAppStore((s) => s.loadAiConfig);
  const { t } = useI18n();

  const [provider, setProvider] = useState('openai');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [contextLines, setContextLines] = useState(50);
  const [contextWindow, setContextWindow] = useState(200000);
  const [compressionThreshold, setCompressionThreshold] = useState(0.75);
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
      setContextWindow((aiConfig as AIConfig).contextWindow ?? 200000);
      setCompressionThreshold((aiConfig as AIConfig).compressionThreshold ?? 0.75);
      setApiKey('');
    }
  }, [aiConfig]);

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    const settings: AISettings = { provider };
    if (baseUrl.trim()) settings.baseUrl = baseUrl.trim();
    if (model.trim()) settings.model = model.trim();
    if (apiKey.trim()) settings.apiKey = apiKey.trim();
    settings.terminalContextLines = contextLines;
    settings.contextWindow = contextWindow;
    settings.compressionThreshold = compressionThreshold;
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
        {t('settings.model.title')}
      </h1>
      <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 28 }}>
        {t('settings.model.description')}
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div>
          <label style={labelStyle}>{t('settings.model.provider')}</label>
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
                  ollama: 'http://localhost:11434',
                  deepseek: 'https://api.deepseek.com',
                };
                if (presets[p] && (!baseUrl || Object.values(presets).includes(baseUrl))) {
                  setBaseUrl(presets[p]);
                }
              }}
            >
              <option value="openai">{t('settings.model.openaiCompatible')}</option>
              <option value="ollama">{t('settings.model.ollamaLocal')}</option>
              <option value="deepseek">DeepSeek</option>
            </select>
            <span className="field-chevron">
              <ChevronDown size={16} strokeWidth={1.75} />
            </span>
          </div>
        </div>

        <div>
          <label style={labelStyle}>{t('settings.model.baseUrl')}</label>
          <input
            type="text"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://api.openai.com"
            style={fieldStyle}
          />
          <div style={hintStyle}>
            {t('settings.model.baseUrlHint')} <code>https://api.openai.com</code>
          </div>
        </div>

        <div>
          <label style={labelStyle}>
            {t('settings.model.apiKey')}{' '}
            {aiConfig?.hasApiKey && (
              <span style={{ color: 'var(--color-success)', fontWeight: 400 }}>
                {t('settings.model.apiKeySet')}
              </span>
            )}
          </label>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={provider === 'ollama' ? t('settings.model.apiKeyPlaceholderOllama') : 'sk-...'}
            style={fieldStyle}
          />
        </div>

        <div>
          <label style={labelStyle}>{t('settings.model.model')}</label>
          <input
            type="text"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder={
              provider === 'ollama'
                ? 'llama3.2'
                : provider === 'deepseek'
                  ? 'deepseek-chat'
                  : 'gpt-4o-mini'
            }
            style={fieldStyle}
          />
          <div style={hintStyle}>{t('settings.model.modelHint')}</div>
        </div>

        <div>
          <label style={labelStyle}>{t('settings.model.contextLines')}</label>
          <div className="field-wrap">
            <select
              className="field-select"
              value={String(contextLines)}
              onChange={(e) => setContextLines(Number(e.target.value))}
            >
              <option value="0">{t('settings.model.contextLinesNone')}</option>
              <option value="20">20</option>
              <option value="50">50{t('settings.model.contextLinesDefault')}</option>
              <option value="100">100</option>
              <option value="200">200</option>
              <option value="500">500</option>
            </select>
            <span className="field-chevron">
              <ChevronDown size={16} strokeWidth={1.75} />
            </span>
          </div>
          <div style={hintStyle}>
            {t('settings.model.contextLinesHint')}
          </div>
        </div>

        <div>
          <label style={labelStyle}>{t('settings.model.contextWindow')}</label>
          <input
            type="number"
            value={contextWindow}
            onChange={(e) => setContextWindow(Number(e.target.value) || 200000)}
            min={1000}
            max={1000000}
            step={1000}
            style={fieldStyle}
          />
          <div style={hintStyle}>
            {t('settings.model.contextWindowHint')}
          </div>
        </div>

        <div>
          <label style={labelStyle}>{t('settings.model.compressionThreshold')}</label>
          <input
            type="number"
            value={compressionThreshold}
            onChange={(e) => setCompressionThreshold(Number(e.target.value) || 0.75)}
            min={0.1}
            max={1.0}
            step={0.05}
            style={fieldStyle}
          />
          <div style={hintStyle}>
            {t('settings.model.compressionThresholdHint')}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 8, alignItems: 'center' }}>
          <button
            className="btn btn-primary"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? t('settings.proxy.saving') : t('common.save')}
          </button>
          <button className="btn btn-secondary" onClick={handleTest} disabled={testing}>
            {testing ? t('settings.model.testing') : t('settings.model.testConnection')}
          </button>
          {saved && (
            <span style={{ fontSize: 12, color: 'var(--color-success)' }}>{t('settings.model.saved')}</span>
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
  const { t } = useI18n();

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
          title={t('settings.ssh.backToList')}
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
          {editingId ? t('settings.ssh.editTitle') : t('settings.ssh.newTitle')}
        </h1>
        <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 24 }}>
          {editingId ? t('settings.ssh.editDesc') : t('settings.ssh.newDesc')}
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
          {t('settings.ssh.listTitle')}
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
          {t('common.new')}
        </button>
      </div>
      <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 24 }}>
        {t('settings.ssh.listDesc')}
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
            {t('settings.ssh.empty')}
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
  const { t } = useI18n();
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
      <button className="btn-icon" title={t('common.edit')} onClick={onEdit} style={{ width: 28, height: 28, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
        <Pencil size={14} strokeWidth={1.75} />
      </button>
      <button className="btn-icon" title={t('common.delete')} onClick={onDelete} style={{ width: 28, height: 28, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-danger)' }}>
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
  const { t } = useI18n();
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
        <label style={labelStyle}>{t('settings.ssh.name')}</label>
        <input
          type="text"
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          placeholder={t('settings.ssh.namePlaceholder')}
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
        <label style={labelStyle}>{t('settings.ssh.user')}</label>
        <input
          type="text"
          value={form.user}
          onChange={(e) => setForm((f) => ({ ...f, user: e.target.value }))}
          placeholder="root"
          style={inputStyle}
        />
      </div>

      <div>
        <label style={labelStyle}>{t('settings.ssh.identityFile')}</label>
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
          {t('settings.ssh.password')}{' '}
          {editingId && (
            <span style={{ color: 'var(--color-success)', fontWeight: 400 }}>
              {t('settings.model.apiKeySet')}
            </span>
          )}
        </label>
        <input
          type="password"
          value={form.password}
          onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
          placeholder={editingId ? t('settings.ssh.passwordKeep') : t('settings.ssh.passwordNewPlaceholder')}
          style={inputStyle}
        />
        <div style={{ fontSize: 11, color: 'var(--color-warning)', marginTop: 4 }}>
          {t('settings.ssh.passwordWarning')}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-start' }}>
        <button type="button" className="btn btn-secondary" onClick={onCancel}>
          <X size={14} strokeWidth={1.75} />
          {t('common.cancel')}
        </button>
        <button
          type="submit"
          className="btn btn-primary"
          disabled={!form.name.trim() || !form.host.trim() || !form.user.trim()}
        >
          <Check size={14} strokeWidth={1.75} />
          {editingId ? t('common.save') : t('common.add')}
        </button>
      </div>
    </form>
  );
}

// ---- Custom completions management -----------------------------------------

const emptyCompletionForm = { label: '', command: '' };
type CompletionForm = typeof emptyCompletionForm;

function CompletionSettings() {
  const completions = useAppStore((s) => s.customCompletions);
  const addCompletion = useAppStore((s) => s.addCustomCompletion);
  const editCompletion = useAppStore((s) => s.editCustomCompletion);
  const removeCompletion = useAppStore((s) => s.removeCustomCompletion);
  const { t } = useI18n();

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<CompletionForm>(emptyCompletionForm);

  const resetForm = () => {
    setForm(emptyCompletionForm);
    setEditingId(null);
    setShowForm(false);
  };

  const startEdit = (c: Command) => {
    setForm({ label: c.label, command: c.command });
    setEditingId(c.id);
    setShowForm(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.command.trim()) return;
    const payload = { label: form.label.trim(), command: form.command.trim() };
    if (editingId) {
      await editCompletion(editingId, payload);
    } else {
      await addCompletion(payload);
    }
    resetForm();
  };

  if (showForm) {
    return (
      <div style={{ width: '100%', maxWidth: 560, padding: '32px 40px' }}>
        <button
          className="collapse-button"
          onClick={resetForm}
          title={t('settings.ssh.backToList')}
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
          {editingId ? t('settings.completion.editTitle') : t('settings.completion.newTitle')}
        </h1>
        <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 24 }}>
          {t('settings.completion.newDesc')}
        </p>
        <CompletionFormView
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
          {t('settings.completion.listTitle')}
        </h1>
        <button
          className="btn btn-primary"
          onClick={() => {
            setForm(emptyCompletionForm);
            setEditingId(null);
            setShowForm(true);
          }}
          style={{ fontSize: 12, padding: '5px 12px' }}
        >
          <Plus size={14} strokeWidth={1.75} />
          {t('common.new')}
        </button>
      </div>
      <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 24 }}>
        {t('settings.completion.listDesc')}
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {completions.length === 0 ? (
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
            {t('settings.completion.empty')}
          </div>
        ) : (
          completions.map((c) => (
            <CompletionRow
              key={c.id}
              completion={c}
              onEdit={() => startEdit(c)}
              onDelete={() => void removeCompletion(c.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}

function CompletionRow({
  completion,
  onEdit,
  onDelete,
}: {
  completion: Command;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { t } = useI18n();
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
        <Wand2 size={16} strokeWidth={1.75} />
      </span>
      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
        <span style={{ fontSize: 13, color: 'var(--color-text-primary)' }}>{completion.label}</span>
        <span
          style={{
            fontSize: 11,
            fontFamily: 'var(--font-mono)',
            color: 'var(--color-text-muted)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={completion.command}
        >
          {completion.command}
        </span>
      </div>
      <button className="btn-icon" title={t('common.edit')} onClick={onEdit} style={{ width: 28, height: 28, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
        <Pencil size={14} strokeWidth={1.75} />
      </button>
      <button className="btn-icon" title={t('common.delete')} onClick={onDelete} style={{ width: 28, height: 28, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-danger)' }}>
        <Trash2 size={14} strokeWidth={1.75} />
      </button>
    </div>
  );
}

function CompletionFormView({
  form,
  setForm,
  editingId,
  onSubmit,
  onCancel,
}: {
  form: CompletionForm;
  setForm: React.Dispatch<React.SetStateAction<CompletionForm>>;
  editingId: string | null;
  onSubmit: (e: React.FormEvent) => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
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
        <label style={labelStyle}>{t('settings.completion.command')}</label>
        <input
          type="text"
          value={form.command}
          onChange={(e) => setForm((f) => ({ ...f, command: e.target.value }))}
          placeholder="git push --force-with-lease"
          style={{ ...inputStyle, fontFamily: 'var(--font-mono)' }}
          autoFocus
        />
        <div style={hintStyle}>
          {t('settings.completion.commandHint')}
        </div>
      </div>

      <div>
        <label style={labelStyle}>{t('settings.completion.note')}</label>
        <input
          type="text"
          value={form.label}
          onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
          placeholder={t('settings.completion.notePlaceholder')}
          style={inputStyle}
        />
        <div style={hintStyle}>{t('settings.completion.noteHint')}</div>
      </div>

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-start' }}>
        <button type="button" className="btn btn-secondary" onClick={onCancel}>
          <X size={14} strokeWidth={1.75} />
          {t('common.cancel')}
        </button>
        <button type="submit" className="btn btn-primary" disabled={!form.command.trim()}>
          <Check size={14} strokeWidth={1.75} />
          {editingId ? t('common.save') : t('common.add')}
        </button>
      </div>
    </form>
  );
}
