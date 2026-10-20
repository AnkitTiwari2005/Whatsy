"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = void 0;
const pino_1 = __importDefault(require("pino"));
const config_1 = require("./config");
// pino-pretty is a dev convenience only; production logs stay structured JSON.
exports.logger = (0, pino_1.default)({
    level: config_1.config.logLevel,
    redact: { paths: ['req.headers["x-api-key"]', 'req.headers["x-admin-key"]'], censor: '[hidden]' },
    transport: config_1.config.nodeEnv !== 'production' ? { target: 'pino-pretty', options: { colorize: true } } : undefined,
});
//# sourceMappingURL=logger.js.map