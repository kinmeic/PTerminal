import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Send, Square } from 'lucide-react';
import { useAppStore } from '@/stores/appStore';
import { aiService } from '@/services/aiService';
import { terminalRegistry } from '@/services/terminalRegistry';
import type { AIMessage } from '@/types';

/**
 * AI conversation panel bound to the active terminal's context. Standard chat
 * layout: a scrollable message list on top, a fixed input bar at the bottom.
 * Streams the assistant reply token-by-token via the global `useAIStream` hook.
 */
export function AIChatPanel() {
  const activeTerminalId = useAppStore((s) => s.activeTerminalId);
  const aiMessages = useAppStore((s) => s.aiMessages);
  const isAiStreaming = useAppStore((s) => s.isAiStreaming);
  const aiMessagesTotal = useAppStore((s) => s.aiMessagesTotal);
  const loadAiMessages = useAppStore((s) => s.loadAiMessages);
  const aiConfig = useAppStore((s) => s.aiConfig);
  const runSuggestedCommand = useAppStore((s) => s.runSuggestedCommand);
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  /** Resize the textarea to fit its content, clamped to a max height (≈6 lines).
   * Called on every input change and after the field is cleared on send. */
  const autoResize = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  };

  useEffect(() => {
    autoResize();
  }, [input]);

  // Load persisted chat history when switching terminals.
  useEffect(() => {
    if (activeTerminalId) void loadAiMessages(activeTerminalId);
  }, [activeTerminalId, loadAiMessages]);

  // Auto-scroll to bottom on new content.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [aiMessages]);

  if (!activeTerminalId) {
    return (
      <div className="ai-empty">
        Select a terminal to start chatting.
      </div>
    );
  }

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isAiStreaming) return;
    const text = input.trim();
    setInput('');

    // Generate a request id so the user can cancel this turn mid-stream.
    const requestId = crypto.randomUUID();

    // Build recent history for context (last ~8 turns, excluding suggestions).
    const history = aiMessages
      .filter((m) => m.messageType === 'chat' || m.messageType === undefined)
      .slice(-8)
      .map((m) => ({ role: m.role, content: m.content }));

    // Snapshot recent terminal output so the assistant can see what the user
    // is working on (errors, logs). Configurable line count; 0 disables.
    const contextLines = aiConfig?.terminalContextLines ?? 0;
    const terminalContext =
      contextLines > 0
        ? terminalRegistry.readTailLines(activeTerminalId, contextLines)
        : undefined;

    useAppStore.getState().startAiTurn(activeTerminalId, text, 'chat', requestId);
    try {
      await aiService.chat({
        terminalId: activeTerminalId,
        message: text,
        requestId,
        history,
        terminalContext: terminalContext || undefined,
      });
    } catch (err) {
      useAppStore.getState().finishAiTurn(String(err), activeTerminalId);
    }
  };

  const handleStop = () => {
    const requestId = useAppStore.getState().activeAiRequestId;
    if (requestId) void aiService.cancel(requestId);
  };

  return (
    <div className="ai-chat">
      {/* Message list — fills remaining height, scrolls independently. */}
      <div ref={scrollRef} className="ai-chat-messages">
        {aiMessages.length === 0 ? (
          <div className="ai-chat-empty">
            Ask anything about your terminal work — paste an error, request a
            command, or get an explanation.
          </div>
        ) : (
          <>
            {aiMessagesTotal > aiMessages.length && (
              <div className="ai-chat-truncated">
                仅显示最近 {aiMessages.length} 条，另有 {aiMessagesTotal - aiMessages.length} 条更早消息未加载
              </div>
            )}
            {aiMessages.map((msg, idx) => (
              <MessageBubble
                key={msg.id ?? idx}
                message={msg}
                activeTerminalId={activeTerminalId}
                runSuggestedCommand={runSuggestedCommand}
              />
            ))}
          </>
        )}
      </div>

      {/* Composer — pinned to the bottom, full width. */}
      <form className="ai-chat-composer" onSubmit={handleSend}>
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            // Enter sends; Shift+Enter (and Ctrl/Cmd+Enter) inserts a newline.
            if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
              e.preventDefault();
              if (!isAiStreaming && input.trim()) {
                void handleSend(e as unknown as React.FormEvent);
              }
            }
          }}
          placeholder="Ask the assistant…  (Shift+Enter for newline)"
          rows={1}
          disabled={isAiStreaming}
        />
        {isAiStreaming ? (
          <button
            type="button"
            className="btn btn-primary ai-chat-send"
            onClick={handleStop}
            title="Stop generating"
          >
            <Square size={13} fill="currentColor" strokeWidth={1.75} />
          </button>
        ) : (
          <button
            type="submit"
            className="btn btn-primary ai-chat-send"
            disabled={!input.trim()}
            title="Send"
          >
            <Send size={14} strokeWidth={1.75} />
          </button>
        )}
      </form>
    </div>
  );
}

const MessageBubble = memo(function MessageBubble({
  message,
  activeTerminalId,
  runSuggestedCommand,
}: {
  message: AIMessage;
  activeTerminalId: string | null;
  runSuggestedCommand: (terminalId: string, command: string) => Promise<void>;
}) {
  const isUser = message.role === 'user';

  // Strip <think>…</think> reasoning blocks from the displayed text. Some
  // providers (DeepSeek, Qwen, etc.) stream hidden chain-of-thought wrapped in
  // these tags; we never want it in the chat bubble. Also hides an in-progress,
  // not-yet-closed <think> block so partial reasoning doesn't flash by while
  // streaming. User messages are left untouched.
  const displayContent = useMemo(
    () => (isUser ? message.content : stripThinkBlocks(message.content)),
    [isUser, message.content]
  );
  // Extract fenced ```sh blocks from the filtered text so a command inside a
  // think block is never offered as runnable.
  const codeBlocks = useMemo(() => extractCodeBlocks(displayContent), [displayContent]);

  return (
    <div className={`ai-msg ${isUser ? 'ai-msg-user' : 'ai-msg-assistant'}`}>
      <div className="ai-msg-bubble">
        {displayContent || (isUser ? '' : '…')}
      </div>
      {!isUser && codeBlocks.length > 0 && activeTerminalId && (
        <div className="ai-msg-actions">
          {codeBlocks.map((cmd, i) => (
            <div className="ai-code-row" key={i}>
              <span className="ai-code-text" title={cmd}>
                $ {cmd}
              </span>
              <button
                className="btn btn-primary"
                onClick={() => void runSuggestedCommand(activeTerminalId, cmd)}
              >
                Run
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
});

/**
 * Remove `<think>…</think>` reasoning blocks from provider output.
 *
 * Handles three cases:
 * 1. Completed blocks:  `foo<think>bar</think>baz` → `foobaz`
 * 2. In-progress block (streaming, closing tag not yet arrived):
 *    `foo<think>bar` → `foo` (the unclosed reasoning is hidden until it closes)
 * 3. Orphaned closing tag (edge case):  `foo</think>bar` → `foobar`
 *
 * Tags are matched case-insensitively and tolerate surrounding whitespace.
 */
function stripThinkBlocks(text: string): string {
  // Case 1: remove all completed <think>…</think> blocks (non-greedy, multiline).
  let out = text.replace(/<think>\s*[\s\S]*?<\/think\s*>/gi, '');
  // Case 2: drop a dangling, still-open <think> and everything after it.
  out = out.replace(/<think\s*>[\s\S]*$/gi, '');
  // Case 3: strip any orphaned </think> tags left behind.
  out = out.replace(/<\/think\s*>/gi, '');
  return out.trim();
}

/** Pull ```sh ... ``` fenced blocks out of markdown text. */
function extractCodeBlocks(text: string): string[] {
  const blocks: string[] = [];
  const re = /```(?:sh|bash|shell|zsh)?\s*\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const cmd = m[1].trim();
    if (cmd) blocks.push(cmd);
  }
  return blocks;
}
