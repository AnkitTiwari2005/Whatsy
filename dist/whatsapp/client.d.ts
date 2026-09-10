export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected';
export interface QueuedMessage {
    messageId: number;
    recipient: string;
    body: string;
}
/** Convert E.164 number (+919876543210 or 919876543210) to WhatsApp JID */
export declare function toJid(phone: string): string;
export declare function getStatus(): {
    status: ConnectionStatus;
    uptime_seconds: number;
};
export declare function connectWhatsApp(): Promise<void>;
export declare function requestPairing(phoneNumber: string): Promise<string>;
export declare function enqueueMessage(msg: QueuedMessage): void;
export declare function getQueueLength(): number;
//# sourceMappingURL=client.d.ts.map