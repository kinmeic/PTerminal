import { useEffect, useRef } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { AIStreamPayload } from '@/types';
import { useAppStore } from '@/stores/appStore';

/**
 * Subscribe to `ai-delta` / `ai-done` events. Incoming deltas are buffered
 * and flushed via `requestAnimationFrame` so rapid SSE chunks don't trigger a
 * React render per token (per PLAN.md §7 performance note).
 *
 * Mounted once at the app root alongside `useTauriEvents`.
 */
export function useAIStream(): void {
  const activeTerminalId = useAppStore((s) => s.activeTerminalId);
  const appendAiDelta = useAppStore((s) => s.appendAiDelta);
  const finishAiTurn = useAppStore((s) => s.finishAiTurn);

  const bufferRef = useRef<string>('');
  const rafRef = useRef<number>(0);
  // Flush function shared between the streaming effect and the terminal-switch
  // effect, so a switch can drain pending buffered text before resetting.
  const flushRef = useRef<() => void>(() => {});

  useEffect(() => {
    const flush = () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
      }
      const chunk = bufferRef.current;
      bufferRef.current = '';
      if (chunk) appendAiDelta(chunk);
    };
    flushRef.current = flush;

    const scheduleFlush = () => {
      if (rafRef.current) return;
      rafRef.current = requestAnimationFrame(flush);
    };

    const unlisteners: UnlistenFn[] = [];

    listen<AIStreamPayload>('ai-delta', (event) => {
      const { requestId, terminalId, delta } = event.payload;
      const state = useAppStore.getState();
      if (
        delta &&
        state.aiStreams[terminalId] === requestId &&
        terminalId === state.activeTerminalId
      ) {
        bufferRef.current += delta;
        scheduleFlush();
      }
    }).then((un) => unlisteners.push(un));

    listen<AIStreamPayload>('ai-done', (event) => {
      const { requestId, terminalId, error } = event.payload;
      const state = useAppStore.getState();
      if (state.aiStreams[terminalId] === requestId) {
        // Flush any remaining buffered text before finalizing.
        flush();
        finishAiTurn(error, terminalId);
      }
    }).then((un) => unlisteners.push(un));

    return () => {
      unlisteners.forEach((un) => un());
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [appendAiDelta, finishAiTurn]);

  // When switching terminals, flush any buffered delta belonging to the
  // outgoing terminal BEFORE resetting — otherwise pending text would be
  // discarded (the assistant bubble would stay stale until a full reload).
  useEffect(() => {
    flushRef.current();
    bufferRef.current = '';
  }, [activeTerminalId]);
}
