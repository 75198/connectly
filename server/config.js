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
  sessionDays: 60, // sliding: extended on activity (see auth.js loadUser)
  savedLoginDays: 60, // sliding: extended each time the saved login is used
  // Feature flags: FEATURE_<NAME>=0/1 in .env. Default values here. See DEVELOPER_HANDBOOK.md.
  features: {
    signupPow: (env.FEATURE_SIGNUP_POW ?? '1') !== '0',
    reports: (env.FEATURE_REPORTS ?? '1') !== '0',
  },
  powBits: Number(env.POW_BITS || (isTest ? 4 : 18)),
  codeSecret: env.CODE_SECRET || 'dev-only-secret',
  maxUploadBytes: 5 * 1024 * 1024,
};
