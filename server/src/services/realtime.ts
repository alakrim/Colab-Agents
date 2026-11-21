import type { WebSocket } from 'ws';

export interface RealtimeEvent {
  type: string;
  payload: unknown;
  timestamp: string;
}

export class RealtimeHub {
  private uiClients = new Set<WebSocket>();

  public addUiClient(ws: WebSocket): void {
    this.uiClients.add(ws);
    ws.on('close', () => {
      this.uiClients.delete(ws);
    });
    ws.on('error', () => {
      this.uiClients.delete(ws);
    });
  }

  public broadcast(type: string, payload: unknown): void {
    const event: RealtimeEvent = {
      type,
      payload,
      timestamp: new Date().toISOString(),
    };
    const serialized = JSON.stringify(event);
    for (const client of this.uiClients) {
      if (client.readyState === 1) {
        try {
          client.send(serialized);
        } catch {
          this.uiClients.delete(client);
        }
      }
    }
  }

  public getClientCount(): number {
    return this.uiClients.size;
  }
}
