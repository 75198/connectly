import 'dotenv/config';
import path from 'node:path';
const env = process.env;
const isTest = env.NODE_ENV === 'test';
export const config = {
  isTest,
  isProd: env.NODE_ENV === 'production',
  port: Number(env.PORT || 3000),
  databaseUrl: isTest
    ? (env.TEST_DATABASE_URL || 'postgres://connectly:devpass@localhost:5432/connectly_test')
    : (env.DATABASE_URL || 'postgres://connectly:devpass@localhost:5432/connectly'),
  appUrl: env.APP_URL || 'http://localhost:3000',
  cookieSecure: env.COOKIE_SECURE === 'true',
  uploadDir: path.resolve(env.UPLOAD_DIR || (isTest ? './.test-uploads' : './uploads')),
  sessionDays: 30,
  maxUploadBytes: 5 * 1024 * 1024,
};
