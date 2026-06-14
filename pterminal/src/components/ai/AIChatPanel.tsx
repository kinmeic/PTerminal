import { useEffect, useRef, useState } from 'react';
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
      useAppStore.getState().finishAiTurn(String(err));
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
              <MessageBubble key={msg.id ?? idx} message={msg} />
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

function MessageBubble({ message }: { message: AIMessage }) {
  const isUser = message.role === 'user';
  const runSuggestedCommand = useAppStore((s) => s.runSuggestedCommand);
  const activeTerminalId = useAppStore((s) => s.activeTerminalId);

  // Extract fenced ```sh blocks for a "Run" affordance.
  const codeBlocks = extractCodeBlocks(message.content);

  return (
    <div className={`ai-msg ${isUser ? 'ai-msg-user' : 'ai-msg-assistant'}`}>
      <div className="ai-msg-bubble">
        {message.content || (isUser ? '' : '…')}
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
