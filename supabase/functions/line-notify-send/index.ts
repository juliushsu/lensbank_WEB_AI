
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const LINE_NOTIFY_API = "https://notify-api.line.me/api/notify";

const STATUS_LABELS: Record<string, string> = {
  pending: "待確認",
  confirmed: "已確認",
  ready: "備貨完成",
  renting: "租借中",
  completed: "已完成",
  cancelled: "已取消",
};

const DEFAULT_TEMPLATES: Record<string, string> = {
  confirmed: "📦 訂單已確認\n\n訂單編號：{{order_number}}\n租借期間：{{start_date}} - {{end_date}}\n取件門市：{{pickup_location}}\n\n我們已收到您的訂單，正在為您準備器材。\n如有任何問題，請聯繫我們！",
  ready: "✅ 器材備妥通知\n\n訂單編號：{{order_number}}\n租借期間：{{start_date}} - {{end_date}}\n取件門市：{{pickup_location}}\n\n您的器材已備妥，歡迎於租借日前來取件！",
  renting: "🎬 租借開始\n\n訂單編號：{{order_number}}\n歸還日期：{{end_date}}\n歸還門市：{{return_location}}\n\n祝您拍攝順利！請記得於歸還日前歸還器材。",
  completed: "🎉 訂單完成\n\n訂單編號：{{order_number}}\n\n感謝您的租借！期待下次為您服務。",
  cancelled: "❌ 訂單已取消\n\n訂單編號：{{order_number}}\n\n您的訂單已取消。如有任何疑問，請聯繫我們。",
};

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const body = await req.json();
    const { action, token, order_id, old_status, new_status, message } = body;

    // 測試模式
    if (action === "test") {
      const testMessage = `
🔔 LINE Notify 測試訊息

這是一則測試訊息，確認 LINE Notify 已成功連接！

時間：${new Date().toLocaleString("zh-TW", { timeZone: "Asia/Taipei" })}
      `.trim();

      const result = await sendLineNotify(token, testMessage);
      
      return new Response(
        JSON.stringify(result),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 測試範本模式
    if (action === "test_template" && message) {
      const result = await sendLineNotify(token, message);
      
      return new Response(
        JSON.stringify(result),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 訂單狀態變更通知
    if (action === "order_status_change" && order_id) {
      // 取得 LINE Notify 設定
      const { data: settings } = await supabase
        .from("line_notify_settings")
        .select("*")
        .eq("is_active", true)
        .maybeSingle();

      if (!settings) {
        return new Response(
          JSON.stringify({ success: false, error: "LINE Notify 未啟用" }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // 檢查是否需要通知此狀態
      if (!settings.notify_statuses?.includes(new_status)) {
        return new Response(
          JSON.stringify({ success: true, message: "此狀態不需通知" }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // 取得訂單資訊
      const { data: order } = await supabase
        .from("orders")
        .select(`
          *,
          customer:customers(name, email, phone, line_id),
          pickup_location:locations!pickup_location_id(name_zh),
          return_location:locations!return_location_id(name_zh)
        `)
        .eq("id", order_id)
        .maybeSingle();

      if (!order) {
        return new Response(
          JSON.stringify({ success: false, error: "找不到訂單" }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // 取得範本
      const templates = settings.message_templates || DEFAULT_TEMPLATES;
      let messageTemplate = templates[new_status] || DEFAULT_TEMPLATES[new_status];

      // 計算租借天數
      const startDate = new Date(order.start_date);
      const endDate = new Date(order.end_date);
      const rentalDays = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;

      // 替換變數
      const variables: Record<string, string> = {
        "{{order_number}}": order.order_number || "",
        "{{customer_name}}": order.customer?.name || "貴賓",
        "{{start_date}}": formatDate(order.start_date),
        "{{end_date}}": formatDate(order.end_date),
        "{{pickup_location}}": order.pickup_location?.name_zh || "未指定",
        "{{return_location}}": order.return_location?.name_zh || order.pickup_location?.name_zh || "未指定",
        "{{total_amount}}": `NT$ ${(order.total_amount || 0).toLocaleString()}`,
        "{{rental_days}}": `${rentalDays} 天`,
        "{{old_status}}": STATUS_LABELS[old_status] || old_status,
        "{{new_status}}": STATUS_LABELS[new_status] || new_status,
      };

      let finalMessage = messageTemplate;
      for (const [key, value] of Object.entries(variables)) {
        finalMessage = finalMessage.replace(new RegExp(key.replace(/[{}]/g, "\\$&"), "g"), value);
      }

      // 發送通知（使用系統 Token）
      const result = await sendLineNotify(settings.access_token, finalMessage);

      return new Response(
        JSON.stringify(result),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ success: false, error: "無效的操作" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("LINE Notify Error:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});

async function sendLineNotify(token: string, message: string) {
  try {
    const response = await fetch(LINE_NOTIFY_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Authorization": `Bearer ${token}`,
      },
      body: `message=${encodeURIComponent(message)}`,
    });

    const result = await response.json();

    if (response.ok && result.status === 200) {
      return { success: true, message: "通知發送成功" };
    } else {
      return { success: false, error: result.message || "發送失敗" };
    }
  } catch (error) {
    return { success: false, error: error.message };
  }
}

function formatDate(dateStr: string): string {
  if (!dateStr) return "未指定";
  const date = new Date(dateStr);
  return `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")}`;
}
