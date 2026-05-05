import{s as y}from"./index-V9x08Imb.js";import"./vendor-data-CLVn9T7b.js";import"./vendor-react-jwcFVDcr.js";import"./vendor-ui-Du_wnCz5.js";import"./vendor-charts-BmzKQtJe.js";const _={receipt_order:{sourceType:"warehouse",notifType:"info"},issue_order:{sourceType:"warehouse",notifType:"info"},shipment_arrival:{sourceType:"container",notifType:"success"},warehouse_transfer:{sourceType:"warehouse",notifType:"info"},warehouse_picking:{sourceType:"sales",notifType:"info"},warehouse_receiving:{sourceType:"purchases",notifType:"info"},warehouse_transfer_picking:{sourceType:"warehouse",notifType:"info"},low_stock:{sourceType:"warehouse",notifType:"warning"},payment_received:{sourceType:"finance",notifType:"success"},payment_sent:{sourceType:"finance",notifType:"info"},price_update:{sourceType:"inventory",notifType:"warning"},delivery_route:{sourceType:"delivery",notifType:"info"},sales_order:{sourceType:"sales",notifType:"success"},invoice_due:{sourceType:"finance",notifType:"warning"},credit_limit:{sourceType:"finance",notifType:"error"},inventory_task:{sourceType:"warehouse",notifType:"info"},security_alert:{sourceType:"security",notifType:"warning"},test_notification:{sourceType:"system",notifType:"info"},remittance_created:{sourceType:"exchange",notifType:"info"},remittance_sent:{sourceType:"exchange",notifType:"success"},remittance_delivered:{sourceType:"exchange",notifType:"success"},remittance_incoming:{sourceType:"exchange",notifType:"info"},remittance_cancelled:{sourceType:"exchange",notifType:"warning"},remittance_status_change:{sourceType:"exchange",notifType:"info"}};async function b(n,e,r,s,l){try{const{data:{session:u}}=await y.auth.getSession();if(!u)return{ok:!1,error:"Not authenticated"};let t={ok:!0};try{const m=await y.functions.invoke("telegram-webhook",{body:{action:"dispatch_notification",company_id:n,event_type:e,html_message:r,...s?{target_warehouse_id:s}:{},...l?{role_messages:l}:{}}});m.error&&console.warn(`[TelegramNotify] ${e} response error (may be CORS):`,m.error),t=(m==null?void 0:m.data)||{ok:!0,sent:1}}catch(m){console.warn(`[TelegramNotify] ${e} fetch error (likely CORS, message may have been sent):`,m),t={ok:!0,sent:1,cors_fallback:!0}}try{const m=_[e]||{sourceType:"system",notifType:"info"},o=r.replace(/<[^>]+>/g,"").trim().split(`
`).filter(p=>p.trim()&&!p.includes("━")),i=o[0]||e,c=o.slice(1,4).join(`
`).trim();await y.from("notifications").insert({user_id:u.user.id,tenant_id:n,title:i,body:c||null,type:m.notifType,source_type:m.sourceType,metadata:{event_type:e,company_id:n}})}catch(m){console.warn("[TelegramNotify] In-app save failed:",m)}return(t==null?void 0:t.sent)>0&&console.log(`[TelegramNotify] ${e}: sent=${t.sent}`),t}catch(u){return console.warn("[TelegramNotify] Error:",u),{ok:!1,error:"Network error"}}}async function C(n,e){var r,s,l;try{const{data:{session:u}}=await y.auth.getSession();if(!u)return{ok:!1,error:"Not authenticated"};const t=((r=u.user.user_metadata)==null?void 0:r.full_name)||u.user.email||"User",m=new Date().toLocaleTimeString("en-US",{hour:"2-digit",minute:"2-digit"});if(n==="telegram"){const $=`🧪 <b>إشعار تجريبي — Test Notification</b>
━━━━━━━━━━━━━━━━━━━━

✅ مرحباً <b>${t}</b>
📱 إشعارات التلغرام تعمل بنجاح!
⏰ ${m}

— TexaCore ERP`;let o=e||((s=u.user.app_metadata)==null?void 0:s.company_id);if(!o){const{data:i}=await y.from("user_profiles").select("company_id").eq("id",u.user.id).maybeSingle();o=i==null?void 0:i.company_id}if(o){const i=await b(o,"test_notification",$);return{ok:!!(i!=null&&i.ok)||!!(i!=null&&i.sent)}}return{ok:!1,error:"No company ID"}}if(n==="email"){const $=`
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
      مرحباً <strong style="color:#1e293b;">${t}</strong><br>
      إشعارات البريد الإلكتروني تعمل بنجاح!
    </p>
    <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:16px;margin:20px 0;">
      <div style="display:inline-block;background:#059669;color:#fff;font-size:12px;font-weight:700;padding:4px 12px;border-radius:20px;margin-bottom:8px;">CONNECTED</div>
      <p style="margin:8px 0 0;color:#166534;font-size:13px;">📧 ${u.user.email}</p>
      <p style="margin:4px 0 0;color:#166534;font-size:13px;">⏰ ${m}</p>
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
</html>`;return{ok:!(await y.functions.invoke("send-email",{body:{to:u.user.email,subject:"✅ TexaCore — إشعار تجريبي ناجح",html:$}})).error}}if(n==="in_app"){let $=(l=u.user.app_metadata)==null?void 0:l.company_id;if(!$){const{data:o}=await y.from("user_profiles").select("company_id").eq("id",u.user.id).maybeSingle();$=o==null?void 0:o.company_id}return await y.from("notifications").insert({user_id:u.user.id,tenant_id:$,title:"🧪 إشعار تجريبي — Test",body:`✅ الإشعارات الداخلية تعمل بنجاح! (${m})`,type:"success",source_type:"system",metadata:{test:!0}}),{ok:!0}}return{ok:!1,error:"Unknown channel"}}catch(u){return{ok:!1,error:(u==null?void 0:u.message)||"Error"}}}function h(n){return n!=null&&n.length?n.map(e=>{let r=`• ${e.name} — <b>${e.qty}</b>`;return e.unit&&(r+=` ${e.unit}`),e.rolls&&(r+=` (${e.rolls} رول)`),r}).join(`
`):""}async function a(n,e){if(!(n!=null&&n.length))return{};try{let r=y.from("fabric_rolls").select("material_id, current_length, bin_location:bin_locations(code, name, row_code, column_code)").in("material_id",n).in("status",["available","reserved","in_stock"]).not("bin_location_id","is",null);e&&(r=r.eq("warehouse_id",e));const{data:s,error:l}=await r;if(l||!(s!=null&&s.length))return{};const u={},t={};for(const m of s){const $=m.material_id,o=m.bin_location;if(!$||!(o!=null&&o.code))continue;t[$]||(t[$]={});const i=o.code;t[$][i]||(t[$][i]={code:o.code,name:o.name||`${o.row_code||""}${o.column_code||""}`,count:0,length:0}),t[$][i].count++,t[$][i].length+=Number(m.current_length)||0}for(const[m,$]of Object.entries(t))u[m]=Object.values($).sort((o,i)=>i.count-o.count).map(o=>({binCode:o.code,binName:o.name,rollCount:o.count,totalLength:Math.round(o.length*100)/100}));return u}catch{return{}}}function N(n){return n?{store_pickup:"🏬 استلام من الفرع",direct_delivery:"🚚 توصيل مباشر",direct_pickup:"🚗 استلام مباشر من العميل",carrier:"📦 شركة شحن"}[n]||n:""}const L={receiptOrder:(n,e)=>{const r=e.totalQty||e.items.reduce((m,$)=>m+$.qty,0),s=e.totalRolls||e.items.reduce((m,$)=>m+($.rolls||0),0),l=`📥 <b>إذن استلام جديد ${e.orderNumber}</b>
━━━━━━━━━━━━━━━━━━━━

👤 المورّد: <b>${e.supplierName}</b>
${e.warehouseName?`📍 المستودع: ${e.warehouseName}`:""}

📋 المواد:
${h(e.items)}

📊 الإجمالي: <b>${r}</b>${s?` | ${s} رول`:""}
${e.notes?`📝 ${e.notes}`:""}
${e.createdBy?`👤 بواسطة: ${e.createdBy}`:""}`,u=e.items.map(m=>{let $=`📦 ${m.name} — <b>${m.qty}</b>`;return m.unit&&($+=` ${m.unit}`),m.rolls&&($+=` (${m.rolls} رول)`),$}).join(`
`),t=`🏋️ <b>قائمة تنزيل ${e.orderNumber}</b>
━━━━━━━━━━━━━━━━━━━━

${e.warehouseName?`📍 المستودع: ${e.warehouseName}`:""}

${u}

📊 الإجمالي: <b>${r}</b>${s?` | ${s} رول`:""}`;return b(n,"receipt_order",l.trim(),e.warehouseId,{warehouse_keeper:l.trim(),picker:t.trim(),owner:l.trim()})},issueOrder:(n,e)=>{const r=e.totalQty||e.items.reduce((i,c)=>i+c.qty,0),s=e.items.reduce((i,c)=>i+(c.rolls||0),0),l=e.items.map(i=>{let c=`• ${i.name} — <b>${i.qty}</b>`;return i.unit&&(c+=` ${i.unit}`),i.rolls&&(c+=` (${i.rolls} رول)`),i.binLocation&&(c+=`
  📍 الموقع: ${i.binLocation}`),i.preferredRolls&&(c+=`
  ↳ الرولونات: ${i.preferredRolls}`),c}).join(`
`),u=`📤 <b>إذن تسليم ${e.orderNumber}</b>
━━━━━━━━━━━━━━━━━━━━

${e.purpose==="transfer"?"🔄 تحويل مستودعي":`👤 العميل: <b>${e.customerName}</b>`}
${e.warehouseName?`📍 المستودع: ${e.warehouseName}`:""}

📋 المواد المطلوبة:
${l}

📊 الإجمالي: <b>${r}</b>${s?` | ${s} رول`:""}
${e.deadline?`⏰ مطلوب قبل: ${e.deadline}`:""}
${e.createdBy?`👤 بواسطة: ${e.createdBy}`:""}`,t=e.items.map(i=>{let c=`• ${i.name} — <b>${i.qty}</b>`;return i.unit&&(c+=` ${i.unit}`),i.rolls&&(c+=` (${i.rolls} رول)`),c}).join(`
`),m=`📤 <b>إذن تسليم/صرف ${e.orderNumber}</b>
━━━━━━━━━━━━━━━━━━━━

👤 العميل: <b>${e.customerName}</b>
${e.warehouseName?`📍 المستودع: ${e.warehouseName}`:""}

📋 المواد المطلوبة:
${t}

📊 الإجمالي: <b>${r}</b>${s?` | ${s} رول`:""}
${e.estimatedValue?`💰 قيمة تقديرية: <b>${e.estimatedValue.toLocaleString()}</b>`:""}
${e.invoiceNumber?`🔖 الفاتورة: ${e.invoiceNumber}`:""}
${e.deadline?`⏰ مطلوب قبل: ${e.deadline}`:""}
${e.createdBy?`👤 بواسطة: ${e.createdBy}`:""}`,$=e.items.map(i=>{let c=`📍 ${i.name} — <b>${i.qty}</b>`;return i.unit&&(c+=` ${i.unit}`),i.rolls&&(c+=` (${i.rolls} رول)`),i.binLocation&&(c+=` ← ${i.binLocation}`),i.preferredRolls&&(c+=`
  ↳ الرولونات: ${i.preferredRolls}`),c}).join(`
`),o=`🏋️ <b>قائمة تجميع ${e.orderNumber}</b>
━━━━━━━━━━━━━━━━━━━━

${e.warehouseName?`📍 المستودع: ${e.warehouseName}`:""}

${$}

📊 الإجمالي: <b>${r}</b>${s?` | ${s} رول`:""}
${e.deadline?`⏰ مطلوب قبل: ${e.deadline}`:""}`;return b(n,"issue_order",m.trim(),e.warehouseId,{warehouse_keeper:u.trim(),picker:o.trim(),owner:m.trim()})},shipmentArrival:(n,e)=>{var u;const r=((u=e.invoices)==null?void 0:u.map(t=>`  🔖 ${t.number} — <b>${t.amount.toLocaleString()}</b>${t.items?` (${t.items} صنف)`:""}`).join(`
`))||"",s=`📦 <b>حاوية واردة ${e.containerNumber}</b>
━━━━━━━━━━━━━━━━━━━━

${e.supplierName?`👤 المورّد: <b>${e.supplierName}</b>`:""}
📊 عدد الأصناف: <b>${e.itemCount}</b>
${e.warehouseName?`📍 الاستلام في: ${e.warehouseName}`:""}
${e.arrivalDate?`📅 تاريخ الوصول: ${e.arrivalDate}`:""}

⏳ يرجى تجهيز منطقة الاستلام والفحص`,l=`📦 <b>وصول حاوية ${e.containerNumber}</b>
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

⏳ بانتظار الفحص والاستلام`;return b(n,"shipment_arrival",l.trim(),void 0,{warehouse_keeper:s.trim(),owner:l.trim()})},warehouseTransfer:(n,e)=>{const r=`🔄 <b>تحويل مستودعي ${e.transferNumber}</b>
━━━━━━━━━━━━━━━━━━━━

📍 من: <b>${e.fromWarehouse}</b>
📍 إلى: <b>${e.toWarehouse}</b>

📋 المواد:
${h(e.items)}

${e.createdBy?`👤 بواسطة: ${e.createdBy}`:""}`;return b(n,"warehouse_transfer",r.trim())},lowStock:(n,e)=>{const r=`⚠️ <b>تنبيه مخزون منخفض</b>
━━━━━━━━━━━━━━━━━━━━

📦 المادة: <b>${e.materialName}</b>
📊 المخزون الحالي: <b>${e.currentQty}</b> ${e.unit||""}
🔴 الحد الأدنى: <b>${e.minQty}</b> ${e.unit||""}
${e.warehouseName?`📍 المستودع: ${e.warehouseName}`:""}

⏰ يرجى طلب التوريد`;return b(n,"low_stock",r.trim())},paymentReceived:(n,e)=>{const r=`💰 <b>دفعة مستلمة</b>
━━━━━━━━━━━━━━━━━━━━

👤 العميل: <b>${e.customerName}</b>
💵 المبلغ: <b>${e.amount.toLocaleString()}</b> ${e.currency||"₺"}
${e.paymentMethod?`💳 الطريقة: ${e.paymentMethod}`:""}
${e.referenceNumber?`🔖 المرجع: ${e.referenceNumber}`:""}
${e.invoiceNumber?`📄 الفاتورة: ${e.invoiceNumber}`:""}
${e.remainingBalance!==void 0?`📊 الرصيد المتبقي: <b>${e.remainingBalance.toLocaleString()}</b> ${e.currency||"₺"}`:""}
${e.receivedBy?`👤 استلمها: ${e.receivedBy}`:""}`;return b(n,"payment_received",r.trim())},paymentSent:(n,e)=>{const r=`💸 <b>دفعة صادرة</b>
━━━━━━━━━━━━━━━━━━━━

👤 المستفيد: <b>${e.recipientName}</b>
💵 المبلغ: <b>${e.amount.toLocaleString()}</b> ${e.currency||"₺"}
${e.purpose?`📝 الغرض: ${e.purpose}`:""}`;return b(n,"payment_sent",r.trim())},priceUpdate:(n,e)=>{const s=`💹 <b>تحديث أسعار</b>
━━━━━━━━━━━━━━━━━━━━

${e.items.map(l=>{const u=((l.newPrice-l.oldPrice)/l.oldPrice*100).toFixed(1);return`${l.newPrice>l.oldPrice?"📈":"📉"} ${l.name}: <b>${l.oldPrice}</b> → <b>${l.newPrice}</b> (${u}%)`}).join(`
`)}

${e.updatedBy?`👤 بواسطة: ${e.updatedBy}`:""}
${e.reason?`📝 السبب: ${e.reason}`:""}`;return b(n,"price_update",s.trim())},deliveryRoute:(n,e)=>{const r=`🚚 <b>مهمة توصيل جديدة</b>
━━━━━━━━━━━━━━━━━━━━

📋 رقم التسليم: <b>${e.deliveryNumber}</b>
👤 العميل: <b>${e.customerName}</b>
${e.customerPhone?`📱 الهاتف: ${e.customerPhone}`:""}

📍 العنوان: ${e.address}
${e.items?`📦 الحمولة: ${e.items}`:""}
${e.collectAmount?`💰 مبلغ التحصيل: <b>${e.collectAmount.toLocaleString()}</b> ${e.currency||"₺"}`:""}
${e.mapsUrl?`📍 <a href="${e.mapsUrl}">عرض على الخريطة</a>`:""}`;return b(n,"delivery_route",r.trim())},salesOrder:(n,e)=>{var o,i;const r=e.currency||"₺",s=((o=e.items)==null?void 0:o.map(c=>{let p=`• ${c.name} — <b>${c.qty}</b>`;return c.unit&&(p+=` ${c.unit}`),c.rolls&&(p+=` (${c.rolls} رول)`),c.price&&(p+=` × ${c.price.toLocaleString()} = <b>${(c.qty*c.price).toLocaleString()}</b>`),p}).join(`
`))||"",l=`🛒 <b>طلب بيع جديد ${e.orderNumber}</b>
━━━━━━━━━━━━━━━━━━━━

👤 العميل: <b>${e.customerName}</b>
${e.salesPerson?`🧑‍💼 المندوب: ${e.salesPerson}`:""}

${s?`📋 الأصناف:
${s}
`:`📦 عدد الأصناف: ${e.itemCount}`}
💰 إجمالي الفاتورة: <b>${e.totalAmount.toLocaleString()}</b> ${r}
${e.notes?`📝 ملاحظات: ${e.notes}`:""}`,u=`🧾 <b>فاتورة مبيعات جديدة ${e.orderNumber}</b>
━━━━━━━━━━━━━━━━━━━━

👤 العميل: <b>${e.customerName}</b>
📦 عدد الأصناف: ${e.itemCount}
💰 الإجمالي: <b>${e.totalAmount.toLocaleString()}</b> ${r}
${e.salesPerson?`🧑‍💼 المندوب: ${e.salesPerson}`:""}`,t=((i=e.items)==null?void 0:i.map(c=>{let p=`• ${c.name} — <b>${c.qty}</b>`;return c.unit&&(p+=` ${c.unit}`),c.rolls&&(p+=` (${c.rolls} رول)`),p}).join(`
`))||"",m=`📤 <b>جهّز بضاعة لطلب ${e.orderNumber}</b>
━━━━━━━━━━━━━━━━━━━━

👤 العميل: <b>${e.customerName}</b>

📋 المواد المطلوبة:
${t||`📦 ${e.itemCount} صنف`}

⏳ يرجى تجهيز الطلب`,$=`💳 <b>فاتورة بيع ${e.orderNumber}</b>
━━━━━━━━━━━━━━━━━━━━

👤 العميل: <b>${e.customerName}</b>
💰 المبلغ المطلوب: <b>${e.totalAmount.toLocaleString()}</b> ${r}
📦 عدد الأصناف: ${e.itemCount}`;return b(n,"sales_order",l.trim(),void 0,{owner:l.trim(),sales_manager:l.trim(),accountant:u.trim(),cashier:$.trim(),warehouse_keeper:m.trim()})},invoiceDue:(n,e)=>{const s=`📄 <b>فاتورة مستحقة ${e.daysLeft<=0?"🔴 متأخرة!":e.daysLeft<=3?"🟠 عاجل":"🟡 قريبة"}</b>
━━━━━━━━━━━━━━━━━━━━

📋 الفاتورة: <b>${e.invoiceNumber}</b>
👤 العميل: <b>${e.customerName}</b>
💵 المبلغ: <b>${e.amount.toLocaleString()}</b> ${e.currency||"₺"}
📅 الاستحقاق: ${e.dueDate}
${e.daysLeft<=0?`⚠️ متأخرة بـ ${Math.abs(e.daysLeft)} يوم`:`⏳ متبقي ${e.daysLeft} يوم`}`;return b(n,"invoice_due",s.trim())},creditLimit:(n,e)=>{const r=`🚫 <b>تجاوز حد ائتمان</b>
━━━━━━━━━━━━━━━━━━━━

👤 العميل: <b>${e.customerName}</b>
💰 الرصيد المستحق: <b>${e.balance.toLocaleString()}</b> ${e.currency||"₺"}
🔴 الحد المسموح: <b>${e.limit.toLocaleString()}</b> ${e.currency||"₺"}
⚠️ التجاوز: <b>${(e.balance-e.limit).toLocaleString()}</b> ${e.currency||"₺"}`;return b(n,"credit_limit",r.trim())},inventoryTask:(n,e)=>{const r=`📋 <b>مهمة جرد جديدة</b>
━━━━━━━━━━━━━━━━━━━━

📊 النوع: ${e.taskType}
📍 المستودع: <b>${e.warehouseName}</b>
📅 الموعد النهائي: ${e.deadline}
📦 عدد المواد: <b>${e.itemCount}</b>
${e.rollCount?`🧵 عدد الرولونات: <b>${e.rollCount}</b>`:""}

⏰ يرجى إتمام الجرد والإبلاغ عبر النظام`;return b(n,"inventory_task",r.trim())},customerGoodsReady:async(n,e)=>{var r;try{const{data:s}=await y.from("customers").select("telegram_chat_id, telegram_username").eq("id",e.customerId).maybeSingle();if(!(s!=null&&s.telegram_chat_id))return console.log(`[TelegramNotify] Customer ${e.customerName} has no Telegram linked`),{ok:!1,error:"No Telegram for customer"};const l=(r=e.items)!=null&&r.length?`
📋 المواد:
${h(e.items)}`:"",u=`✅ <b>بضاعتكم جاهزة!</b>
━━━━━━━━━━━━━━━━━━━━

مرحباً <b>${e.customerName}</b> 👋

${e.invoiceNumber?`📋 الفاتورة: <b>${e.invoiceNumber}</b>`:""}${l}
${e.totalQty?`📊 الإجمالي: <b>${e.totalQty}</b> م`:""}
${e.pickupAddress?`📍 عنوان الاستلام: ${e.pickupAddress}`:""}
${e.deliveryDate?`📅 موعد التوصيل: ${e.deliveryDate}`:""}

${e.companyName?`— ${e.companyName}`:"— TexaFab"}`;return(await y.functions.invoke("telegram-webhook",{body:{action:"send_direct_message",company_id:n,chat_id:s.telegram_chat_id,html_message:u.trim()}})).data||{ok:!1}}catch(s){return console.warn("[TelegramNotify] Customer notification error:",s),{ok:!1,error:"Failed"}}},custom:(n,e,r)=>b(n,e,r),warehousePickingOrder:async(n,e)=>{try{const r=e.items.map(o=>o.materialId).filter(o=>!!o),s=await a(r,e.warehouseId),l=e.items.map((o,i)=>{var p;let c=`<b>${i+1}.</b> ${o.name}`;if(o.color&&(c+=` (${o.color})`),c+=`
   📏 الكمية: <b>${o.qty}</b> ${o.unit||"م"}`,o.rolls&&(c+=` | ${o.rolls} رول`),o.materialId&&((p=s[o.materialId])!=null&&p.length)){const g=s[o.materialId].slice(0,3).map(f=>`📍 <code>${f.binCode}</code> (${f.rollCount} رول, ${f.totalLength} م)`).join(`
   `);c+=`
   ${g}`}return c}).join(`

`),u=e.shippingMethod?`
🚛 <b>طريقة الشحن:</b> ${N(e.shippingMethod)}`:"",t=e.shippingAddress?`
📍 <b>عنوان التوصيل:</b> ${e.shippingAddress}`:"",m=e.driverName?`
👤 <b>السائق:</b> ${e.driverName}${e.driverPhone?` (${e.driverPhone})`:""}`:"",$=`📦 <b>طلب تجميع — فاتورة ${e.orderNumber}</b>
━━━━━━━━━━━━━━━━━━━━━━━━

👤 العميل: <b>${e.customerName}</b>${e.customerPhone?` 📱 ${e.customerPhone}`:""}
${e.warehouseName?`🏭 المستودع: <b>${e.warehouseName}</b>`:""}
${e.totalAmount?`💰 المبلغ: <b>${e.totalAmount.toLocaleString()}</b> ${e.currency||"₺"}`:""}

📋 <b>البنود المطلوبة:</b>
${l}
${u}${t}${m}
${e.notes?`
📝 ملاحظات: ${e.notes}`:""}
${e.createdBy?`
👤 بواسطة: ${e.createdBy}`:""}

⚡ يرجى تجميع الطلب وإعداده للتسليم`;return b(n,"warehouse_picking",$.trim(),e.warehouseId)}catch(r){return console.warn("[TelegramNotify] warehousePickingOrder error:",r),{ok:!1,error:"Failed"}}},warehouseReceivingOrder:async(n,e)=>{try{const r=e.items.map(t=>t.materialId).filter(t=>!!t),s=await a(r,e.warehouseId),l=e.items.map((t,m)=>{var o;let $=`<b>${m+1}.</b> ${t.name}`;if(t.color&&($+=` (${t.color})`),$+=`
   📏 الكمية: <b>${t.qty}</b> ${t.unit||"م"}`,t.rolls&&($+=` | ${t.rolls} رول`),t.materialId&&((o=s[t.materialId])!=null&&o.length)){const i=s[t.materialId][0];$+=`
   💡 موقع مقترح: <code>${i.binCode}</code> (يوجد فيه ${i.rollCount} رول)`}return $}).join(`

`),u=`📥 <b>طلب استلام مشتريات — ${e.orderNumber}</b>
━━━━━━━━━━━━━━━━━━━━━━━━

👤 المورّد: <b>${e.supplierName}</b>
${e.warehouseName?`🏭 المستودع: <b>${e.warehouseName}</b>`:""}
${e.totalAmount?`💰 المبلغ: <b>${e.totalAmount.toLocaleString()}</b> ${e.currency||"₺"}`:""}

📋 <b>المواد الواردة:</b>
${l}
${e.notes?`
📝 ملاحظات: ${e.notes}`:""}
${e.createdBy?`
👤 بواسطة: ${e.createdBy}`:""}

⚡ يرجى الفحص والاستلام وترتيب المواد بالمستودع`;return b(n,"warehouse_receiving",u.trim(),e.warehouseId)}catch(r){return console.warn("[TelegramNotify] warehouseReceivingOrder error:",r),{ok:!1,error:"Failed"}}},warehouseTransferPicking:async(n,e)=>{try{const r=e.items.map(o=>o.materialId).filter(o=>!!o),s=await a(r,e.fromWarehouseId),l=e.items.map((o,i)=>{var p;let c=`<b>${i+1}.</b> ${o.name}`;if(o.color&&(c+=` (${o.color})`),c+=`
   📏 الكمية: <b>${o.qty}</b> ${o.unit||"م"}`,o.rolls&&(c+=` | ${o.rolls} رول`),o.materialId&&((p=s[o.materialId])!=null&&p.length)){const g=s[o.materialId].slice(0,3).map(f=>`📍 <code>${f.binCode}</code> (${f.rollCount} رول, ${f.totalLength} م)`).join(`
   `);c+=`
   ${g}`}return c}).join(`

`),u=e.shippingMethod?`
🚛 طريقة النقل: ${N(e.shippingMethod)}`:"",t=e.driverName?`
👤 السائق: ${e.driverName}${e.driverPhone?` (${e.driverPhone})`:""}`:"",m=e.vehicleNumber?`
🚗 رقم المركبة: ${e.vehicleNumber}`:"",$=`🔄 <b>طلب تجميع مناقلة — ${e.transferNumber}</b>
━━━━━━━━━━━━━━━━━━━━━━━━

📍 من: <b>${e.fromWarehouseName}</b>
📍 إلى: <b>${e.toWarehouseName}</b>

📋 <b>المواد المطلوب نقلها:</b>
${l}
${u}${t}${m}
${e.notes?`
📝 ملاحظات: ${e.notes}`:""}
${e.createdBy?`
👤 بواسطة: ${e.createdBy}`:""}

⚡ يرجى تجميع المواد وتجهيزها للنقل`;return b(n,"warehouse_transfer_picking",$.trim(),e.fromWarehouseId)}catch(r){return console.warn("[TelegramNotify] warehouseTransferPicking error:",r),{ok:!1,error:"Failed"}}},remittanceCreated:(n,e)=>{const r=t=>t.toLocaleString("en-US",{minimumFractionDigits:2}),s={branch:"🏬 استلام من الفرع",agent:"🤝 عبر وكيل",bank:"🏦 تحويل بنكي",wallet:"📱 محفظة إلكترونية",internal:"🔄 داخلي",delegate:"🚗 مندوب"},l=`💸 <b>حوالة صادرة جديدة ${e.remittanceNumber}</b>
━━━━━━━━━━━━━━━━━━━━

👤 المرسل: <b>${e.senderName}</b>
👤 المستقبل: <b>${e.receiverName}</b>
${e.deliveryCountry?`🌍 الوجهة: ${e.deliveryCountry}`:""}

💵 مبلغ الإرسال: <b>${r(e.sendAmount)}</b> ${e.sendCurrency}
${e.receiveAmount?`💰 مبلغ الاستلام: <b>${r(e.receiveAmount)}</b> ${e.receiveCurrency||e.sendCurrency}`:""}
${e.commission?`🏷 العمولة: <b>${r(e.commission)}</b> ${e.sendCurrency}`:""}
📦 طريقة التسليم: ${s[e.deliveryMethod]||e.deliveryMethod}
${e.trackingCode?`🔍 كود التتبع: <b>${e.trackingCode}</b>`:""}
${e.createdBy?`👤 بواسطة: ${e.createdBy}`:""}`,u=`💸 <b>حوالة ${e.remittanceNumber}</b>
━━━━━━━━━━━━━━━━━━━━

👤 ${e.senderName} → ${e.receiverName}
💵 المبلغ: <b>${r(e.sendAmount)}</b> ${e.sendCurrency}
${e.commission?`🏷 العمولة: <b>${r(e.commission)}</b>`:""}
💰 إجمالي التحصيل: <b>${r(e.sendAmount+(e.commission||0))}</b> ${e.sendCurrency}`;return b(n,"remittance_created",l.trim(),void 0,{owner:l.trim(),cashier:u.trim(),accountant:l.trim()})},remittanceSent:(n,e)=>{const r=l=>l.toLocaleString("en-US",{minimumFractionDigits:2}),s=`✈️ <b>تم إرسال الحوالة ${e.remittanceNumber}</b>
━━━━━━━━━━━━━━━━━━━━

👤 ${e.senderName} → <b>${e.receiverName}</b>
💵 المبلغ: <b>${r(e.sendAmount)}</b> ${e.sendCurrency}
${e.agentName?`🤝 الوكيل: ${e.agentName}`:""}
${e.trackingCode?`🔍 كود التتبع: <b>${e.trackingCode}</b>`:""}

⏳ بانتظار تأكيد التسليم`;return b(n,"remittance_sent",s.trim())},remittanceDelivered:(n,e)=>{const r=l=>l.toLocaleString("en-US",{minimumFractionDigits:2}),s=`✅ <b>تم تسليم الحوالة ${e.remittanceNumber}</b>
━━━━━━━━━━━━━━━━━━━━

👤 المستقبل: <b>${e.receiverName}</b>
💰 المبلغ المسلّم: <b>${r(e.receiveAmount)}</b> ${e.receiveCurrency}
${e.deliveredBy?`👤 سلّمها: ${e.deliveredBy}`:""}

✅ الحوالة مكتملة`;return b(n,"remittance_delivered",s.trim())},remittanceIncoming:(n,e)=>{const r=u=>u.toLocaleString("en-US",{minimumFractionDigits:2}),s=e.partnerName||e.agentName||"غير محدد",l=`📥 <b>حوالة واردة ${e.remittanceNumber}</b>
━━━━━━━━━━━━━━━━━━━━

🤝 المصدر: <b>${s}</b>
👤 المرسل: ${e.senderName}
👤 المستقبل: <b>${e.receiverName}</b>

💵 مبلغ الإرسال: <b>${r(e.sendAmount)}</b> ${e.sendCurrency}
💰 مبلغ التسليم: <b>${r(e.receiveAmount)}</b> ${e.receiveCurrency}

⏳ يرجى تسليم المبلغ للمستقبل`;return b(n,"remittance_incoming",l.trim())},remittanceCancelled:(n,e)=>{const r=l=>l.toLocaleString("en-US",{minimumFractionDigits:2}),s=`❌ <b>إلغاء حوالة ${e.remittanceNumber}</b>
━━━━━━━━━━━━━━━━━━━━

👤 المرسل: <b>${e.senderName}</b>
💵 المبلغ: <b>${r(e.sendAmount)}</b> ${e.sendCurrency}
${e.reason?`📝 السبب: ${e.reason}`:""}
${e.cancelledBy?`👤 بواسطة: ${e.cancelledBy}`:""}

⚠️ يجب إرجاع المبلغ للمرسل`;return b(n,"remittance_cancelled",s.trim())},remittanceStatusChange:(n,e)=>{const r={pending:"⏳ بانتظار",processing:"🔄 معالجة",sent:"✈️ أُرسلت",delivered:"✅ تم التسليم",completed:"🏁 مكتملة",cancelled:"❌ ملغاة",returned:"↩️ مرتجعة"},s=`🔄 <b>تحديث حالة حوالة ${e.remittanceNumber}</b>
━━━━━━━━━━━━━━━━━━━━

${r[e.oldStatus]||e.oldStatus} → <b>${r[e.newStatus]||e.newStatus}</b>
${e.senderName?`👤 ${e.senderName}`:""}${e.receiverName?` → ${e.receiverName}`:""}
${e.changedBy?`👤 بواسطة: ${e.changedBy}`:""}`;return b(n,"remittance_status_change",s.trim())}};export{L as default,C as sendTestNotification,L as telegramNotify};
