
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    console.log('🔄 開始處理 Google Calendar 同步請求...');
    
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    );

    const { action, order_id, location_id, event_data } = await req.json();
    console.log('📋 收到請求參數:', { action, order_id, location_id });

    // 取得有效的 Access Token
    console.log('🔍 查詢 Google Calendar 授權設定...');
    const { data: settings, error: settingsError } = await supabaseClient
      .from('google_calendar_settings')
      .select('*')
      .eq('is_active', true)
      .maybeSingle();

    if (settingsError) {
      console.error('❌ 查詢授權設定失敗:', settingsError);
      throw new Error(`查詢授權設定失敗: ${settingsError.message}`);
    }

    if (!settings) {
      console.error('❌ Google Calendar 尚未授權');
      throw new Error('Google Calendar 尚未授權，請先前往「設定 > Google Calendar」完成授權');
    }

    console.log('✅ 找到授權設定，檢查 Token 有效期...');

    // 檢查 Token 是否過期
    let accessToken = settings.access_token;
    const tokenExpiry = new Date(settings.token_expiry);
    const now = new Date();
    
    console.log('⏰ Token 到期時間:', tokenExpiry.toISOString());
    console.log('⏰ 目前時間:', now.toISOString());
    
    if (tokenExpiry < now) {
      console.log('🔄 Token 已過期，開始刷新...');
      
      const refreshResponse = await fetch(Deno.env.get('SUPABASE_URL') + '/functions/v1/google-calendar-oauth', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': req.headers.get('Authorization') || '',
        },
        body: JSON.stringify({
          action: 'refresh_token',
          refresh_token: settings.refresh_token,
        }),
      });

      if (!refreshResponse.ok) {
        const errorText = await refreshResponse.text();
        console.error('❌ Token 刷新失敗:', errorText);
        throw new Error('Token 刷新失敗，請重新授權 Google Calendar');
      }

      const refreshData = await refreshResponse.json();
      if (!refreshData.success) {
        console.error('❌ Token 刷新失敗:', refreshData.error);
        throw new Error('Token 刷新失敗，請重新授權 Google Calendar');
      }
      
      accessToken = refreshData.access_token;
      console.log('✅ Token 刷新成功');
    } else {
      console.log('✅ Token 仍然有效');
    }

    // 取得據點的 Calendar ID 和顏色設定
    console.log('🔍 查詢據點資訊...');
    const { data: location, error: locationError } = await supabaseClient
      .from('locations')
      .select('google_calendar_id, name_zh, calendar_color_id')
      .eq('id', location_id)
      .maybeSingle();

    if (locationError) {
      console.error('❌ 查詢據點失敗:', locationError);
      throw new Error(`查詢據點失敗: ${locationError.message}`);
    }

    if (!location) {
      console.error('❌ 找不到據點:', location_id);
      throw new Error('找不到指定的據點');
    }

    if (!location.google_calendar_id) {
      console.error('❌ 據點未設定 Calendar ID:', location.name_zh);
      throw new Error(`據點「${location.name_zh}」尚未設定 Google Calendar ID，請先在據點管理中設定`);
    }

    const calendarId = location.google_calendar_id;
    // 使用門市設定的顏色，預設為 9 (藍色)
    const colorId = location.calendar_color_id || '9';
    console.log('✅ 據點 Calendar ID:', calendarId, '顏色 ID:', colorId);

    // 1. 建立日曆事件
    if (action === 'create_event') {
      console.log('📅 開始建立日曆事件...');
      
      // 查詢訂單的儲值金使用狀態
      const { data: orderData } = await supabaseClient
        .from('orders')
        .select('prepaid_used, prepaid_real_amount, prepaid_bonus_amount')
        .eq('id', order_id)
        .maybeSingle();

      // 如果有使用儲值金，在描述中加入標記
      let description = event_data.description;
      if (orderData?.prepaid_used) {
        const totalPrepaid = (orderData.prepaid_real_amount || 0) + (orderData.prepaid_bonus_amount || 0);
        description += `\n\n💰 已使用儲值金付款：NT$ ${totalPrepaid.toLocaleString()}`;
        description += `\n   實體金額：NT$ ${(orderData.prepaid_real_amount || 0).toLocaleString()}`;
        description += `\n   贈送金額：NT$ ${(orderData.prepaid_bonus_amount || 0).toLocaleString()}`;
      } else {
        // 檢查是否為儲值會員但餘額不足
        const { data: logData } = await supabaseClient
          .from('order_logs')
          .select('action')
          .eq('order_id', order_id)
          .eq('action', 'prepaid_insufficient')
          .maybeSingle();

        if (logData) {
          description += '\n\n⚠️ 儲值金餘額不足，扣款失敗';
        }
      }
      
      const event = {
        summary: event_data.title,
        description: description,
        start: {
          dateTime: event_data.start,
          timeZone: 'Asia/Taipei',
        },
        end: {
          dateTime: event_data.end,
          timeZone: 'Asia/Taipei',
        },
        colorId: colorId,
      };

      console.log('📤 發送請求到 Google Calendar API...');
      const response = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(event),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.error('❌ Google API 回應錯誤:', errorText);
        throw new Error(`建立日曆事件失敗: ${errorText}`);
      }

      const createdEvent = await response.json();
      console.log('✅ 日曆事件建立成功:', createdEvent.id);

      // 記錄到資料庫
      console.log('💾 儲存事件記錄到資料庫...');
      const { error: insertError } = await supabaseClient.from('order_calendar_events').insert({
        order_id,
        location_id,
        google_event_id: createdEvent.id,
        calendar_id: calendarId,
        event_title: event_data.title,
        event_start: event_data.start,
        event_end: event_data.end,
        sync_status: 'synced',
      });

      if (insertError) {
        console.error('❌ 儲存事件記錄失敗:', insertError);
      } else {
        console.log('✅ 事件記錄儲存成功');
      }

      return new Response(
        JSON.stringify({ 
          success: true, 
          event_id: createdEvent.id,
          message: '日曆事件建立成功！' 
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 2. 更新日曆事件
    if (action === 'update_event') {
      console.log('📅 開始更新日曆事件...');
      
      const { data: existingEvent } = await supabaseClient
        .from('order_calendar_events')
        .select('google_event_id')
        .eq('order_id', order_id)
        .maybeSingle();

      if (!existingEvent) {
        console.error('❌ 找不到對應的日曆事件');
        throw new Error('找不到對應的日曆事件');
      }

      console.log('📤 更新 Google Calendar 事件:', existingEvent.google_event_id);

      // 查詢訂單的儲值金使用狀態
      const { data: orderData } = await supabaseClient
        .from('orders')
        .select('prepaid_used, prepaid_real_amount, prepaid_bonus_amount')
        .eq('id', order_id)
        .maybeSingle();

      // 如果有使用儲值金，在描述中加入標記
      let description = event_data.description;
      if (orderData?.prepaid_used) {
        const totalPrepaid = (orderData.prepaid_real_amount || 0) + (orderData.prepaid_bonus_amount || 0);
        description += `\n\n💰 已使用儲值金付款：NT$ ${totalPrepaid.toLocaleString()}`;
        description += `\n   實體金額：NT$ ${(orderData.prepaid_real_amount || 0).toLocaleString()}`;
        description += `\n   贈送金額：NT$ ${(orderData.prepaid_bonus_amount || 0).toLocaleString()}`;
      } else {
        // 檢查是否為儲值會員但餘額不足
        const { data: logData } = await supabaseClient
          .from('order_logs')
          .select('action')
          .eq('order_id', order_id)
          .eq('action', 'prepaid_insufficient')
          .maybeSingle();

        if (logData) {
          description += '\n\n⚠️ 儲值金餘額不足，扣款失敗';
        }
      }

      const event = {
        summary: event_data.title,
        description: description,
        start: {
          dateTime: event_data.start,
          timeZone: 'Asia/Taipei',
        },
        end: {
          dateTime: event_data.end,
          timeZone: 'Asia/Taipei',
        },
        colorId: colorId,
      };

      const response = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${existingEvent.google_event_id}`,
        {
          method: 'PUT',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(event),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.error('❌ Google API 回應錯誤:', errorText);
        throw new Error(`更新日曆事件失敗: ${errorText}`);
      }

      console.log('✅ 日曆事件更新成功');

      await supabaseClient
        .from('order_calendar_events')
        .update({
          event_title: event_data.title,
          event_start: event_data.start,
          event_end: event_data.end,
          last_synced_at: new Date().toISOString(),
        })
        .eq('order_id', order_id);

      return new Response(
        JSON.stringify({ success: true, message: '日曆事件更新成功！' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 3. 刪除日曆事件
    if (action === 'delete_event') {
      console.log('🗑️ 開始刪除日曆事件...');
      
      const { data: existingEvent } = await supabaseClient
        .from('order_calendar_events')
        .select('google_event_id')
        .eq('order_id', order_id)
        .maybeSingle();

      if (!existingEvent) {
        console.error('❌ 找不到對應的日曆事件');
        throw new Error('找不到對應的日曆事件');
      }

      console.log('📤 刪除 Google Calendar 事件:', existingEvent.google_event_id);

      const response = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${existingEvent.google_event_id}`,
        {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${accessToken}` },
        }
      );

      if (!response.ok && response.status !== 404) {
        const errorText = await response.text();
        console.error('❌ Google API 回應錯誤:', errorText);
        throw new Error(`刪除日曆事件失敗: ${errorText}`);
      }

      console.log('✅ 日曆事件刪除成功');

      await supabaseClient
        .from('order_calendar_events')
        .delete()
        .eq('order_id', order_id);

      return new Response(
        JSON.stringify({ success: true, message: '日曆事件刪除成功！' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    throw new Error('無效的操作類型');

  } catch (error) {
    console.error('❌ 處理請求時發生錯誤:', error);
    
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error.message || '未知錯誤',
        details: error.toString(),
      }),
      { 
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});
