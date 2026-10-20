export declare const config: {
    readonly port: number;
    readonly adminKey: string;
    readonly otpSecret: string;
    readonly nodeEnv: string;
    readonly dataDir: string;
    readonly dbPath: string;
    readonly authStatePath: string;
    readonly waPhoneNumber: string;
    /** Digits only, e.g. 91. When set, 10-digit / 0-prefixed national numbers are normalised to E.164. Defaults to 91 (India). */
    readonly defaultCountryCode: string;
    readonly messageDelayMin: number;
    readonly messageDelayMax: number;
    readonly maxQueueSize: number;
    readonly sendTimeoutMs: number;
    readonly sendMaxAttempts: number;
    readonly maxMessageLength: number;
    readonly otpCooldownSeconds: number;
    readonly otpMaxPerHour: number;
    readonly trustProxy: number | boolean;
    readonly corsOrigins: string[];
    readonly ipRatePerMin: number;
    readonly messagesRatePerMin: number;
    readonly otpRatePerMin: number;
    readonly adminFailMax: number;
    readonly adminFailWindowSec: number;
    readonly messageRetentionDays: number;
    readonly redactBodies: boolean;
    readonly logLevel: "fatal" | "error" | "warn" | "info" | "debug" | "trace";
};
export declare const REDACTED_BODY = "[redacted]";
//# sourceMappingURL=config.d.ts.map