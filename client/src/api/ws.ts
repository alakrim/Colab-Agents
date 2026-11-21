export interface WsEvent {
  type: string;
  payload: unknown;
  timestamp: string;
}

export function connectRealtime(
  onEvent: (event: WsEvent) => void,
  onConnectionChange: (connected: boolean) => void,
): () => void {
  let closed = false;
  let ws: WebSocket | null = null;
  let retryTimer: number | null = null;

  const connect = () => {
    if (closed) return;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${protocol}//${window.location.host}/ws/events`;
    ws = new WebSocket(url);

    ws.onopen = () => onConnectionChange(true);
    ws.onmessage = (ev) => {
      try {
        onEvent(JSON.parse(ev.data) as WsEvent);
      } catch {
        // ignore
      }
    };
    ws.onclose = () => {
      onConnectionChange(false);
      if (!closed) {
        retryTimer = window.setTimeout(connect, 2000);
      }
    };
    ws.onerror = () => {
      ws?.close();
    };
  };

  connect();

  return () => {
    closed = true;
    if (retryTimer) window.clearTimeout(retryTimer);
    ws?.close();
  };
}
