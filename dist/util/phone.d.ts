export type PhoneResult = {
    ok: true;
    digits: string;
    e164: string;
    clean: string;
    formatted: string;
    jid: string;
} | {
    ok: false;
    error: string;
    clean?: never;
    formatted?: never;
    jid?: never;
};
/**
 * Normalise user-supplied phone input to E.164 digits.
 * Accepts strings or integers; allows only digits and common separators ("+91 98765-43210", "(0) 98765 43210").
 * Rejects free text, so "call me on 9876543210" is an error instead of silently becoming a recipient.
 */
export declare function normalizePhone(input: unknown): PhoneResult;
//# sourceMappingURL=phone.d.ts.map