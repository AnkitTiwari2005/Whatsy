import { Request, Response, NextFunction } from 'express';
/** Admin auth: constant-time compare + lockout of an IP after repeated wrong keys (even if a later guess is right). */
export declare function adminKeyAuth(req: Request, res: Response, next: NextFunction): void;
//# sourceMappingURL=adminAuth.d.ts.map