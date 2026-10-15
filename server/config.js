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
    reels: (env.FEATURE_REELS ?? '1') !== '0',
    welcomeHero: (env.FEATURE_WELCOME_HERO ?? '1') !== '0',
    aiSupport: (env.FEATURE_AI_SUPPORT ?? '0') === '1',
  },
  powBits: Number(env.POW_BITS || (isTest ? 4 : 17)),
  codeSecret: env.CODE_SECRET || 'dev-only-secret',
  maxUploadBytes: 15 * 1024 * 1024,
  maxVideoBytes: 50 * 1024 * 1024,
  maxVideoSeconds: 60,
  ffmpegPath: env.FFMPEG_PATH || 'ffmpeg',
  // AI support chat (Groq, OpenAI-compatible). The key lives only in .env on the server.
  groqApiKey: env.GROQ_API_KEY || '',
  groqBaseUrl: env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1',
  groqModel: env.GROQ_MODEL || 'openai/gpt-oss-20b',
  aiUserHourly: Number(env.AI_USER_HOURLY || 30),
  aiDailyCap: Number(env.AI_DAILY_CAP || 900),
  ffprobePath: env.FFPROBE_PATH || 'ffprobe',
};
