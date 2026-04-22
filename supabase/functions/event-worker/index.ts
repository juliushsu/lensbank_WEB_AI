
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface EventRecord {
  id: string;
  event_type: string;
  aggregate_type: string;
  aggregate_id: string;
  payload: Record<string, any>;
  retry_count: number;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    console.log('🚀 Event Worker 開始執行...');

    // 1. 領取待處理事件
    const { data: events, error: claimError } = await supabase
      .rpc('claim_events', { batch_size: 10 });

    if (claimError) {
      console.error('❌ 領取事件失敗:', claimError);
      throw claimError;
    }

    if (!events || events.length === 0) {
      console.log('✅ 沒有待處理事件');
      return new Response(
        JSON.stringify({ success: true, message: '沒有待處理事件', processed: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`📋 領取到 ${events.length} 個事件`);

    let successCount = 0;
    let failCount = 0;

    for (const event of events as EventRecord[]) {
      try {
        console.log(`🔄 處理事件: ${event.event_type} (${event.id})`);

        switch (event.event_type) {
          case 'order_status_changed':
            await handleOrderStatusChanged(event, supabase);
            break;
          case 'equipment_allocated':
            await handleEquipmentAllocated(event, supabase);
            break;
          case 'equipment_item_status_changed':
            await handleEquipmentItemStatusChanged(event, supabase);
            break;
          case 'prepaid_transaction_created':
            await handlePrepaidTransaction(event, supabase);
            break;
          case 'urent_transaction_created':
            await handleUrentTransaction(event, supabase);
            break;
          default:
            console.log(`⚠️ 未知事件類型: ${event.event_type}，跳過`);
        }

        // 標記完成
        const { error: doneError } = await supabase
          .rpc('mark_event_done', { event_id: event.id });

        if (doneError) throw doneError;

        successCount++;
        console.log(`✅ 事件處理完成: ${event.id}`);

      } catch (error) {
        failCount++;
        console.error(`❌ 事件處理失敗: ${event.id}`, error);
        const errorMessage = error instanceof Error ? error.message : String(error);
        await supabase.rpc('mark_event_failed', {
          event_id: event.id,
          error_msg: errorMessage,
          max_retries: 3,
        });
      }
    }

    console.log(`✅ Worker 完成: 成功 ${successCount}, 失敗 ${failCount}`);

    return new Response(
      JSON.stringify({ success: true, processed: events.length, success_count: successCount, fail_count: failCount }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('❌ Worker 執行失敗:', error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : String(error) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

/* ─────────────────────────────────────────────
   共用：LINE 通知
   ───────────────────────────────────────────── */
async function trySendLine(message: string) {
  const lineToken = Deno.env.get('LINE_NOTIFY_TOKEN');
  if (!lineToken) {
    console.log('⚠️ LINE_NOTIFY_TOKEN 未設定，跳過');
    return;
  }
  const res = await fetch('https://notify-api.line.me/api/notify', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${lineToken}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: `message=${encodeURIComponent(message)}`,
  });
  if (!res.ok) throw new Error(`LINE API 回應錯誤: ${res.status}`);
  console.log('✅ LINE 通知已發送');
}

/* ─────────────────────────────────────────────
   共用：Google Calendar 同步
   ───────────────────────────────────────────── */
async function trySyncCalendar(payload: Record<string, any>, supabase: any) {
  try {
    const { data: settings } = await supabase
      .from('google_calendar_settings')
      .select('*')
      .eq('is_active', true)
      .maybeSingle();

    if (!settings) {
      console.log('⚠️ Google Calendar 未設定，跳過');
      return;
    }
    // TODO: 實作 Google Calendar 同步邏輯
    console.log('⚠️ Google Calendar 同步邏輯尚未完整實作');
  } catch (err) {
    console.error('❌ Google Calendar 同步失敗:', err);
  }
}

/* ─────────────────────────────────────────────
   1. 訂單狀態變更
   ───────────────────────────────────────────── */
const STATUS_TEXT: Record<string, string> = {
  pending: '待處理',
  confirmed: '已確認',
  in_progress: '進行中',
  completed: '已完成',
  cancelled: '已取消',
};

async function handleOrderStatusChanged(event: EventRecord, supabase: any) {
  const p = event.payload;
  console.log(`📦 訂單狀態變更: ${p.order_number} (${p.old_status} → ${p.new_status})`);

  // LINE
  try {
    await trySendLine(`
📦 訂單狀態更新
訂單編號: ${p.order_number}
客戶: ${p.customer_name}
狀態: ${STATUS_TEXT[p.old_status] || p.old_status} → ${STATUS_TEXT[p.new_status] || p.new_status}
租借期間: ${p.rental_start || '-'} ~ ${p.rental_end || '-'}
時間: ${fmtTime(p.changed_at)}`);
  } catch (e) { console.error('LINE 失敗:', e); }

  // Calendar
  await trySyncCalendar(p, supabase);
}

/* ─────────────────────────────────────────────
   2. 器材分配
   ───────────────────────────────────────────── */
async function handleEquipmentAllocated(event: EventRecord, supabase: any) {
  const p = event.payload;
  console.log(`🔧 器材分配: ${p.product_name} (${p.serial_number}) → 訂單 ${p.order_number}`);

  const urentTag = p.is_urent_item ? ' [Urent 託管品項]' : '';
  const externalTag = p.is_external_dispatch ? ' [外調]' : '';

  try {
    await trySendLine(`
🔧 器材分配通知${urentTag}${externalTag}
訂單編號: ${p.order_number}
客戶: ${p.customer_name}
器材: ${p.product_name}
序號: ${p.serial_number}
時間: ${fmtTime(p.allocated_at)}`);
  } catch (e) { console.error('LINE 失敗:', e); }
}

/* ─────────────────────────────────────────────
   3. 品項狀態變更
   ───────────────────────────────────────────── */
const ITEM_STATUS_TEXT: Record<string, string> = {
  available: '可用',
  rented: '已出租',
  maintenance: '維修中',
  retired: '已報廢',
};

const URENT_STATUS_TEXT: Record<string, string> = {
  idle: '閒置',
  rented: '出租中',
  exited: '已退出',
};

async function handleEquipmentItemStatusChanged(event: EventRecord, supabase: any) {
  const p = event.payload;

  // 一般狀態變更
  const statusChanged = p.old_status !== p.new_status;
  const urentStatusChanged = p.old_urent_status !== p.new_urent_status;

  console.log(`📟 品項狀態變更: ${p.serial_number} | status: ${p.old_status}→${p.new_status} | urent: ${p.old_urent_status}→${p.new_urent_status}`);

  // 只在重要狀態變更時發 LINE（送修、報廢、Urent 狀態變更）
  const isImportant =
    (statusChanged && (p.new_status === 'maintenance' || p.new_status === 'retired')) ||
    (urentStatusChanged && p.is_urent_equipment);

  if (isImportant) {
    const lines: string[] = [`📟 品項狀態變更`, `器材: ${p.product_name}`, `序號: ${p.serial_number}`];

    if (statusChanged) {
      lines.push(`狀態: ${ITEM_STATUS_TEXT[p.old_status] || p.old_status} → ${ITEM_STATUS_TEXT[p.new_status] || p.new_status}`);
    }
    if (urentStatusChanged && p.is_urent_equipment) {
      lines.push(`Urent: ${URENT_STATUS_TEXT[p.old_urent_status] || p.old_urent_status || '無'} → ${URENT_STATUS_TEXT[p.new_urent_status] || p.new_urent_status}`);
    }
    lines.push(`時間: ${fmtTime(p.changed_at)}`);

    try {
      await trySendLine('\n' + lines.join('\n'));
    } catch (e) { console.error('LINE 失敗:', e); }
  }
}

/* ─────────────────────────────────────────────
   4. 儲值金交易
   ───────────────────────────────────────────── */
const PREPAID_TYPE_TEXT: Record<string, string> = {
  deposit: '儲值',
  bonus: '贈金',
  payment: '扣款',
  refund: '退款',
  adjustment: '調整',
  void: '作廢',
};

async function handlePrepaidTransaction(event: EventRecord, supabase: any) {
  const p = event.payload;
  console.log(`💰 儲值金交易: ${p.transaction_type} | 客戶: ${p.customer_name} | 餘額: ${p.balance_before}→${p.balance_after}`);

  const typeLabel = PREPAID_TYPE_TEXT[p.transaction_type] || p.transaction_type;
  const totalChange = (p.real_amount || 0) + (p.bonus_amount || 0);
  const sign = totalChange >= 0 ? '+' : '';
  const orderLine = p.order_number ? `\n關聯訂單: ${p.order_number}` : '';

  try {
    await trySendLine(`
💰 儲值金${typeLabel}通知
客戶: ${p.customer_name}
類型: ${typeLabel}
金額: ${sign}${totalChange} 元（實付 ${p.real_amount || 0} / 贈金 ${p.bonus_amount || 0}）
餘額: ${p.balance_before} → ${p.balance_after}${orderLine}
說明: ${p.description || '-'}
時間: ${fmtTime(p.created_at)}`);
  } catch (e) { console.error('LINE 失敗:', e); }
}

/* ─────────────────────────────────────────────
   5. Urent 收入交易
   ───────────────────────────────────────────── */
const URENT_TYPE_TEXT: Record<string, string> = {
  income: '出租收入',
  withdrawal: '提領',
  conversion: '轉儲值金',
  adjustment: '調整',
};

async function handleUrentTransaction(event: EventRecord, supabase: any) {
  const p = event.payload;
  console.log(`🏦 Urent 交易: ${p.transaction_type} | 客戶: ${p.customer_name} | 收入: ${p.income_amount}`);

  const typeLabel = URENT_TYPE_TEXT[p.transaction_type] || p.transaction_type;
  const orderLine = p.order_number ? `\n關聯訂單: ${p.order_number}` : '';
  const equipLine = p.serial_number ? `\n器材: ${p.product_name} (${p.serial_number})` : '';

  let detailLines = '';
  if (p.transaction_type === 'income') {
    detailLines = `
租借天數: ${p.rental_days || '-'} 天
租金: ${p.rental_amount || 0} 元
佣金率: ${p.commission_rate ? (Number(p.commission_rate) * 100).toFixed(0) + '%' : '-'}
佣金: ${p.commission_amount || 0} 元
淨收入: ${p.income_amount || 0} 元`;
  }

  try {
    await trySendLine(`
🏦 Urent ${typeLabel}通知
客戶: ${p.customer_name}
類型: ${typeLabel}${equipLine}${orderLine}${detailLines}
餘額: ${p.balance_before ?? '-'} → ${p.balance_after ?? '-'}
說明: ${p.description || '-'}
時間: ${fmtTime(p.created_at)}`);
  } catch (e) { console.error('LINE 失敗:', e); }
}

/* ─────────────────────────────────────────────
   工具函數
   ───────────────────────────────────────────── */
function fmtTime(ts: string | null): string {
  if (!ts) return '-';
  try {
    return new Date(ts).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });
  } catch {
    return ts;
  }
}
