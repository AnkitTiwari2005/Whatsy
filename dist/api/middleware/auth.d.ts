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
export declare function apiKeyAuth(req: Request, res: Response, next: NextFunction): Promise<void>;
//# sourceMappingURL=auth.d.ts.map