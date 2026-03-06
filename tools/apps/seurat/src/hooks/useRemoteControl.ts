import { useEffect, useRef } from 'react';

export function useRemoteControl(bridgeUrl: string): void {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let disposed = false;

    function connect() {
      if (disposed) return;

      try {
        const ws = new WebSocket(bridgeUrl);
        wsRef.current = ws;

        ws.onopen = () => {
          console.log('[Seurat] Connected to bridge');
          ws.send(JSON.stringify({ type: 'register_tool', name: 'seurat' }));
        };

        ws.onmessage = (event) => {
          let parsed: Record<string, unknown>;
          try {
            parsed = JSON.parse(event.data as string);
          } catch {
            return;
          }

          if (
            parsed['type'] === 'registered' ||
            parsed['type'] === 'engine_disconnected' ||
            parsed['type'] === 'raw'
          ) {
            return;
          }

          // Future: handle incoming commands from bridge
        };

        ws.onclose = () => {
          console.log('[Seurat] Disconnected from bridge');
          wsRef.current = null;
          if (!disposed) {
            reconnectTimerRef.current = setTimeout(connect, 3000);
          }
        };

        ws.onerror = () => {
          // onclose will fire after this
        };
      } catch {
        if (!disposed) {
          reconnectTimerRef.current = setTimeout(connect, 3000);
        }
      }
    }

    connect();

    return () => {
      disposed = true;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [bridgeUrl]);
}
