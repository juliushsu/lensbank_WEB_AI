import { createClient } from '@supabase/supabase-js';
import type { Request } from 'express';
import { env } from './env';

export function getServerSupabaseClient(req?: Request) {
  const authHeader = req?.headers?.authorization;

  return createClient(env.supabaseUrl, env.supabaseAnonKey, {
    global: {
      headers: authHeader ? { Authorization: authHeader } : {}
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });
}
