import { errorFactory } from './errors';

function getEnvOrThrow(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw errorFactory.internal(`Missing required env: ${key}`);
  }
  return value;
}

export const env = {
  supabaseUrl: getEnvOrThrow('SUPABASE_URL'),
  supabaseAnonKey: getEnvOrThrow('SUPABASE_ANON_KEY'),
  lineChannelId: process.env.LINE_LIFF_CHANNEL_ID ?? '',
  lineChannelSecret: process.env.LINE_CHANNEL_SECRET ?? '',
  lineBindingTokenPepper: process.env.LINE_BINDING_TOKEN_PEPPER ?? '',
  attendanceCooldownSeconds: Number(process.env.ATTENDANCE_COOLDOWN_SECONDS ?? 60),
  attendanceShiftStartHour: Number(process.env.ATTENDANCE_SHIFT_START_HOUR ?? 9),
  attendanceLateAfterMinutes: Number(process.env.ATTENDANCE_LATE_AFTER_MINUTES ?? 10)
};
