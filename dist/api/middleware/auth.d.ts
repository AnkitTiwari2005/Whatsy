import { Request, Response, NextFunction } from 'express';
declare global {
    namespace Express {
        interface Request {
            project?: {
                id: number;
                name: string;
                default_recipient: string | null;
                keyId: number;
            };
        }
    }
}
export declare const KEY_HASH_PREFIX = "sha256$";
/** API keys are 256-bit random values, so a fast hash is sufficient (bcrypt only protects low-entropy secrets). */
export declare const hashApiKey: (raw: string) => string;
/**
 * Resolve X-Api-Key → project. O(1) lookup by SHA-256. Legacy bcrypt keys are still accepted
 * and transparently upgraded to SHA-256 on first successful use.
 * Valid keys are never blocked by failed-attempt floods from the same IP; only *invalid* keys get 429.
 */
export declare function apiKeyAuth(req: Request, res: Response, next: NextFunction): Promise<void>;
//# sourceMappingURL=auth.d.ts.map