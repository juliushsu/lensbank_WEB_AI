import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // 處理 CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { 
      status: 200,
      headers: corsHeaders 
    });
  }

  try {
    console.log('=== Google Calendar OAuth 開始 ===');
    console.log('請求方法:', req.method);
    
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    );

    const requestBody = await req.json();
    console.log('收到的請求:', { action: requestBody.action });
    
    const { action, code, refresh_token } = requestBody;

    // Google OAuth 設定
    const clientId = Deno.env.get('GOOGLE_CLIENT_ID');
    const clientSecret = Deno.env.get('GOOGLE_CLIENT_SECRET');
    const redirectUri = Deno.env.get('GOOGLE_REDIRECT_URI');

    console.log('環境變數檢查:', {
      hasClientId: !!clientId,
      hasClientSecret: !!clientSecret,
      hasRedirectUri: !!redirectUri,
      redirectUri: redirectUri
    });

    if (!clientId || !clientSecret || !redirectUri) {
      const missing = [];
      if (!clientId) missing.push('GOOGLE_CLIENT_ID');
      if (!clientSecret) missing.push('GOOGLE_CLIENT_SECRET');
      if (!redirectUri) missing.push('GOOGLE_REDIRECT_URI');
      
      console.error('❌ 缺少環境變數:', missing);
      
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: `缺少環境變數：${missing.join(', ')}`,
          message: '請在 Supabase Dashboard 設定這些 Secrets'
        }),
        { 
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    // 0. 產生授權網址
    if (action === 'get_auth_url') {
      console.log('📋 產生授權 URL...');
      
      const scope = 'https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/userinfo.email';
      const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
        `client_id=${clientId}&` +
        `redirect_uri=${encodeURIComponent(redirectUri)}&` +
        `response_type=code&` +
        `scope=${encodeURIComponent(scope)}&` +
        `access_type=offline&` +
        `prompt=consent`;
      
      console.log('✅ 授權 URL 產生成功');
      
      return new Response(
        JSON.stringify({ 
          success: true, 
          auth_url: authUrl 
        }),
        { 
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    // 1. 交換授權碼取得 Token
    if (action === 'exchange_code') {
      console.log('🔄 開始交換授權碼...');
      
      if (!code) {
        console.error('❌ 缺少授權碼');
        return new Response(
          JSON.stringify({ 
            success: false, 
            error: '缺少授權碼' 
          }),
          { 
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
          }
        );
      }
      
      const tokenRequestBody = new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      });
      
      console.log('📡 向 Google 請求 Token...');
      
      const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: tokenRequestBody,
      });

      console.log('Token 回應狀態:', tokenResponse.status);

      if (!tokenResponse.ok) {
        const error = await tokenResponse.text();
        console.error('❌ Token 交換失敗:', error);
        return new Response(
          JSON.stringify({ 
            success: false, 
            error: `Token 交換失敗: ${error}` 
          }),
          { 
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
          }
        );
      }

      const tokens = await tokenResponse.json();
      console.log('✅ Token 取得成功');
      console.log('Token 資訊:', {
        has_access_token: !!tokens.access_token,
        has_refresh_token: !!tokens.refresh_token,
        expires_in: tokens.expires_in,
        token_type: tokens.token_type,
        scope: tokens.scope
      });

      // 取得使用者 Email
      console.log('📡 取得使用者 Email...');
      const userInfoResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        method: 'GET',
        headers: { 
          'Authorization': `Bearer ${tokens.access_token}`,
          'Accept': 'application/json'
        },
      });

      console.log('UserInfo API 回應狀態:', userInfoResponse.status);

      if (!userInfoResponse.ok) {
        const errorText = await userInfoResponse.text();
        console.error('❌ 取得使用者資訊失敗:', errorText);
        
        return new Response(
          JSON.stringify({ 
            success: false, 
            error: '取得使用者資訊失敗',
            details: errorText,
            status: userInfoResponse.status
          }),
          { 
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
          }
        );
      }

      const userInfo = await userInfoResponse.json();
      console.log('✅ 使用者資訊:', { email: userInfo.email });

      // 測試 Calendar API 存取權限
      console.log('📡 測試 Calendar API 存取權限...');
      const calendarTestResponse = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary', {
        method: 'GET',
        headers: { 
          'Authorization': `Bearer ${tokens.access_token}`,
          'Accept': 'application/json'
        },
      });

      console.log('Calendar API 測試狀態:', calendarTestResponse.status);

      if (!calendarTestResponse.ok) {
        const errorText = await calendarTestResponse.text();
        console.error('⚠️ Calendar API 測試失敗（但繼續儲存）:', errorText);
      } else {
        const calendarInfo = await calendarTestResponse.json();
        console.log('✅ Calendar API 可用:', { id: calendarInfo.id });
      }

      // 儲存到資料庫
      console.log('💾 儲存到資料庫...');
      const { data, error } = await supabaseClient
        .from('google_calendar_settings')
        .upsert({
          workspace_email: userInfo.email,
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
          token_expiry: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
          is_active: true,
          last_sync_at: new Date().toISOString(),
        }, { onConflict: 'workspace_email' });

      if (error) {
        console.error('❌ 資料庫儲存失敗:', error);
        return new Response(
          JSON.stringify({ 
            success: false, 
            error: `資料庫錯誤: ${error.message}` 
          }),
          { 
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
          }
        );
      }

      console.log('✅ 授權完成，資料已儲存');

      return new Response(
        JSON.stringify({ 
          success: true, 
          email: userInfo.email,
          message: 'Google Calendar 授權成功！' 
        }),
        { 
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    // 2. 刷新 Access Token
    if (action === 'refresh_token') {
      console.log('🔄 開始刷新 Token...');
      
      if (!refresh_token) {
        console.error('❌ 缺少 refresh_token');
        return new Response(
          JSON.stringify({ 
            success: false, 
            error: '缺少 refresh_token' 
          }),
          { 
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
          }
        );
      }
      
      const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          refresh_token,
          client_id: clientId,
          client_secret: clientSecret,
          grant_type: 'refresh_token',
        }),
      });

      if (!tokenResponse.ok) {
        const error = await tokenResponse.text();
        console.error('❌ Token 刷新失敗:', error);
        return new Response(
          JSON.stringify({ 
            success: false, 
            error: 'Token 刷新失敗' 
          }),
          { 
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
          }
        );
      }

      const tokens = await tokenResponse.json();
      console.log('✅ Token 刷新成功');

      // 更新資料庫
      const { error } = await supabaseClient
        .from('google_calendar_settings')
        .update({
          access_token: tokens.access_token,
          token_expiry: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('refresh_token', refresh_token);

      if (error) {
        console.error('❌ 資料庫更新失敗:', error);
        return new Response(
          JSON.stringify({ 
            success: false, 
            error: '資料庫更新失敗' 
          }),
          { 
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
          }
        );
      }

      return new Response(
        JSON.stringify({ 
          success: true, 
          access_token: tokens.access_token 
        }),
        { 
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    // 3. 取得目前授權狀態
    if (action === 'get_status') {
      console.log('📋 查詢授權狀態...');
      
      const { data, error } = await supabaseClient
        .from('google_calendar_settings')
        .select('workspace_email, is_active, last_sync_at, token_expiry')
        .eq('is_active', true)
        .maybeSingle();

      if (error && error.code !== 'PGRST116') {
        console.error('❌ 查詢狀態失敗:', error);
        return new Response(
          JSON.stringify({ 
            success: false, 
            error: '查詢狀態失敗' 
          }),
          { 
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
          }
        );
      }

      console.log('✅ 授權狀態:', { authorized: !!data });

      return new Response(
        JSON.stringify({ 
          success: true, 
          authorized: !!data,
          settings: data 
        }),
        { 
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    // 無效的 action
    console.error('❌ 無效的 action:', action);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: `無效的 action: ${action}` 
      }),
      { 
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );

  } catch (error) {
    console.error('=== Edge Function 錯誤 ===');
    console.error('錯誤類型:', error.constructor.name);
    console.error('錯誤訊息:', error.message);
    console.error('錯誤堆疊:', error.stack);
    
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error.message || '未知錯誤',
        type: error.constructor.name
      }),
      { 
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});