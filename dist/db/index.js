"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDb = getDb;
const better_sqlite3_1 = __importDefault(require("better-sqlite3"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const config_1 = require("../config");
const logger_1 = require("../logger");
let _db = null;
function getDb() {
    if (_db)
        return _db;
    // Ensure data directory exists
    fs_1.default.mkdirSync(path_1.default.dirname(config_1.config.dbPath), { recursive: true });
    _db = new better_sqlite3_1.default(config_1.config.dbPath);
    // Enable WAL mode and foreign keys — WAL allows concurrent reads while writing
    _db.pragma('journal_mode = WAL');
    _db.pragma('foreign_keys = ON');
    _db.pragma('busy_timeout = 5000');
    // Run schema (idempotent — all statements use IF NOT EXISTS)
    const schema = fs_1.default.readFileSync(path_1.default.join(__dirname, 'schema.sql'), 'utf-8');
    _db.exec(schema);
    logger_1.logger.info({ path: config_1.config.dbPath }, 'Database ready');
    return _db;
}
//# sourceMappingURL=index.js.map