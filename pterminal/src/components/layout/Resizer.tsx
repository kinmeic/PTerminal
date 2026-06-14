import { useEffect, useState } from 'react';

interface ResizerProps {
  onResize: (delta: number) => void;
  /** Called once when a drag ends (mouseup). Use to persist width, etc. */
  onResizeEnd?: () => void;
  direction?: 'horizontal' | 'vertical';
}

export function Resizer({ onResize, onResizeEnd, direction = 'horizontal' }: ResizerProps) {
  const [isResizing, setIsResizing] = useState(false);

  // Stable handlers bound on mousedown — read `onResize` from a ref so the
  // bound closure always calls the latest setter without rebinding mid-drag.
  useEffect(() => {
    if (!isResizing) return;

    const axis = direction === 'horizontal' ? 'clientX' : 'clientY';
    let last = 0;

    const handleMove = (e: MouseEvent) => {
      const pos = e[axis];
      if (last === 0) {
        last = pos;
        return;
      }
      onResize(pos - last);
      last = pos;
    };
    const handleUp = () => {
      setIsResizing(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      onResizeEnd?.();
    };

    document.body.style.cursor =
      direction === 'horizontal' ? 'col-resize' : 'row-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
    return () => {
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleUp);
    };
  }, [isResizing, direction, onResize, onResizeEnd]);

  // Cleanup body styles on unmount as a safety net.
  useEffect(() => {
    return () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, []);

  return (
    <div
      className={`resizer ${isResizing ? 'resizing' : ''}`}
      onMouseDown={(e) => {
        e.preventDefault();
        setIsResizing(true);
      }}
    />
  );
}
