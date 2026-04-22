import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface CartItemInput {
  equipmentId: string;
  equipmentName: string;
  quantity: number;
  dailyPrice: number;
  deposit: number;
}

interface CreateOrderRequest {
  startDate: string;
  endDate: string;
  pickupLocationId: string;
  returnLocationId: string;
  needVehicle?: boolean;
  notes?: string;
  cartItems: CartItemInput[];
}

function jsonResponse(body: object, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

  try {
    // ── STEP 1: 驗證 Bearer JWT
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return jsonResponse({ success: false, error: "unauthorized", message: "缺少身分驗證標頭" }, 401);
    }

    const token = authHeader.replace("Bearer ", "");
    const supabaseUser = createClient(supabaseUrl, anonKey);
    const { data: { user }, error: authError } = await supabaseUser.auth.getUser(token);

    if (authError || !user) {
      return jsonResponse({ success: false, error: "unauthorized", message: "身分驗證失敗，請重新登入" }, 401);
    }

    // ── STEP 2: 解析 body
    let body: CreateOrderRequest;
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ success: false, error: "invalid_body", message: "請求格式錯誤" }, 400);
    }

    const {
      startDate,
      endDate,
      pickupLocationId,
      returnLocationId,
      needVehicle = false,
      notes = "",
      cartItems,
    } = body;

    // ── STEP 3: 基本輸入驗證
    if (!startDate || !endDate) {
      return jsonResponse({ success: false, error: "invalid_dates", message: "開始日期與結束日期為必填" }, 400);
    }

    const start = new Date(startDate);
    const end = new Date(endDate);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return jsonResponse({ success: false, error: "invalid_dates", message: "日期格式不正確，請使用 YYYY-MM-DD" }, 400);
    }

    if (end < start) {
      return jsonResponse({ success: false, error: "invalid_dates", message: "結束日期不能早於開始日期" }, 400);
    }

    if (!pickupLocationId || !returnLocationId) {
      return jsonResponse({ success: false, error: "invalid_location", message: "取件門市與歸還門市為必填" }, 400);
    }

    if (!cartItems || !Array.isArray(cartItems) || cartItems.length === 0) {
      return jsonResponse({ success: false, error: "empty_cart", message: "預約車不可為空" }, 400);
    }

    for (const item of cartItems) {
      if (!item.equipmentId || !item.quantity || item.quantity <= 0) {
        return jsonResponse({
          success: false,
          error: "invalid_cart_item",
          message: "購物車項目資料不完整",
          details: { item },
        }, 400);
      }
      if (typeof item.dailyPrice !== "number" || item.dailyPrice < 0) {
        return jsonResponse({ success: false, error: "invalid_cart_item", message: "器材日租金格式不正確" }, 400);
      }
      if (typeof item.deposit !== "number" || item.deposit < 0) {
        return jsonResponse({ success: false, error: "invalid_cart_item", message: "器材押金格式不正確" }, 400);
      }
    }

    if (notes && notes.length > 500) {
      return jsonResponse({ success: false, error: "notes_too_long", message: "備註不得超過 500 字" }, 400);
    }

    // 使用 service role 操作 DB
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // ── STEP 4: 驗證 location 存在
    const locationIds = [...new Set([pickupLocationId, returnLocationId])];
    const { data: locationRows, error: locationError } = await supabaseAdmin
      .from("locations")
      .select("id")
      .in("id", locationIds);

    if (locationError) {
      console.error("[create-order] locations 查詢失敗:", locationError);
      return jsonResponse({ success: false, error: "internal_error", message: "門市資料查詢失敗" }, 500);
    }

    const foundLocationIds = (locationRows ?? []).map((r: { id: string }) => r.id);
    if (!foundLocationIds.includes(pickupLocationId)) {
      return jsonResponse({ success: false, error: "invalid_location", message: "取件門市不存在" }, 400);
    }
    if (!foundLocationIds.includes(returnLocationId)) {
      return jsonResponse({ success: false, error: "invalid_location", message: "歸還門市不存在" }, 400);
    }

    // ── STEP 5: 查詢客戶（auth_user_id 強制由 JWT 決定，不接受前端傳入）
    // ✅ 補查 discount 欄位，用於折扣計算
    const { data: customer, error: customerError } = await supabaseAdmin
      .from("customers")
      .select("id, member_level, discount")
      .eq("auth_user_id", user.id)
      .maybeSingle();

    if (customerError) {
      console.error("[create-order] customers 查詢失敗:", customerError);
      return jsonResponse({ success: false, error: "internal_error", message: "客戶資料查詢失敗" }, 500);
    }

    if (!customer) {
      return jsonResponse({ success: false, error: "customer_not_found", message: "找不到客戶資料，請先完善個人資料" }, 404);
    }

    // ── STEP 6: 批次查詢 DB 正式價格，比對並建立 snapshot
    const productIds = cartItems.map((item) => item.equipmentId);
    const { data: productRows, error: productError } = await supabaseAdmin
      .from("products")
      .select("id, daily_price, deposit")
      .in("id", productIds);

    if (productError) {
      console.error("[create-order] products 查詢失敗:", productError);
      return jsonResponse({ success: false, error: "internal_error", message: "器材資料查詢失敗" }, 500);
    }

    const productMap = new Map<string, { daily_price: number; deposit: number }>();
    for (const p of (productRows ?? [])) {
      productMap.set(p.id, { daily_price: p.daily_price, deposit: p.deposit });
    }

    // 比對每筆 cartItem 的 dailyPrice / deposit 與 DB 是否一致
    for (const item of cartItems) {
      const dbProduct = productMap.get(item.equipmentId);
      if (!dbProduct) {
        return jsonResponse({
          success: false,
          error: "invalid_cart_item",
          message: `找不到器材資料（id: ${item.equipmentId}）`,
        }, 400);
      }
      if (item.dailyPrice !== dbProduct.daily_price) {
        return jsonResponse({
          success: false,
          error: "price_mismatch",
          message: "商品價格已更新，請重新確認訂單",
          details: {
            equipmentId: item.equipmentId,
            frontendPrice: item.dailyPrice,
            dbPrice: dbProduct.daily_price,
          },
        }, 400);
      }
      if (item.deposit !== dbProduct.deposit) {
        return jsonResponse({
          success: false,
          error: "deposit_mismatch",
          message: "押金金額已更新，請重新確認訂單",
          details: {
            equipmentId: item.equipmentId,
            frontendDeposit: item.deposit,
            dbDeposit: dbProduct.deposit,
          },
        }, 400);
      }
    }

    // ── STEP 7: EF 自行計算所有金額（不信任前端傳入值）
    const diffMs = end.getTime() - start.getTime();
    const rentalDays = Math.max(1, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
    const vehicleRentPerDay = 2000;

    // 器材全價小計
    const equipmentRent = cartItems.reduce((sum, item) => {
      const dbProduct = productMap.get(item.equipmentId)!;
      return sum + dbProduct.daily_price * item.quantity * rentalDays;
    }, 0);

    // ✅ 折扣計算：器材租金套折扣，車輛租金不打折
    // discount 欄位為百分比整數（如 80 = 8折），null 視為 100（不打折）
    const discountRate: number = customer.discount ?? 100;
    const discountedEquipment = Math.round(equipmentRent * discountRate / 100);
    const vehicleRent = needVehicle ? vehicleRentPerDay * rentalDays : 0;

    // total_price = 折後器材租金 + 車輛租金（車輛不打折）
    const totalRent = discountedEquipment + vehicleRent;

    const totalDeposit = cartItems.reduce((sum, item) => {
      const dbProduct = productMap.get(item.equipmentId)!;
      return sum + dbProduct.deposit * item.quantity;
    }, 0);

    console.log(`[create-order] 金額計算: equipmentRent=${equipmentRent}, discountRate=${discountRate}%, discountedEquipment=${discountedEquipment}, vehicleRent=${vehicleRent}, totalRent=${totalRent}`);

    // ── STEP 8: 查詢 prepaid_accounts（gold 會員才查，僅判斷，不扣款）
    let isPrepaidMember = false;
    let prepaidBalanceSufficient = false;

    if (customer.member_level === "gold") {
      isPrepaidMember = true;
      const { data: prepaidAccount } = await supabaseAdmin
        .from("prepaid_accounts")
        .select("real_balance, bonus_balance")
        .eq("customer_id", customer.id)
        .maybeSingle();

      if (prepaidAccount) {
        const totalBalance = prepaidAccount.real_balance + prepaidAccount.bonus_balance;
        prepaidBalanceSufficient = totalBalance >= totalRent;
      }
    }

    // ── STEP 9: 組備註（含車輛資訊）
    let orderNotes = notes;
    if (needVehicle) {
      orderNotes = (orderNotes ? orderNotes + "\n\n" : "") + "【加租車輛】\n客戶要求加租車輛（油錢、過路費另計）";
    }

    // ── STEP 10: 組 order_number（EF 自行產生，前端不可傳入）
    const orderNumber = `ORD-${Date.now()}`;

    // ── STEP 11: INSERT orders
    const { data: newOrder, error: orderError } = await supabaseAdmin
      .from("orders")
      .insert({
        order_number: orderNumber,
        customer_id: customer.id,
        user_id: user.id,                       // JWT 確認，不接受前端偽造
        start_date: startDate,
        end_date: endDate,
        pickup_location_id: pickupLocationId,
        return_location_id: returnLocationId,
        total_price: totalRent,                 // ✅ 折後器材 + 車輛（不打折）
        total_deposit: totalDeposit,
        total_amount: totalRent,
        status: "pending",
        notes: orderNotes,
        vehicle_included: needVehicle,
        vehicle_confirmed: false,
        vehicle_fee: vehicleRent,
        prepaid_used: false,
        prepaid_real_amount: 0,
        prepaid_bonus_amount: 0,
      })
      .select("id")
      .single();

    if (orderError || !newOrder) {
      console.error("[create-order] orders insert 失敗:", orderError);
      return jsonResponse({
        success: false,
        error: "order_insert_failed",
        message: "訂單建立失敗，請稍後再試",
        details: orderError,
      }, 409);
    }

    const orderId = newOrder.id;

    // ── STEP 12: INSERT order_items（snapshot 一律寫 DB 值）
    const orderItemsData = cartItems.map((item) => {
      const dbProduct = productMap.get(item.equipmentId)!;
      return {
        order_id: orderId,
        product_id: item.equipmentId,
        quantity: item.quantity,
        daily_price_snapshot: dbProduct.daily_price,   // ← 強制使用 DB 值（snapshot 規則）
        deposit_snapshot: dbProduct.deposit,            // ← 強制使用 DB 值（snapshot 規則）
        subtotal: dbProduct.daily_price * item.quantity * rentalDays,
        days: rentalDays,
      };
    });

    const { error: itemsError } = await supabaseAdmin
      .from("order_items")
      .insert(orderItemsData);

    if (itemsError) {
      console.error("[create-order] order_items insert 失敗，執行補償:", itemsError);
      // 補償：刪除剛建立的 order（order_items ON DELETE CASCADE 自動清除）
      await supabaseAdmin.from("orders").delete().eq("id", orderId);
      return jsonResponse({
        success: false,
        error: "order_items_insert_failed",
        message: "訂單明細建立失敗，訂單已自動取消，請稍後再試",
        details: itemsError,
      }, 409);
    }

    // ── STEP 13: INSERT order_logs（獨立 try/catch，失敗不影響主流程）
    try {
      let logDescription = "客戶建立訂單";
      if (discountRate < 100) {
        logDescription += `（${discountRate}% 折扣，器材租金折後 NT$${discountedEquipment.toLocaleString()}）`;
      }
      if (needVehicle) {
        logDescription += `（含車輛租金 NT$${vehicleRent.toLocaleString()}，不打折）`;
      }
      if (isPrepaidMember) {
        logDescription += prepaidBalanceSufficient
          ? "（儲值會員，餘額充足，待合約簽署時扣款）"
          : "（儲值會員，餘額不足，需現金補足）";
      }

      await supabaseAdmin.from("order_logs").insert({
        order_id: orderId,
        action_type: "order_created",
        description: logDescription,
      });
    } catch (logError) {
      // 非關鍵操作，只記錄不拋出
      console.error("[create-order] order_logs insert 失敗（非關鍵）:", logError);
    }

    console.log(`[create-order] ✅ 訂單建立成功 orderId=${orderId} orderNumber=${orderNumber} customerId=${customer.id} discountRate=${discountRate}%`);

    // ── STEP 14: 回傳成功
    // ✅ 新增回傳 discountRate，供前台 success page 顯示折扣資訊
    return jsonResponse({
      success: true,
      orderId,
      orderNumber,
      isPrepaidMember,
      prepaidBalanceSufficient,
      discountRate,
    }, 200);

  } catch (err) {
    console.error("[create-order] 未預期錯誤:", err);
    return jsonResponse({ success: false, error: "internal_error", message: "伺服器錯誤，請稍後再試" }, 500);
  }
});
