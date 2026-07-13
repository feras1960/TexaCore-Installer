import{s as y,Q as a}from"./index-DKKiHqbR.js";import"./vendor-data-BWRv08bE.js";import"./vendor-react-CtdH4caE.js";import"./vendor-pdf-B4TnB1dM.js";import"./vendor-ui-Db1jj24y.js";import"./vendor-charts-Bj5N56Ou.js";import"./vendor-xlsx-BkI8taly.js";import"./vendor-echarts-DnurwZoN.js";import"./vendor-livekit-WT0eXGDi.js";const v={receipt_order:{sourceType:"warehouse",notifType:"info"},issue_order:{sourceType:"warehouse",notifType:"info"},shipment_arrival:{sourceType:"container",notifType:"success"},warehouse_transfer:{sourceType:"warehouse",notifType:"info"},warehouse_picking:{sourceType:"sales",notifType:"info"},warehouse_receiving:{sourceType:"purchases",notifType:"info"},warehouse_transfer_picking:{sourceType:"warehouse",notifType:"info"},low_stock:{sourceType:"warehouse",notifType:"warning"},payment_received:{sourceType:"finance",notifType:"success"},payment_sent:{sourceType:"finance",notifType:"info"},price_update:{sourceType:"inventory",notifType:"warning"},delivery_route:{sourceType:"delivery",notifType:"info"},sales_order:{sourceType:"sales",notifType:"success"},invoice_due:{sourceType:"finance",notifType:"warning"},credit_limit:{sourceType:"finance",notifType:"error"},inventory_task:{sourceType:"warehouse",notifType:"info"},security_alert:{sourceType:"security",notifType:"warning"},test_notification:{sourceType:"system",notifType:"info"},remittance_created:{sourceType:"exchange",notifType:"info"},remittance_sent:{sourceType:"exchange",notifType:"success"},remittance_delivered:{sourceType:"exchange",notifType:"success"},remittance_incoming:{sourceType:"exchange",notifType:"info"},remittance_cancelled:{sourceType:"exchange",notifType:"warning"},remittance_status_change:{sourceType:"exchange",notifType:"info"},ecom_new_order:{sourceType:"ecommerce",notifType:"info"},ecom_order_confirmed:{sourceType:"ecommerce",notifType:"success"},ecom_order_shipped:{sourceType:"ecommerce",notifType:"info"},ecom_order_delivered:{sourceType:"ecommerce",notifType:"success"},ecom_order_cancelled:{sourceType:"ecommerce",notifType:"warning"},ecom_payment_received:{sourceType:"ecommerce",notifType:"success"},ecom_order_returned:{sourceType:"ecommerce",notifType:"warning"},ecom_low_stock:{sourceType:"ecommerce",notifType:"warning"}};async function b(o,e,r,n,c){try{const{data:{session:l}}=await y.auth.getSession();if(!l)return{ok:!1,error:"Not authenticated"};let m={ok:!0};try{const $=await a.functions.invoke("telegram-webhook",{body:{action:"dispatch_notification",company_id:o,event_type:e,html_message:r,...n?{target_warehouse_id:n}:{},...c?{role_messages:c}:{}}});$.error&&console.warn(`[TelegramNotify] ${e} response error (may be CORS):`,$.error),m=($==null?void 0:$.data)||{ok:!0,sent:1}}catch($){console.warn(`[TelegramNotify] ${e} fetch error (likely CORS, message may have been sent):`,$),m={ok:!0,sent:1,cors_fallback:!0}}try{const $=v[e]||{sourceType:"system",notifType:"info"},i=r.replace(/<[^>]+>/g,"").trim().split(`
`).filter(p=>p.trim()&&!p.includes("━")),s=i[0]||e,u=i.slice(1,4).join(`
`).trim();await y.from("notifications").insert({user_id:l.user.id,tenant_id:o,title:s,body:u||null,type:$.notifType,source_type:$.sourceType,metadata:{event_type:e,company_id:o}})}catch($){console.warn("[TelegramNotify] In-app save failed:",$)}return(m==null?void 0:m.sent)>0&&console.log(`[TelegramNotify] ${e}: sent=${m.sent}`),m}catch(l){return console.warn("[TelegramNotify] Error:",l),{ok:!1,error:"Network error"}}}async function B(o,e){var r,n,c;try{const{data:{session:l}}=await y.auth.getSession();if(!l)return{ok:!1,error:"Not authenticated"};const m=((r=l.user.user_metadata)==null?void 0:r.full_name)||l.user.email||"User",$=new Date().toLocaleTimeString("en-US",{hour:"2-digit",minute:"2-digit"});if(o==="telegram"){const t=`🧪 <b>إشعار تجريبي — Test Notification</b>
━━━━━━━━━━━━━━━━━━━━

✅ مرحباً <b>${m}</b>
📱 إشعارات التلغرام تعمل بنجاح!
⏰ ${$}

— TexaCore ERP`;let i=e||((n=l.user.app_metadata)==null?void 0:n.company_id);if(!i){const{data:s}=await y.from("user_profiles").select("company_id").eq("id",l.user.id).maybeSingle();i=s==null?void 0:s.company_id}if(i){const s=await b(i,"test_notification",t);return{ok:!!(s!=null&&s.ok)||!!(s!=null&&s.sent)}}return{ok:!1,error:"No company ID"}}if(o==="email"){const t=`
<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f6f9;font-family:'Segoe UI',Tahoma,Arial,sans-serif;">
<div style="max-width:520px;margin:32px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
  <!-- Header -->
  <div style="background:linear-gradient(135deg,#0f172a 0%,#1e3a5f 50%,#2563eb 100%);padding:32px 24px;text-align:center;">
    <div style="font-size:28px;font-weight:800;color:#fff;letter-spacing:1px;">TexaCore</div>
    <div style="font-size:12px;color:#93c5fd;margin-top:4px;">Enterprise Resource Planning</div>
  </div>
  <!-- Content -->
  <div style="padding:32px 28px;text-align:center;">
    <div style="width:64px;height:64px;margin:0 auto 16px;background:linear-gradient(135deg,#10b981,#059669);border-radius:50%;display:flex;align-items:center;justify-content:center;">
      <span style="font-size:32px;line-height:64px;">✅</span>
    </div>
    <h2 style="margin:0 0 8px;color:#1e293b;font-size:22px;">إشعار تجريبي ناجح</h2>
    <p style="margin:0 0 20px;color:#64748b;font-size:15px;line-height:1.6;">
      مرحباً <strong style="color:#1e293b;">${m}</strong><br>
      إشعارات البريد الإلكتروني تعمل بنجاح!
    </p>
    <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:16px;margin:20px 0;">
      <div style="display:inline-block;background:#059669;color:#fff;font-size:12px;font-weight:700;padding:4px 12px;border-radius:20px;margin-bottom:8px;">CONNECTED</div>
      <p style="margin:8px 0 0;color:#166534;font-size:13px;">📧 ${l.user.email}</p>
      <p style="margin:4px 0 0;color:#166534;font-size:13px;">⏰ ${$}</p>
    </div>
    <p style="color:#94a3b8;font-size:12px;margin-top:24px;line-height:1.5;">
      ستستقبل إشعارات المبيعات والمشتريات والمستودع<br>
      والمقبوضات والمدفوعات ومهام الفريق
    </p>
  </div>
  <!-- Footer -->
  <div style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:16px 24px;text-align:center;">
    <p style="margin:0;color:#94a3b8;font-size:11px;">
      TexaCore ERP — جودة تستحق الثقة
    </p>
    <p style="margin:4px 0 0;color:#cbd5e1;font-size:10px;">
      هذا إشعار تجريبي • يمكنك إدارة تفضيلاتك من الملف الشخصي
    </p>
  </div>
</div>
</body>
</html>`;return{ok:!(await a.functions.invoke("send-email",{body:{to:l.user.email,subject:"✅ TexaCore — إشعار تجريبي ناجح",html:t}})).error}}if(o==="in_app"){let t=(c=l.user.app_metadata)==null?void 0:c.company_id;if(!t){const{data:i}=await y.from("user_profiles").select("company_id").eq("id",l.user.id).maybeSingle();t=i==null?void 0:i.company_id}return await y.from("notifications").insert({user_id:l.user.id,tenant_id:t,title:"🧪 إشعار تجريبي — Test",body:`✅ الإشعارات الداخلية تعمل بنجاح! (${$})`,type:"success",source_type:"system",metadata:{test:!0}}),{ok:!0}}return{ok:!1,error:"Unknown channel"}}catch(l){return{ok:!1,error:(l==null?void 0:l.message)||"Error"}}}function h(o){return o!=null&&o.length?o.map(e=>{let r=`• ${e.name} — <b>${e.qty}</b>`;return e.unit&&(r+=` ${e.unit}`),e.rolls&&(r+=` (${e.rolls} رول)`),r}).join(`
`):""}async function _(o,e){if(!(o!=null&&o.length))return{};try{let r=y.from("fabric_rolls").select("material_id, current_length, bin_location:bin_locations(code, name, row_code, column_code)").in("material_id",o).in("status",["available","reserved","in_stock"]).not("bin_location_id","is",null);e&&(r=r.eq("warehouse_id",e));const{data:n,error:c}=await r;if(c||!(n!=null&&n.length))return{};const l={},m={};for(const $ of n){const t=$.material_id,i=$.bin_location;if(!t||!(i!=null&&i.code))continue;m[t]||(m[t]={});const s=i.code;m[t][s]||(m[t][s]={code:i.code,name:i.name||`${i.row_code||""}${i.column_code||""}`,count:0,length:0}),m[t][s].count++,m[t][s].length+=Number($.current_length)||0}for(const[$,t]of Object.entries(m))l[$]=Object.values(t).sort((i,s)=>s.count-i.count).map(i=>({binCode:i.code,binName:i.name,rollCount:i.count,totalLength:Math.round(i.length*100)/100}));return l}catch{return{}}}function N(o){return o?{store_pickup:"🏬 استلام من الفرع",direct_delivery:"🚚 توصيل مباشر",direct_pickup:"🚗 استلام مباشر من العميل",carrier:"📦 شركة شحن"}[o]||o:""}const I={receiptOrder:(o,e)=>{const r=e.totalQty||e.items.reduce(($,t)=>$+t.qty,0),n=e.totalRolls||e.items.reduce(($,t)=>$+(t.rolls||0),0),c=`📥 <b>إذن استلام جديد ${e.orderNumber}</b>
━━━━━━━━━━━━━━━━━━━━

👤 المورّد: <b>${e.supplierName}</b>
${e.warehouseName?`📍 المستودع: ${e.warehouseName}`:""}

📋 المواد:
${h(e.items)}

📊 الإجمالي: <b>${r}</b>${n?` | ${n} رول`:""}
${e.notes?`📝 ${e.notes}`:""}
${e.createdBy?`👤 بواسطة: ${e.createdBy}`:""}`,l=e.items.map($=>{let t=`📦 ${$.name} — <b>${$.qty}</b>`;return $.unit&&(t+=` ${$.unit}`),$.rolls&&(t+=` (${$.rolls} رول)`),t}).join(`
`),m=`🏋️ <b>قائمة تنزيل ${e.orderNumber}</b>
━━━━━━━━━━━━━━━━━━━━

${e.warehouseName?`📍 المستودع: ${e.warehouseName}`:""}

${l}

📊 الإجمالي: <b>${r}</b>${n?` | ${n} رول`:""}`;return b(o,"receipt_order",c.trim(),e.warehouseId,{warehouse_keeper:c.trim(),picker:m.trim(),owner:c.trim()})},issueOrder:(o,e)=>{const r=e.totalQty||e.items.reduce((s,u)=>s+u.qty,0),n=e.items.reduce((s,u)=>s+(u.rolls||0),0),c=e.items.map(s=>{let u=`• ${s.name} — <b>${s.qty}</b>`;return s.unit&&(u+=` ${s.unit}`),s.rolls&&(u+=` (${s.rolls} رول)`),s.binLocation&&(u+=`
  📍 الموقع: ${s.binLocation}`),s.preferredRolls&&(u+=`
  ↳ الرولونات: ${s.preferredRolls}`),u}).join(`
`),l=`📤 <b>إذن تسليم ${e.orderNumber}</b>
━━━━━━━━━━━━━━━━━━━━

${e.purpose==="transfer"?"🔄 تحويل مستودعي":`👤 العميل: <b>${e.customerName}</b>`}
${e.warehouseName?`📍 المستودع: ${e.warehouseName}`:""}

📋 المواد المطلوبة:
${c}

📊 الإجمالي: <b>${r}</b>${n?` | ${n} رول`:""}
${e.deadline?`⏰ مطلوب قبل: ${e.deadline}`:""}
${e.createdBy?`👤 بواسطة: ${e.createdBy}`:""}`,m=e.items.map(s=>{let u=`• ${s.name} — <b>${s.qty}</b>`;return s.unit&&(u+=` ${s.unit}`),s.rolls&&(u+=` (${s.rolls} رول)`),u}).join(`
`),$=`📤 <b>إذن تسليم/صرف ${e.orderNumber}</b>
━━━━━━━━━━━━━━━━━━━━

👤 العميل: <b>${e.customerName}</b>
${e.warehouseName?`📍 المستودع: ${e.warehouseName}`:""}

📋 المواد المطلوبة:
${m}

📊 الإجمالي: <b>${r}</b>${n?` | ${n} رول`:""}
${e.estimatedValue?`💰 قيمة تقديرية: <b>${e.estimatedValue.toLocaleString()}</b>`:""}
${e.invoiceNumber?`🔖 الفاتورة: ${e.invoiceNumber}`:""}
${e.deadline?`⏰ مطلوب قبل: ${e.deadline}`:""}
${e.createdBy?`👤 بواسطة: ${e.createdBy}`:""}`,t=e.items.map(s=>{let u=`📍 ${s.name} — <b>${s.qty}</b>`;return s.unit&&(u+=` ${s.unit}`),s.rolls&&(u+=` (${s.rolls} رول)`),s.binLocation&&(u+=` ← ${s.binLocation}`),s.preferredRolls&&(u+=`
  ↳ الرولونات: ${s.preferredRolls}`),u}).join(`
`),i=`🏋️ <b>قائمة تجميع ${e.orderNumber}</b>
━━━━━━━━━━━━━━━━━━━━

${e.warehouseName?`📍 المستودع: ${e.warehouseName}`:""}

${t}

📊 الإجمالي: <b>${r}</b>${n?` | ${n} رول`:""}
${e.deadline?`⏰ مطلوب قبل: ${e.deadline}`:""}`;return b(o,"issue_order",$.trim(),e.warehouseId,{warehouse_keeper:l.trim(),picker:i.trim(),owner:$.trim()})},shipmentArrival:(o,e)=>{var l;const r=((l=e.invoices)==null?void 0:l.map(m=>`  🔖 ${m.number} — <b>${m.amount.toLocaleString()}</b>${m.items?` (${m.items} صنف)`:""}`).join(`
`))||"",n=`📦 <b>حاوية واردة ${e.containerNumber}</b>
━━━━━━━━━━━━━━━━━━━━

${e.supplierName?`👤 المورّد: <b>${e.supplierName}</b>`:""}
📊 عدد الأصناف: <b>${e.itemCount}</b>
${e.warehouseName?`📍 الاستلام في: ${e.warehouseName}`:""}
${e.arrivalDate?`📅 تاريخ الوصول: ${e.arrivalDate}`:""}

⏳ يرجى تجهيز منطقة الاستلام والفحص`,c=`📦 <b>وصول حاوية ${e.containerNumber}</b>
━━━━━━━━━━━━━━━━━━━━

${e.supplierName?`👤 المورّد: <b>${e.supplierName}</b>`:""}
${e.originCountry?`🌍 بلد المنشأ: ${e.originCountry}`:""}
📊 عدد الأصناف: <b>${e.itemCount}</b>
${e.totalCost?`💰 التكلفة الإجمالية: <b>${e.totalCost.toLocaleString()}</b> ${e.currency||"₺"}`:""}
${e.warehouseName?`📍 المستودع: ${e.warehouseName}`:""}
${e.arrivalDate?`📅 تاريخ الوصول: ${e.arrivalDate}`:""}
${r?`
📄 الفواتير المرتبطة:
${r}`:""}

⏳ بانتظار الفحص والاستلام`;return b(o,"shipment_arrival",c.trim(),void 0,{warehouse_keeper:n.trim(),owner:c.trim()})},warehouseTransfer:(o,e)=>{const r=`🔄 <b>تحويل مستودعي ${e.transferNumber}</b>
━━━━━━━━━━━━━━━━━━━━

📍 من: <b>${e.fromWarehouse}</b>
📍 إلى: <b>${e.toWarehouse}</b>

📋 المواد:
${h(e.items)}

${e.createdBy?`👤 بواسطة: ${e.createdBy}`:""}`;return b(o,"warehouse_transfer",r.trim())},lowStock:(o,e)=>{const r=`⚠️ <b>تنبيه مخزون منخفض</b>
━━━━━━━━━━━━━━━━━━━━

📦 المادة: <b>${e.materialName}</b>
📊 المخزون الحالي: <b>${e.currentQty}</b> ${e.unit||""}
🔴 الحد الأدنى: <b>${e.minQty}</b> ${e.unit||""}
${e.warehouseName?`📍 المستودع: ${e.warehouseName}`:""}

⏰ يرجى طلب التوريد`;return b(o,"low_stock",r.trim())},paymentReceived:(o,e)=>{const r=`💰 <b>دفعة مستلمة</b>
━━━━━━━━━━━━━━━━━━━━

👤 العميل: <b>${e.customerName}</b>
💵 المبلغ: <b>${e.amount.toLocaleString()}</b> ${e.currency||"₺"}
${e.paymentMethod?`💳 الطريقة: ${e.paymentMethod}`:""}
${e.referenceNumber?`🔖 المرجع: ${e.referenceNumber}`:""}
${e.invoiceNumber?`📄 الفاتورة: ${e.invoiceNumber}`:""}
${e.remainingBalance!==void 0?`📊 الرصيد المتبقي: <b>${e.remainingBalance.toLocaleString()}</b> ${e.currency||"₺"}`:""}
${e.receivedBy?`👤 استلمها: ${e.receivedBy}`:""}`;return b(o,"payment_received",r.trim())},paymentSent:(o,e)=>{const r=`💸 <b>دفعة صادرة</b>
━━━━━━━━━━━━━━━━━━━━

👤 المستفيد: <b>${e.recipientName}</b>
💵 المبلغ: <b>${e.amount.toLocaleString()}</b> ${e.currency||"₺"}
${e.purpose?`📝 الغرض: ${e.purpose}`:""}`;return b(o,"payment_sent",r.trim())},priceUpdate:(o,e)=>{const n=`💹 <b>تحديث أسعار</b>
━━━━━━━━━━━━━━━━━━━━

${e.items.map(c=>{const l=((c.newPrice-c.oldPrice)/c.oldPrice*100).toFixed(1);return`${c.newPrice>c.oldPrice?"📈":"📉"} ${c.name}: <b>${c.oldPrice}</b> → <b>${c.newPrice}</b> (${l}%)`}).join(`
`)}

${e.updatedBy?`👤 بواسطة: ${e.updatedBy}`:""}
${e.reason?`📝 السبب: ${e.reason}`:""}`;return b(o,"price_update",n.trim())},deliveryRoute:(o,e)=>{const r=`🚚 <b>مهمة توصيل جديدة</b>
━━━━━━━━━━━━━━━━━━━━

📋 رقم التسليم: <b>${e.deliveryNumber}</b>
👤 العميل: <b>${e.customerName}</b>
${e.customerPhone?`📱 الهاتف: ${e.customerPhone}`:""}

📍 العنوان: ${e.address}
${e.items?`📦 الحمولة: ${e.items}`:""}
${e.collectAmount?`💰 مبلغ التحصيل: <b>${e.collectAmount.toLocaleString()}</b> ${e.currency||"₺"}`:""}
${e.mapsUrl?`📍 <a href="${e.mapsUrl}">عرض على الخريطة</a>`:""}`;return b(o,"delivery_route",r.trim())},salesOrder:(o,e)=>{var i,s;const r=e.currency||"₺",n=((i=e.items)==null?void 0:i.map(u=>{let p=`• ${u.name} — <b>${u.qty}</b>`;return u.unit&&(p+=` ${u.unit}`),u.rolls&&(p+=` (${u.rolls} رول)`),u.price&&(p+=` × ${u.price.toLocaleString()} = <b>${(u.qty*u.price).toLocaleString()}</b>`),p}).join(`
`))||"",c=`🛒 <b>طلب بيع جديد ${e.orderNumber}</b>
━━━━━━━━━━━━━━━━━━━━

👤 العميل: <b>${e.customerName}</b>
${e.salesPerson?`🧑‍💼 المندوب: ${e.salesPerson}`:""}

${n?`📋 الأصناف:
${n}
`:`📦 عدد الأصناف: ${e.itemCount}`}
💰 إجمالي الفاتورة: <b>${e.totalAmount.toLocaleString()}</b> ${r}
${e.notes?`📝 ملاحظات: ${e.notes}`:""}`,l=`🧾 <b>فاتورة مبيعات جديدة ${e.orderNumber}</b>
━━━━━━━━━━━━━━━━━━━━

👤 العميل: <b>${e.customerName}</b>
📦 عدد الأصناف: ${e.itemCount}
💰 الإجمالي: <b>${e.totalAmount.toLocaleString()}</b> ${r}
${e.salesPerson?`🧑‍💼 المندوب: ${e.salesPerson}`:""}`,m=((s=e.items)==null?void 0:s.map(u=>{let p=`• ${u.name} — <b>${u.qty}</b>`;return u.unit&&(p+=` ${u.unit}`),u.rolls&&(p+=` (${u.rolls} رول)`),p}).join(`
`))||"",$=`📤 <b>جهّز بضاعة لطلب ${e.orderNumber}</b>
━━━━━━━━━━━━━━━━━━━━

👤 العميل: <b>${e.customerName}</b>

📋 المواد المطلوبة:
${m||`📦 ${e.itemCount} صنف`}

⏳ يرجى تجهيز الطلب`,t=`💳 <b>فاتورة بيع ${e.orderNumber}</b>
━━━━━━━━━━━━━━━━━━━━

👤 العميل: <b>${e.customerName}</b>
💰 المبلغ المطلوب: <b>${e.totalAmount.toLocaleString()}</b> ${r}
📦 عدد الأصناف: ${e.itemCount}`;return b(o,"sales_order",c.trim(),void 0,{owner:c.trim(),sales_manager:c.trim(),accountant:l.trim(),cashier:t.trim(),warehouse_keeper:$.trim()})},invoiceDue:(o,e)=>{const n=`📄 <b>فاتورة مستحقة ${e.daysLeft<=0?"🔴 متأخرة!":e.daysLeft<=3?"🟠 عاجل":"🟡 قريبة"}</b>
━━━━━━━━━━━━━━━━━━━━

📋 الفاتورة: <b>${e.invoiceNumber}</b>
👤 العميل: <b>${e.customerName}</b>
💵 المبلغ: <b>${e.amount.toLocaleString()}</b> ${e.currency||"₺"}
📅 الاستحقاق: ${e.dueDate}
${e.daysLeft<=0?`⚠️ متأخرة بـ ${Math.abs(e.daysLeft)} يوم`:`⏳ متبقي ${e.daysLeft} يوم`}`;return b(o,"invoice_due",n.trim())},creditLimit:(o,e)=>{const r=`🚫 <b>تجاوز حد ائتمان</b>
━━━━━━━━━━━━━━━━━━━━

👤 العميل: <b>${e.customerName}</b>
💰 الرصيد المستحق: <b>${e.balance.toLocaleString()}</b> ${e.currency||"₺"}
🔴 الحد المسموح: <b>${e.limit.toLocaleString()}</b> ${e.currency||"₺"}
⚠️ التجاوز: <b>${(e.balance-e.limit).toLocaleString()}</b> ${e.currency||"₺"}`;return b(o,"credit_limit",r.trim())},inventoryTask:(o,e)=>{const r=`📋 <b>مهمة جرد جديدة</b>
━━━━━━━━━━━━━━━━━━━━

📊 النوع: ${e.taskType}
📍 المستودع: <b>${e.warehouseName}</b>
📅 الموعد النهائي: ${e.deadline}
📦 عدد المواد: <b>${e.itemCount}</b>
${e.rollCount?`🧵 عدد الرولونات: <b>${e.rollCount}</b>`:""}

⏰ يرجى إتمام الجرد والإبلاغ عبر النظام`;return b(o,"inventory_task",r.trim())},customerGoodsReady:async(o,e)=>{var r;try{const{data:n}=await y.from("customers").select("telegram_chat_id, telegram_username").eq("id",e.customerId).maybeSingle();if(!(n!=null&&n.telegram_chat_id))return console.log(`[TelegramNotify] Customer ${e.customerName} has no Telegram linked`),{ok:!1,error:"No Telegram for customer"};const c=(r=e.items)!=null&&r.length?`
📋 المواد:
${h(e.items)}`:"",l=`✅ <b>بضاعتكم جاهزة!</b>
━━━━━━━━━━━━━━━━━━━━

مرحباً <b>${e.customerName}</b> 👋

${e.invoiceNumber?`📋 الفاتورة: <b>${e.invoiceNumber}</b>`:""}${c}
${e.totalQty?`📊 الإجمالي: <b>${e.totalQty}</b> م`:""}
${e.pickupAddress?`📍 عنوان الاستلام: ${e.pickupAddress}`:""}
${e.deliveryDate?`📅 موعد التوصيل: ${e.deliveryDate}`:""}

${e.companyName?`— ${e.companyName}`:"— TexaFab"}`;return(await a.functions.invoke("telegram-webhook",{body:{action:"send_direct_message",company_id:o,chat_id:n.telegram_chat_id,html_message:l.trim()}})).data||{ok:!1}}catch(n){return console.warn("[TelegramNotify] Customer notification error:",n),{ok:!1,error:"Failed"}}},custom:(o,e,r)=>b(o,e,r),warehousePickingOrder:async(o,e)=>{try{const r=e.items.map(i=>i.materialId).filter(i=>!!i),n=await _(r,e.warehouseId),c=e.items.map((i,s)=>{var p;let u=`<b>${s+1}.</b> ${i.name}`;if(i.color&&(u+=` (${i.color})`),u+=`
   📏 الكمية: <b>${i.qty}</b> ${i.unit||"م"}`,i.rolls&&(u+=` | ${i.rolls} رول`),i.materialId&&((p=n[i.materialId])!=null&&p.length)){const g=n[i.materialId].slice(0,3).map(f=>`📍 <code>${f.binCode}</code> (${f.rollCount} رول, ${f.totalLength} م)`).join(`
   `);u+=`
   ${g}`}return u}).join(`

`),l=e.shippingMethod?`
🚛 <b>طريقة الشحن:</b> ${N(e.shippingMethod)}`:"",m=e.shippingAddress?`
📍 <b>عنوان التوصيل:</b> ${e.shippingAddress}`:"",$=e.driverName?`
👤 <b>السائق:</b> ${e.driverName}${e.driverPhone?` (${e.driverPhone})`:""}`:"",t=`📦 <b>طلب تجميع — فاتورة ${e.orderNumber}</b>
━━━━━━━━━━━━━━━━━━━━━━━━

👤 العميل: <b>${e.customerName}</b>${e.customerPhone?` 📱 ${e.customerPhone}`:""}
${e.warehouseName?`🏭 المستودع: <b>${e.warehouseName}</b>`:""}
${e.totalAmount?`💰 المبلغ: <b>${e.totalAmount.toLocaleString()}</b> ${e.currency||"₺"}`:""}

📋 <b>البنود المطلوبة:</b>
${c}
${l}${m}${$}
${e.notes?`
📝 ملاحظات: ${e.notes}`:""}
${e.createdBy?`
👤 بواسطة: ${e.createdBy}`:""}

⚡ يرجى تجميع الطلب وإعداده للتسليم`;return b(o,"warehouse_picking",t.trim(),e.warehouseId)}catch(r){return console.warn("[TelegramNotify] warehousePickingOrder error:",r),{ok:!1,error:"Failed"}}},warehouseReceivingOrder:async(o,e)=>{try{const r=e.items.map(m=>m.materialId).filter(m=>!!m),n=await _(r,e.warehouseId),c=e.items.map((m,$)=>{var i;let t=`<b>${$+1}.</b> ${m.name}`;if(m.color&&(t+=` (${m.color})`),t+=`
   📏 الكمية: <b>${m.qty}</b> ${m.unit||"م"}`,m.rolls&&(t+=` | ${m.rolls} رول`),m.materialId&&((i=n[m.materialId])!=null&&i.length)){const s=n[m.materialId][0];t+=`
   💡 موقع مقترح: <code>${s.binCode}</code> (يوجد فيه ${s.rollCount} رول)`}return t}).join(`

`),l=`📥 <b>طلب استلام مشتريات — ${e.orderNumber}</b>
━━━━━━━━━━━━━━━━━━━━━━━━

👤 المورّد: <b>${e.supplierName}</b>
${e.warehouseName?`🏭 المستودع: <b>${e.warehouseName}</b>`:""}
${e.totalAmount?`💰 المبلغ: <b>${e.totalAmount.toLocaleString()}</b> ${e.currency||"₺"}`:""}

📋 <b>المواد الواردة:</b>
${c}
${e.notes?`
📝 ملاحظات: ${e.notes}`:""}
${e.createdBy?`
👤 بواسطة: ${e.createdBy}`:""}

⚡ يرجى الفحص والاستلام وترتيب المواد بالمستودع`;return b(o,"warehouse_receiving",l.trim(),e.warehouseId)}catch(r){return console.warn("[TelegramNotify] warehouseReceivingOrder error:",r),{ok:!1,error:"Failed"}}},warehouseTransferPicking:async(o,e)=>{try{const r=e.items.map(i=>i.materialId).filter(i=>!!i),n=await _(r,e.fromWarehouseId),c=e.items.map((i,s)=>{var p;let u=`<b>${s+1}.</b> ${i.name}`;if(i.color&&(u+=` (${i.color})`),u+=`
   📏 الكمية: <b>${i.qty}</b> ${i.unit||"م"}`,i.rolls&&(u+=` | ${i.rolls} رول`),i.materialId&&((p=n[i.materialId])!=null&&p.length)){const g=n[i.materialId].slice(0,3).map(f=>`📍 <code>${f.binCode}</code> (${f.rollCount} رول, ${f.totalLength} م)`).join(`
   `);u+=`
   ${g}`}return u}).join(`

`),l=e.shippingMethod?`
🚛 طريقة النقل: ${N(e.shippingMethod)}`:"",m=e.driverName?`
👤 السائق: ${e.driverName}${e.driverPhone?` (${e.driverPhone})`:""}`:"",$=e.vehicleNumber?`
🚗 رقم المركبة: ${e.vehicleNumber}`:"",t=`🔄 <b>طلب تجميع مناقلة — ${e.transferNumber}</b>
━━━━━━━━━━━━━━━━━━━━━━━━

📍 من: <b>${e.fromWarehouseName}</b>
📍 إلى: <b>${e.toWarehouseName}</b>

📋 <b>المواد المطلوب نقلها:</b>
${c}
${l}${m}${$}
${e.notes?`
📝 ملاحظات: ${e.notes}`:""}
${e.createdBy?`
👤 بواسطة: ${e.createdBy}`:""}

⚡ يرجى تجميع المواد وتجهيزها للنقل`;return b(o,"warehouse_transfer_picking",t.trim(),e.fromWarehouseId)}catch(r){return console.warn("[TelegramNotify] warehouseTransferPicking error:",r),{ok:!1,error:"Failed"}}},remittanceCreated:(o,e)=>{const r=m=>m.toLocaleString("en-US",{minimumFractionDigits:2}),n={branch:"🏬 استلام من الفرع",agent:"🤝 عبر وكيل",bank:"🏦 تحويل بنكي",wallet:"📱 محفظة إلكترونية",internal:"🔄 داخلي",delegate:"🚗 مندوب"},c=`💸 <b>حوالة صادرة جديدة ${e.remittanceNumber}</b>
━━━━━━━━━━━━━━━━━━━━

👤 المرسل: <b>${e.senderName}</b>
👤 المستقبل: <b>${e.receiverName}</b>
${e.deliveryCountry?`🌍 الوجهة: ${e.deliveryCountry}`:""}

💵 مبلغ الإرسال: <b>${r(e.sendAmount)}</b> ${e.sendCurrency}
${e.receiveAmount?`💰 مبلغ الاستلام: <b>${r(e.receiveAmount)}</b> ${e.receiveCurrency||e.sendCurrency}`:""}
${e.commission?`🏷 العمولة: <b>${r(e.commission)}</b> ${e.sendCurrency}`:""}
📦 طريقة التسليم: ${n[e.deliveryMethod]||e.deliveryMethod}
${e.trackingCode?`🔍 كود التتبع: <b>${e.trackingCode}</b>`:""}
${e.createdBy?`👤 بواسطة: ${e.createdBy}`:""}`,l=`💸 <b>حوالة ${e.remittanceNumber}</b>
━━━━━━━━━━━━━━━━━━━━

👤 ${e.senderName} → ${e.receiverName}
💵 المبلغ: <b>${r(e.sendAmount)}</b> ${e.sendCurrency}
${e.commission?`🏷 العمولة: <b>${r(e.commission)}</b>`:""}
💰 إجمالي التحصيل: <b>${r(e.sendAmount+(e.commission||0))}</b> ${e.sendCurrency}`;return b(o,"remittance_created",c.trim(),void 0,{owner:c.trim(),cashier:l.trim(),accountant:c.trim()})},remittanceSent:(o,e)=>{const r=c=>c.toLocaleString("en-US",{minimumFractionDigits:2}),n=`✈️ <b>تم إرسال الحوالة ${e.remittanceNumber}</b>
━━━━━━━━━━━━━━━━━━━━

👤 ${e.senderName} → <b>${e.receiverName}</b>
💵 المبلغ: <b>${r(e.sendAmount)}</b> ${e.sendCurrency}
${e.agentName?`🤝 الوكيل: ${e.agentName}`:""}
${e.trackingCode?`🔍 كود التتبع: <b>${e.trackingCode}</b>`:""}

⏳ بانتظار تأكيد التسليم`;return b(o,"remittance_sent",n.trim())},remittanceDelivered:(o,e)=>{const r=c=>c.toLocaleString("en-US",{minimumFractionDigits:2}),n=`✅ <b>تم تسليم الحوالة ${e.remittanceNumber}</b>
━━━━━━━━━━━━━━━━━━━━

👤 المستقبل: <b>${e.receiverName}</b>
💰 المبلغ المسلّم: <b>${r(e.receiveAmount)}</b> ${e.receiveCurrency}
${e.deliveredBy?`👤 سلّمها: ${e.deliveredBy}`:""}

✅ الحوالة مكتملة`;return b(o,"remittance_delivered",n.trim())},remittanceIncoming:(o,e)=>{const r=l=>l.toLocaleString("en-US",{minimumFractionDigits:2}),n=e.partnerName||e.agentName||"غير محدد",c=`📥 <b>حوالة واردة ${e.remittanceNumber}</b>
━━━━━━━━━━━━━━━━━━━━

🤝 المصدر: <b>${n}</b>
👤 المرسل: ${e.senderName}
👤 المستقبل: <b>${e.receiverName}</b>

💵 مبلغ الإرسال: <b>${r(e.sendAmount)}</b> ${e.sendCurrency}
💰 مبلغ التسليم: <b>${r(e.receiveAmount)}</b> ${e.receiveCurrency}

⏳ يرجى تسليم المبلغ للمستقبل`;return b(o,"remittance_incoming",c.trim())},remittanceCancelled:(o,e)=>{const r=c=>c.toLocaleString("en-US",{minimumFractionDigits:2}),n=`❌ <b>إلغاء حوالة ${e.remittanceNumber}</b>
━━━━━━━━━━━━━━━━━━━━

👤 المرسل: <b>${e.senderName}</b>
💵 المبلغ: <b>${r(e.sendAmount)}</b> ${e.sendCurrency}
${e.reason?`📝 السبب: ${e.reason}`:""}
${e.cancelledBy?`👤 بواسطة: ${e.cancelledBy}`:""}

⚠️ يجب إرجاع المبلغ للمرسل`;return b(o,"remittance_cancelled",n.trim())},remittanceStatusChange:(o,e)=>{const r={pending:"⏳ بانتظار",processing:"🔄 معالجة",sent:"✈️ أُرسلت",delivered:"✅ تم التسليم",completed:"🏁 مكتملة",cancelled:"❌ ملغاة",returned:"↩️ مرتجعة"},n=`🔄 <b>تحديث حالة حوالة ${e.remittanceNumber}</b>
━━━━━━━━━━━━━━━━━━━━

${r[e.oldStatus]||e.oldStatus} → <b>${r[e.newStatus]||e.newStatus}</b>
${e.senderName?`👤 ${e.senderName}`:""}${e.receiverName?` → ${e.receiverName}`:""}
${e.changedBy?`👤 بواسطة: ${e.changedBy}`:""}`;return b(o,"remittance_status_change",n.trim())},ecomNewOrder:(o,e)=>{const r=e.currency||"UAH",n={cod:"💵 عند الاستلام",liqpay:"💳 LiqPay",wayforpay:"💳 WayForPay",bank_transfer:"🏦 تحويل بنكي",partial_prepay:"💰 دفعة مقدمة"},c=`🛒 <b>طلب جديد #${e.orderNumber}</b>
━━━━━━━━━━━━━━━━━━━━

👤 ${e.customerName}
📱 ${e.phone}
📦 ${e.itemsCount} منتج
💰 <b>${e.totalAmount.toLocaleString()} ${r}</b>
💳 ${n[e.paymentMethod]||e.paymentMethod}
${e.city?`🏙 ${e.city}`:""}${e.warehouse?`
📬 ${e.warehouse}`:""}

⚡ <b>[تأكيد] [رفض] [تفاصيل]</b>`;return b(o,"ecom_new_order",c.trim())},ecomOrderConfirmed:(o,e)=>{var $;const r=e.currency||"UAH",n={cod:"💵 عند الاستلام",liqpay:"💳 LiqPay",wayforpay:"💳 WayForPay",bank_transfer:"🏦 تحويل بنكي",partial_prepay:"💰 دفعة مقدمة"},c=(($=e.items)==null?void 0:$.map((t,i)=>{let s=`  ${i+1}. ${t.name} — <b>${t.qty}</b> ${t.unit||"م"}`;return t.price&&(s+=` × ${t.price.toLocaleString()} = <b>${(t.qty*t.price).toLocaleString()}</b>`),s}).join(`
`))||"";let l="";if(e.shippingAddress){const t=e.shippingAddress;typeof t=="string"?l=t:l=[t.nova_poshta_city_name||t.city,t.nova_poshta_warehouse_name||t.novaPoshtaWarehouseName,t.street,t.fullName||t.full_name].filter(Boolean).join(" — ")}const m=`✅ <b>طلب مؤكد #${e.orderNumber}</b>
━━━━━━━━━━━━━━━━━━━━

👤 العميل: <b>${e.customerName}</b>
${e.customerPhone?`📱 الهاتف: ${e.customerPhone}`:""}
${l?`📍 العنوان: ${l}`:""}
${e.paymentMethod?`💳 الدفع: ${n[e.paymentMethod]||e.paymentMethod}`:""}

${c?`📋 المنتجات:
${c}
`:""}${e.subtotal?`💵 المجموع: ${e.subtotal.toLocaleString()} ${r}`:""}
${e.shippingAmount!=null?`🚚 الشحن: ${e.shippingAmount.toLocaleString()} ${r}`:""}
💰 <b>الإجمالي: ${e.totalAmount.toLocaleString()} ${r}</b>
${e.confirmedBy?`👤 بواسطة: ${e.confirmedBy}`:""}

📦 <b>مطلوب تجهيز وشحن</b>`;return b(o,"ecom_order_confirmed",m.trim())},ecomOrderShipped:(o,e)=>{const r=`https://novaposhta.ua/tracking/?cargo_number=${e.trackingNumber}`,n=`🚚 <b>تم شحن الطلب #${e.orderNumber}</b>
━━━━━━━━━━━━━━━━━━━━

👤 ${e.customerName}
📦 رقم التتبع: <code>${e.trackingNumber}</code>
${e.carrier?`🏢 ${e.carrier}`:"🏢 Nova Poshta"}
${e.warehouseName?`📬 ${e.warehouseName}`:""}

🔗 <a href="${r}">تتبع الشحنة</a>`;return b(o,"ecom_order_shipped",n.trim())},ecomOrderDelivered:(o,e)=>{const r=e.currency||"UAH",n=`📬 <b>تم تسليم الطلب #${e.orderNumber}</b>
━━━━━━━━━━━━━━━━━━━━

👤 ${e.customerName}
💰 ${e.totalAmount.toLocaleString()} ${r}
${e.codCollected?`💵 تم تحصيل: ${e.codCollected.toLocaleString()} ${r}`:""}

🎉 <b>مكتمل</b>`;return b(o,"ecom_order_delivered",n.trim())},ecomOrderCancelled:(o,e)=>{const r=e.currency||"UAH",n=`❌ <b>طلب ملغي #${e.orderNumber}</b>
━━━━━━━━━━━━━━━━━━━━

👤 ${e.customerName}
💰 ${e.totalAmount.toLocaleString()} ${r}
${e.reason?`📝 السبب: ${e.reason}`:""}
${e.cancelledBy?`👤 بواسطة: ${e.cancelledBy}`:""}`;return b(o,"ecom_order_cancelled",n.trim())},ecomPaymentReceived:(o,e)=>{const r=e.currency||"UAH",n={liqpay:"LiqPay",wayforpay:"WayForPay",bank_transfer:"تحويل بنكي",cod:"عند الاستلام",partial_prepay:"دفعة مقدمة"},c=`💳 <b>دفعة مستلمة — طلب #${e.orderNumber}</b>
━━━━━━━━━━━━━━━━━━━━

💰 <b>${e.amount.toLocaleString()} ${r}</b>
💳 ${n[e.method]||e.method}
👤 ${e.customerName}`;return b(o,"ecom_payment_received",c.trim())},ecomOrderReturned:(o,e)=>{const r=e.currency||"UAH",n=`↩️ <b>طلب إرجاع — #${e.orderNumber}</b>
━━━━━━━━━━━━━━━━━━━━

👤 ${e.customerName}
💰 ${e.totalAmount.toLocaleString()} ${r}
${e.reason?`📝 السبب: ${e.reason}`:""}

⚡ <b>[قبول الإرجاع] [رفض]</b>`;return b(o,"ecom_order_returned",n.trim())},ecomLowStock:(o,e)=>{const r=`⚠️ <b>مخزون منخفض — متجر إلكتروني</b>
━━━━━━━━━━━━━━━━━━━━

📦 ${e.productName}
${e.sku?`🏷 SKU: ${e.sku}`:""}
📊 المخزون: <b>${e.currentStock}</b> ${e.unit||""} (الحد الأدنى: ${e.minStock})

⚡ <b>يرجى إعادة التوريد</b>`;return b(o,"ecom_low_stock",r.trim())}};export{I as default,B as sendTestNotification,I as telegramNotify};
