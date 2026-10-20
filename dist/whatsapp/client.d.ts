export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected';
export interface QueuedMessage {
    messageId: number;
    recipient: string;
    body: string;
    attempt?: number;
}
export { normalizePhone } from '../util/phone';
export declare function toJid(phone: string): string;
export declare function isWhatsAppReady(): boolean;
export declare function getStatus(): {
    status: ConnectionStatus;
    uptime_seconds: number;
    is_ready: boolean;
    registered: boolean;
    last_connected_at: string | null;
    last_disconnect_code: number | null;
    pairing_issued_at: string | null;
};
export declare function getQueueLength(): number;
export declare function sendDirectMessage(recipientJid: string, text: string): Promise<string | null>;
export declare function loadPendingMessagesFromDb(): void;
export declare function connectWhatsApp(): Promise<void>;
/** Start (or resume) the WhatsApp connection; never throws — failures are retried with backoff. */
export declare function startWhatsApp(): void;
export declare function requestPairing(digits: string): Promise<string>;
/** Log out from WhatsApp, delete local credentials and prepare a fresh socket for pairing. */
export declare function unlinkSession(): Promise<void>;
export declare function enqueueMessage(msg: QueuedMessage, priority?: boolean): void;
/** Graceful shutdown: let the current send finish (up to maxMs), then close the socket. */
export declare function closeWhatsApp(maxMs?: number): Promise<void>;
//# sourceMappingURL=client.d.ts.map