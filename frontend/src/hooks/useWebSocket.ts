import { useEffect, useRef, useCallback, useState } from 'react';

export type Stroke = {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  color: string;
  width: number;
};

export type LogEntry = {
  index: number;
  term: number;
  stroke: Stroke;
};

type IncomingMessage = 
  | { type: 'stroke'; stroke: Stroke }
  | { type: 'history'; strokes: LogEntry[] };

export type ConnectionState = 'connecting' | 'connected' | 'disconnected';

export type UseWebSocketReturn = {
  sendStroke: (stroke: Stroke) => void;
  connectionState: ConnectionState;
  reconnect: () => void;
};

const DEFAULT_WS_URL = 'ws://localhost:8080/ws';

const INITIAL_RECONNECT_DELAY = 1000;
const MAX_RECONNECT_DELAY = 30000;

type UseWebSocketOptions = {
  url?: string;
  onHistory?: (entries: LogEntry[]) => void;
  onStroke?: (stroke: Stroke) => void;
};

export function useWebSocket({
  url = DEFAULT_WS_URL,
  onHistory,
  onStroke,
}: UseWebSocketOptions = {}): UseWebSocketReturn {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectDelayRef = useRef(INITIAL_RECONNECT_DELAY);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onHistoryRef = useRef(onHistory);
  const onStrokeRef = useRef(onStroke);

  useEffect(() => {
    onHistoryRef.current = onHistory;
    onStrokeRef.current = onStroke;
  }, [onHistory, onStroke]);

  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected');

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN || 
        wsRef.current?.readyState === WebSocket.CONNECTING) {
      return;
    }

    setConnectionState('connecting');

    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('[WebSocket] Connected to Gateway');
      setConnectionState('connected');
      reconnectDelayRef.current = INITIAL_RECONNECT_DELAY;
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data) as IncomingMessage;

        if (message.type === 'history') {
          console.log(`[WebSocket] Received history: ${message.strokes.length} entries`);
          onHistoryRef.current?.(message.strokes);
        } else if (message.type === 'stroke') {
          onStrokeRef.current?.(message.stroke);
        }
      } catch (error) {
        console.error('[WebSocket] Failed to parse message:', error);
      }
    };

    ws.onerror = (error) => {
      console.error('[WebSocket] Connection error:', error);
    };

    ws.onclose = (event) => {
      console.log(`[WebSocket] Disconnected (code: ${event.code}, reason: ${event.reason})`);
      setConnectionState('disconnected');
      wsRef.current = null;

      const delay = reconnectDelayRef.current;
      console.log(`[WebSocket] Reconnecting in ${delay}ms...`);
      
      reconnectTimeoutRef.current = setTimeout(() => {
        reconnectDelayRef.current = Math.min(
          reconnectDelayRef.current * 2,
          MAX_RECONNECT_DELAY
        );
        connect();
      }, delay);
    };
  }, [url]);

  const reconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    reconnectDelayRef.current = INITIAL_RECONNECT_DELAY;
    connect();
  }, [connect]);

  useEffect(() => {
    connect();

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close(1000, 'Component unmounted');
      }
    };
  }, [connect]);

  const sendStroke = useCallback((stroke: Stroke) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      const message = JSON.stringify({
        type: 'stroke',
        stroke,
      });
      wsRef.current.send(message);
    } else {
      console.warn('[WebSocket] Cannot send stroke - not connected');
    }
  }, []);

  return {
    sendStroke,
    connectionState,
    reconnect,
  };
}
