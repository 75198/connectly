import pg from 'pg';
import { config } from './config.js';
pg.types.setTypeParser(20, (v) => Number(v)); // bigint -> number (ids/counts fit safely)
export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10 });
export const q = (text, params) => pool.query(text, params);
