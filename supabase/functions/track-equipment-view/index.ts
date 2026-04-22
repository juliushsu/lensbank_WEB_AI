import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { product_id } = await req.json()

    if (!product_id) {
      return new Response(
        JSON.stringify({ error: 'product_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // 使用 service role key 來繞過 RLS
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // 先取得目前的 view_count
    const { data: currentData, error: fetchError } = await supabase
      .from('products')
      .select('view_count')
      .eq('id', product_id)
      .maybeSingle()

    if (fetchError) {
      console.error('❌ 查詢產品失敗:', fetchError)
      return new Response(
        JSON.stringify({ error: `查詢產品失敗: ${fetchError.message}` }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (!currentData) {
      return new Response(
        JSON.stringify({ error: '產品不存在' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const currentCount = currentData.view_count || 0

    // 更新 view_count
    const { data: updatedData, error: updateError } = await supabase
      .from('products')
      .update({ view_count: currentCount + 1 })
      .eq('id', product_id)
      .select('view_count')
      .maybeSingle()

    if (updateError) {
      console.error('❌ 更新瀏覽次數失敗:', updateError)
      return new Response(
        JSON.stringify({ error: `更新瀏覽次數失敗: ${updateError.message}` }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    return new Response(
      JSON.stringify({ success: true, view_count: updatedData?.view_count }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (err) {
    console.error('❌ Edge Function 執行錯誤:', err)
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})