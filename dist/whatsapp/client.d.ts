export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected';
export interface QueuedMessage {
    messageId: number;
    recipient: string;
    body: string;
    expiresAt?: Date;
    otpId?: number;
}
/** Convert E.164 number (+919876543210 or 919876543210) to WhatsApp JID */
export declare function toJid(phone: string): string;
/** Check if WhatsApp socket is open and authenticated */
export declare function isWhatsAppReady(): boolean;
export declare function getStatus(): {
    status: ConnectionStatus;
    uptime_seconds: number;
    is_ready: boolean;
};
/**
 * Direct synchronous message dispatch over active WebSocket.
 * Bypasses the 2-5s anti-ban jitter queue for real-time delivery (e.g. OTPs).
 * Throws if WhatsApp is disconnected or socket error occurs.
 */
export declare function sendDirectMessage(recipientJid: string, text: string): Promise<string | null>;
export declare function loadPendingMessagesFromDb(): void;
export declare function connectWhatsApp(): Promise<void>;
export declare function requestPairing(phoneNumber: string): Promise<string>;
export declare function enqueueMessage(msg: QueuedMessage, priority?: boolean): void;
export declare function getQueueLength(): number;
//# sourceMappingURL=client.d.ts.map