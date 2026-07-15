import{s as y,Q as v}from"./index-TAfdzWPs.js";import"./vendor-data-BWRv08bE.js";import"./vendor-react-CtdH4caE.js";import"./vendor-pdf-B4TnB1dM.js";import"./vendor-ui-BitSHV4X.js";import"./vendor-charts-Bj5N56Ou.js";import"./vendor-xlsx-BkI8taly.js";import"./vendor-echarts-DnurwZoN.js";import"./vendor-livekit-WT0eXGDi.js";const f=new Map,a=2*60*1e3;function h(o){const e=Date.now();if(f.size>200)for(const[i,t]of f)e-t>a&&f.delete(i);const r=f.get(o);return r&&e-r<a?!0:(f.set(o,e),!1)}async function b(o,e,r,i,t){try{const{data:{session:$}}=await y.auth.getSession();if(!$)return{ok:!1,error:"Not authenticated"};let u={ok:!0};try{const c=await v.functions.invoke("telegram-webhook",{body:{action:"dispatch_notification",company_id:o,event_type:e,html_message:r,...i?{target_warehouse_id:i}:{},...t?{role_messages:t}:{}}});c.error&&console.warn(`[TelegramNotify] ${e} response error (may be CORS):`,c.error),u=(c==null?void 0:c.data)||{ok:!0,sent:1}}catch(c){console.warn(`[TelegramNotify] ${e} fetch error (likely CORS, message may have been sent):`,c),u={ok:!0,sent:1,cors_fallback:!0}}return(u==null?void 0:u.sent)>0&&console.log(`[TelegramNotify] ${e}: sent=${u.sent}`),u}catch($){return console.warn("[TelegramNotify] Error:",$),{ok:!1,error:"Network error"}}}async function D(o,e){var r,i,t;try{const{data:{session:$}}=await y.auth.getSession();if(!$)return{ok:!1,error:"Not authenticated"};const u=((r=$.user.user_metadata)==null?void 0:r.full_name)||$.user.email||"User",c=new Date().toLocaleTimeString("en-US",{hour:"2-digit",minute:"2-digit"});if(o==="telegram"){const l=`🧪 <b>إشعار تجريبي — Test Notification</b>
━━━━━━━━━━━━━━━━━━━━

✅ مرحباً <b>${u}</b>
📱 إشعارات التلغرام تعمل بنجاح!
⏰ ${c}

— TexaCore ERP`;let m=e||((i=$.user.app_metadata)==null?void 0:i.company_id);if(!m){const{data:s}=await y.from("user_profiles").select("company_id").eq("id",$.user.id).maybeSingle();m=s==null?void 0:s.company_id}if(m){const s=await b(m,"test_notification",l);return{ok:!!(s!=null&&s.ok)||!!(s!=null&&s.sent)}}return{ok:!1,error:"No company ID"}}if(o==="email"){const l=`
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
      مرحباً <strong style="color:#1e293b;">${u}</strong><br>
      إشعارات البريد الإلكتروني تعمل بنجاح!
    </p>
    <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:16px;margin:20px 0;">
      <div style="display:inline-block;background:#059669;color:#fff;font-size:12px;font-weight:700;padding:4px 12px;border-radius:20px;margin-bottom:8px;">CONNECTED</div>
      <p style="margin:8px 0 0;color:#166534;font-size:13px;">📧 ${$.user.email}</p>
      <p style="margin:4px 0 0;color:#166534;font-size:13px;">⏰ ${c}</p>
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
</html>`;return{ok:!(await v.functions.invoke("send-email",{body:{to:$.user.email,subject:"✅ TexaCore — إشعار تجريبي ناجح",html:l}})).error}}if(o==="in_app"){let l=(t=$.user.app_metadata)==null?void 0:t.company_id;if(!l){const{data:m}=await y.from("user_profiles").select("company_id").eq("id",$.user.id).maybeSingle();l=m==null?void 0:m.company_id}return await y.from("notifications").insert({user_id:$.user.id,tenant_id:l,title:"🧪 إشعار تجريبي — Test",body:`✅ الإشعارات الداخلية تعمل بنجاح! (${c})`,type:"success",source_type:"system",metadata:{test:!0}}),{ok:!0}}return{ok:!1,error:"Unknown channel"}}catch($){return{ok:!1,error:($==null?void 0:$.message)||"Error"}}}function w(o){return o!=null&&o.length?o.map(e=>{let r=`• ${e.name} — <b>${e.qty}</b>`;return e.unit&&(r+=` ${e.unit}`),e.rolls&&(r+=` (${e.rolls} رول)`),r}).join(`
`):""}async function d(o,e){if(!(o!=null&&o.length))return{};try{let r=y.from("fabric_rolls").select("material_id, current_length, bin_location:bin_locations(code, name, row_code, column_code)").in("material_id",o).in("status",["available","reserved","in_stock"]).not("bin_location_id","is",null);e&&(r=r.eq("warehouse_id",e));const{data:i,error:t}=await r;if(t||!(i!=null&&i.length))return{};const $={},u={};for(const c of i){const l=c.material_id,m=c.bin_location;if(!l||!(m!=null&&m.code))continue;u[l]||(u[l]={});const s=m.code;u[l][s]||(u[l][s]={code:m.code,name:m.name||`${m.row_code||""}${m.column_code||""}`,count:0,length:0}),u[l][s].count++,u[l][s].length+=Number(c.current_length)||0}for(const[c,l]of Object.entries(u))$[c]=Object.values(l).sort((m,s)=>s.count-m.count).map(m=>({binCode:m.code,binName:m.name,rollCount:m.count,totalLength:Math.round(m.length*100)/100}));return $}catch{return{}}}function L(o){return o?{store_pickup:"🏬 استلام من الفرع",direct_delivery:"🚚 توصيل مباشر",direct_pickup:"🚗 استلام مباشر من العميل",carrier:"📦 شركة شحن"}[o]||o:""}const R={receiptOrder:(o,e)=>{const r=e.totalQty||e.items.reduce((c,l)=>c+l.qty,0),i=e.totalRolls||e.items.reduce((c,l)=>c+(l.rolls||0),0),t=`📥 <b>إذن استلام جديد ${e.orderNumber}</b>
━━━━━━━━━━━━━━━━━━━━

👤 المورّد: <b>${e.supplierName}</b>
${e.warehouseName?`📍 المستودع: ${e.warehouseName}`:""}

📋 المواد:
${w(e.items)}

📊 الإجمالي: <b>${r}</b>${i?` | ${i} رول`:""}
${e.notes?`📝 ${e.notes}`:""}
${e.createdBy?`👤 بواسطة: ${e.createdBy}`:""}`,$=e.items.map(c=>{let l=`📦 ${c.name} — <b>${c.qty}</b>`;return c.unit&&(l+=` ${c.unit}`),c.rolls&&(l+=` (${c.rolls} رول)`),l}).join(`
`),u=`🏋️ <b>قائمة تنزيل ${e.orderNumber}</b>
━━━━━━━━━━━━━━━━━━━━

${e.warehouseName?`📍 المستودع: ${e.warehouseName}`:""}

${$}

📊 الإجمالي: <b>${r}</b>${i?` | ${i} رول`:""}`;return b(o,"receipt_order",t.trim(),e.warehouseId,{warehouse_keeper:t.trim(),picker:u.trim(),owner:t.trim()})},issueOrder:(o,e)=>{const r=e.totalQty||e.items.reduce((s,n)=>s+n.qty,0),i=e.items.reduce((s,n)=>s+(n.rolls||0),0),t=e.items.map(s=>{let n=`• ${s.name} — <b>${s.qty}</b>`;return s.unit&&(n+=` ${s.unit}`),s.rolls&&(n+=` (${s.rolls} رول)`),s.binLocation&&(n+=`
  📍 الموقع: ${s.binLocation}`),s.preferredRolls&&(n+=`
  ↳ الرولونات: ${s.preferredRolls}`),n}).join(`
`),$=`📤 <b>إذن تسليم ${e.orderNumber}</b>
━━━━━━━━━━━━━━━━━━━━

${e.purpose==="transfer"?"🔄 تحويل مستودعي":`👤 العميل: <b>${e.customerName}</b>`}
${e.warehouseName?`📍 المستودع: ${e.warehouseName}`:""}

📋 المواد المطلوبة:
${t}

📊 الإجمالي: <b>${r}</b>${i?` | ${i} رول`:""}
${e.deadline?`⏰ مطلوب قبل: ${e.deadline}`:""}
${e.createdBy?`👤 بواسطة: ${e.createdBy}`:""}`,u=e.items.map(s=>{let n=`• ${s.name} — <b>${s.qty}</b>`;return s.unit&&(n+=` ${s.unit}`),s.rolls&&(n+=` (${s.rolls} رول)`),n}).join(`
`),c=`📤 <b>إذن تسليم/صرف ${e.orderNumber}</b>
━━━━━━━━━━━━━━━━━━━━

👤 العميل: <b>${e.customerName}</b>
${e.warehouseName?`📍 المستودع: ${e.warehouseName}`:""}

📋 المواد المطلوبة:
${u}

📊 الإجمالي: <b>${r}</b>${i?` | ${i} رول`:""}
${e.estimatedValue?`💰 قيمة تقديرية: <b>${e.estimatedValue.toLocaleString()}</b>`:""}
${e.invoiceNumber?`🔖 الفاتورة: ${e.invoiceNumber}`:""}
${e.deadline?`⏰ مطلوب قبل: ${e.deadline}`:""}
${e.createdBy?`👤 بواسطة: ${e.createdBy}`:""}`,l=e.items.map(s=>{let n=`📍 ${s.name} — <b>${s.qty}</b>`;return s.unit&&(n+=` ${s.unit}`),s.rolls&&(n+=` (${s.rolls} رول)`),s.binLocation&&(n+=` ← ${s.binLocation}`),s.preferredRolls&&(n+=`
  ↳ الرولونات: ${s.preferredRolls}`),n}).join(`
`),m=`🏋️ <b>قائمة تجميع ${e.orderNumber}</b>
━━━━━━━━━━━━━━━━━━━━

${e.warehouseName?`📍 المستودع: ${e.warehouseName}`:""}

${l}

📊 الإجمالي: <b>${r}</b>${i?` | ${i} رول`:""}
${e.deadline?`⏰ مطلوب قبل: ${e.deadline}`:""}`;return b(o,"issue_order",c.trim(),e.warehouseId,{warehouse_keeper:$.trim(),picker:m.trim(),owner:c.trim()})},shipmentArrival:(o,e)=>{var $;const r=(($=e.invoices)==null?void 0:$.map(u=>`  🔖 ${u.number} — <b>${u.amount.toLocaleString()}</b>${u.items?` (${u.items} صنف)`:""}`).join(`
`))||"",i=`📦 <b>حاوية واردة ${e.containerNumber}</b>
━━━━━━━━━━━━━━━━━━━━

${e.supplierName?`👤 المورّد: <b>${e.supplierName}</b>`:""}
📊 عدد الأصناف: <b>${e.itemCount}</b>
${e.warehouseName?`📍 الاستلام في: ${e.warehouseName}`:""}
${e.arrivalDate?`📅 تاريخ الوصول: ${e.arrivalDate}`:""}

⏳ يرجى تجهيز منطقة الاستلام والفحص`,t=`📦 <b>وصول حاوية ${e.containerNumber}</b>
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

⏳ بانتظار الفحص والاستلام`;return b(o,"shipment_arrival",t.trim(),void 0,{warehouse_keeper:i.trim(),owner:t.trim()})},warehouseTransfer:(o,e)=>{const r=`🔄 <b>تحويل مستودعي ${e.transferNumber}</b>
━━━━━━━━━━━━━━━━━━━━

📍 من: <b>${e.fromWarehouse}</b>
📍 إلى: <b>${e.toWarehouse}</b>

📋 المواد:
${w(e.items)}

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
${e.purpose?`📝 الغرض: ${e.purpose}`:""}`;return b(o,"payment_sent",r.trim())},priceUpdate:(o,e)=>{const i=`💹 <b>تحديث أسعار</b>
━━━━━━━━━━━━━━━━━━━━

${e.items.map(t=>{const $=((t.newPrice-t.oldPrice)/t.oldPrice*100).toFixed(1);return`${t.newPrice>t.oldPrice?"📈":"📉"} ${t.name}: <b>${t.oldPrice}</b> → <b>${t.newPrice}</b> (${$}%)`}).join(`
`)}

${e.updatedBy?`👤 بواسطة: ${e.updatedBy}`:""}
${e.reason?`📝 السبب: ${e.reason}`:""}`;return b(o,"price_update",i.trim())},deliveryRoute:async(o,e)=>{const r=e.destinationType==="branch",i=r?"📍 التسليم إلى الفرع":"📍 عنوان الزبون",t=r&&e.destination||e.address||"",u=`🚚 <b>مهمة توصيل جديدة</b>
━━━━━━━━━━━━━━━━━━━━

📋 رقم التسليم: <b>${e.deliveryNumber}</b>
👤 العميل: <b>${e.customerName}</b>
${e.customerPhone?`📱 الهاتف: ${e.customerPhone}`:""}

${i}: ${t}
${e.items?`📦 الحمولة: ${e.items}`:""}
${!r&&e.collectAmount?`💰 مبلغ التحصيل: <b>${e.collectAmount.toLocaleString()}</b> ${e.currency||"₺"}`:""}
${e.mapsUrl?`📍 <a href="${e.mapsUrl}">عرض على الخريطة</a>`:""}`.trim();if(e.driverId)try{const{data:c}=await y.from("drivers").select("user_id").eq("id",e.driverId).maybeSingle(),l=c==null?void 0:c.user_id;if(l){let m={ok:!0};try{const s=await v.functions.invoke("telegram-webhook",{body:{action:"send_to_user",company_id:o,user_id:l,message:u}});m=(s==null?void 0:s.data)||{ok:!0}}catch(s){console.warn("[TelegramNotify] deliveryRoute send_to_user error (may be CORS):",s)}try{const n=u.replace(/<[^>]+>/g,"").trim().split(`
`).filter(p=>p.trim()&&!p.includes("━"));await y.from("notifications").insert({user_id:l,tenant_id:o,title:n[0]||"مهمة توصيل",body:n.slice(1,4).join(`
`).trim()||null,type:"info",source_type:"delivery",metadata:{event_type:"delivery_route",company_id:o,delivery_number:e.deliveryNumber}})}catch(s){console.warn("[TelegramNotify] deliveryRoute in-app insert failed:",s)}return y.functions.invoke("nexa-delivery-notify",{body:{company_id:o,driver_user_id:l,delivery_number:e.deliveryNumber,customer_name:e.customerName,address:e.address,destination_type:e.destinationType||"customer",destination:e.destination,collect_amount:e.collectAmount,currency:e.currency,maps_url:e.mapsUrl,items:e.items}}).catch(()=>{}),m}}catch(c){console.warn("[TelegramNotify] deliveryRoute driver lookup failed:",c)}return b(o,"delivery_route",u)},salesOrder:(o,e)=>{var m,s;const r=e.currency||"₺",i=((m=e.items)==null?void 0:m.map(n=>{let p=`• ${n.name} — <b>${n.qty}</b>`;return n.unit&&(p+=` ${n.unit}`),n.rolls&&(p+=` (${n.rolls} رول)`),n.price&&(p+=` × ${n.price.toLocaleString()} = <b>${(n.qty*n.price).toLocaleString()}</b>`),p}).join(`
`))||"",t=`🛒 <b>طلب بيع جديد ${e.orderNumber}</b>
━━━━━━━━━━━━━━━━━━━━

👤 العميل: <b>${e.customerName}</b>
${e.salesPerson?`🧑‍💼 المندوب: ${e.salesPerson}`:""}

${i?`📋 الأصناف:
${i}
`:`📦 عدد الأصناف: ${e.itemCount}`}
💰 إجمالي الفاتورة: <b>${e.totalAmount.toLocaleString()}</b> ${r}
${e.notes?`📝 ملاحظات: ${e.notes}`:""}`,$=`🧾 <b>فاتورة مبيعات جديدة ${e.orderNumber}</b>
━━━━━━━━━━━━━━━━━━━━

👤 العميل: <b>${e.customerName}</b>
📦 عدد الأصناف: ${e.itemCount}
💰 الإجمالي: <b>${e.totalAmount.toLocaleString()}</b> ${r}
${e.salesPerson?`🧑‍💼 المندوب: ${e.salesPerson}`:""}`,u=((s=e.items)==null?void 0:s.map(n=>{let p=`• ${n.name} — <b>${n.qty}</b>`;return n.unit&&(p+=` ${n.unit}`),n.rolls&&(p+=` (${n.rolls} رول)`),p}).join(`
`))||"",c=`📤 <b>جهّز بضاعة لطلب ${e.orderNumber}</b>
━━━━━━━━━━━━━━━━━━━━

👤 العميل: <b>${e.customerName}</b>

📋 المواد المطلوبة:
${u||`📦 ${e.itemCount} صنف`}

⏳ يرجى تجهيز الطلب`,l=`💳 <b>فاتورة بيع ${e.orderNumber}</b>
━━━━━━━━━━━━━━━━━━━━

👤 العميل: <b>${e.customerName}</b>
💰 المبلغ المطلوب: <b>${e.totalAmount.toLocaleString()}</b> ${r}
📦 عدد الأصناف: ${e.itemCount}`;return b(o,"sales_order",t.trim(),void 0,{owner:t.trim(),sales_manager:t.trim(),accountant:$.trim(),cashier:l.trim(),warehouse_keeper:c.trim()})},salesPosted:(o,e)=>{if(h(`sales_posted:${o}:${e.invoiceNumber}`))return Promise.resolve({ok:!0,skipped:!0,reason:"duplicate"});const r=e.currency||"₺",i=`🧾 <b>تم ترحيل فاتورة مبيعات ${e.invoiceNumber}</b>
━━━━━━━━━━━━━━━━━━━━

👤 العميل: <b>${e.customerName}</b>
💰 الإجمالي: <b>${e.totalAmount.toLocaleString()}</b> ${r}
${e.journalEntryNo?`📗 القيد: <code>${e.journalEntryNo}</code>`:""}
${e.postedBy?`👤 بواسطة: ${e.postedBy}`:""}

✅ <b>تم إنشاء القيد المحاسبي</b>`;return b(o,"sales_posted",i.trim())},invoiceDue:(o,e)=>{const i=`📄 <b>فاتورة مستحقة ${e.daysLeft<=0?"🔴 متأخرة!":e.daysLeft<=3?"🟠 عاجل":"🟡 قريبة"}</b>
━━━━━━━━━━━━━━━━━━━━

📋 الفاتورة: <b>${e.invoiceNumber}</b>
👤 العميل: <b>${e.customerName}</b>
💵 المبلغ: <b>${e.amount.toLocaleString()}</b> ${e.currency||"₺"}
📅 الاستحقاق: ${e.dueDate}
${e.daysLeft<=0?`⚠️ متأخرة بـ ${Math.abs(e.daysLeft)} يوم`:`⏳ متبقي ${e.daysLeft} يوم`}`;return b(o,"invoice_due",i.trim())},creditLimit:(o,e)=>{const r=`🚫 <b>تجاوز حد ائتمان</b>
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

⏰ يرجى إتمام الجرد والإبلاغ عبر النظام`;return b(o,"inventory_task",r.trim())},customerGoodsReady:async(o,e)=>{var r;try{const{data:i}=await y.from("customers").select("telegram_chat_id, telegram_username").eq("id",e.customerId).maybeSingle();if(!(i!=null&&i.telegram_chat_id))return console.log(`[TelegramNotify] Customer ${e.customerName} has no Telegram linked`),{ok:!1,error:"No Telegram for customer"};const t=(r=e.items)!=null&&r.length?`
📋 المواد:
${w(e.items)}`:"",$=`✅ <b>بضاعتكم جاهزة!</b>
━━━━━━━━━━━━━━━━━━━━

مرحباً <b>${e.customerName}</b> 👋

${e.invoiceNumber?`📋 الفاتورة: <b>${e.invoiceNumber}</b>`:""}${t}
${e.totalQty?`📊 الإجمالي: <b>${e.totalQty}</b> م`:""}
${e.pickupAddress?`📍 عنوان الاستلام: ${e.pickupAddress}`:""}
${e.deliveryDate?`📅 موعد التوصيل: ${e.deliveryDate}`:""}

${e.companyName?`— ${e.companyName}`:"— TexaFab"}`;return(await v.functions.invoke("telegram-webhook",{body:{action:"send_direct_message",company_id:o,chat_id:i.telegram_chat_id,html_message:$.trim()}})).data||{ok:!1}}catch(i){return console.warn("[TelegramNotify] Customer notification error:",i),{ok:!1,error:"Failed"}}},custom:(o,e,r)=>b(o,e,r),branchGoodsIncoming:(o,e)=>{var t;if(h(`branch_goods_incoming:${o}:${e.invoiceNumber}`))return Promise.resolve({ok:!0,skipped:!0,reason:"duplicate"});const r=(t=e.items)!=null&&t.length?`
📋 المواد:
${w(e.items)}`:"",i=`🏬 <b>بضاعة قادمة لفرعك</b>
━━━━━━━━━━━━━━━━━━━━

📋 الفاتورة: <b>${e.invoiceNumber}</b>
👤 العميل: <b>${e.customerName}</b>${r}
${e.sourceWarehouseName?`🏭 من المستودع: ${e.sourceWarehouseName}`:""}
${e.driverName?`🚗 السائق: ${e.driverName}${e.driverPhone?` (${e.driverPhone})`:""}`:""}

⏳ بالطريق — بانتظار الوصول للفرع`;return b(o,"branch_goods_incoming",i.trim(),e.targetWarehouseId,{sales_rep:i.trim(),owner:i.trim()})},branchReceived:(o,e)=>{if(h(`branch_received:${o}:${e.invoiceNumber}`))return Promise.resolve({ok:!0,skipped:!0,reason:"duplicate"});const r=`✅ <b>استلم الفرع البضاعة</b>
━━━━━━━━━━━━━━━━━━━━

📋 الفاتورة: <b>${e.invoiceNumber}</b>
${e.branchName?`🏬 الفرع: <b>${e.branchName}</b>`:""}
${e.totalQty!=null?`📊 الكمية المستلمة: <b>${e.totalQty}</b> م${e.rollsCount?` | ${e.rollsCount} رول`:""}`:e.rollsCount!=null?`📦 عدد الرولونات: <b>${e.rollsCount}</b>`:""}
${e.receivedBy?`👤 بواسطة: ${e.receivedBy}`:""}

📦 البضاعة الآن في الفرع — جاهزة للتسليم للعميل`;return b(o,"branch_received",r.trim(),void 0,{sales_manager:r.trim(),owner:r.trim()})},branchReturned:(o,e)=>{if(h(`branch_returned:${o}:${e.invoiceNumber}`))return Promise.resolve({ok:!0,skipped:!0,reason:"duplicate"});const r=`↩️ <b>إرجاع بضاعة من الفرع</b>
━━━━━━━━━━━━━━━━━━━━

📋 الفاتورة: <b>${e.invoiceNumber}</b>
${e.branchName?`🏬 من الفرع: <b>${e.branchName}</b>`:""}
${e.warehouseName?`🏭 إلى المستودع: ${e.warehouseName}`:""}
${e.rollsCount!=null?`📦 عدد الرولونات: <b>${e.rollsCount}</b>`:""}
${e.returnedBy?`👤 بواسطة: ${e.returnedBy}`:""}

⚠️ لم تتم الفوترة — يرجى مراجعة المخزون`;return b(o,"branch_returned",r.trim(),e.targetWarehouseId,{sales_manager:r.trim(),owner:r.trim()})},warehousePickingOrder:async(o,e)=>{if(h(`warehouse_picking:${o}:${e.orderNumber}`))return{ok:!0,skipped:!0,reason:"duplicate"};try{const r=e.items.map(n=>n.materialId).filter(n=>!!n),i=await d(r,e.warehouseId),t=e.items.map((n,p)=>{var N;let g=`<b>${p+1}.</b> ${n.name}`;if(n.color&&(g+=` (${n.color})`),g+=`
   📏 الكمية: <b>${n.qty}</b> ${n.unit||"م"}`,n.rolls&&(g+=` | ${n.rolls} رول`),n.materialId&&((N=i[n.materialId])!=null&&N.length)){const S=i[n.materialId].slice(0,3).map(k=>`📍 <code>${k.binCode}</code> (${k.rollCount} رول, ${k.totalLength} م)`).join(`
   `);g+=`
   ${S}`}return g}).join(`

`),$=e.shippingMethod?`
🚛 <b>طريقة الشحن:</b> ${L(e.shippingMethod)}`:"",u=e.shippingAddress?`
📍 <b>عنوان التوصيل:</b> ${e.shippingAddress}`:"",c=e.destinationBranch?`
🏬 <b>الوجهة:</b> فرع ${e.destinationBranch}`:"",l=e.driverName?`
👤 <b>السائق:</b> ${e.driverName}${e.driverPhone?` (${e.driverPhone})`:""}`:"",m=`📦 <b>طلب تجميع — فاتورة ${e.orderNumber}</b>
━━━━━━━━━━━━━━━━━━━━━━━━

👤 العميل: <b>${e.customerName}</b>
${e.warehouseName?`🏭 المستودع: <b>${e.warehouseName}</b>`:""}

📋 <b>البنود المطلوبة:</b>
${t}
${$}${u}${c}${l}
${e.notes?`
📝 ملاحظات: ${e.notes}`:""}
${e.createdBy?`
👤 بواسطة: ${e.createdBy}`:""}

⚡ يرجى تجميع الطلب وإعداده للتسليم`,s=`📦 <b>طلب تجميع — فاتورة ${e.orderNumber}</b>
━━━━━━━━━━━━━━━━━━━━━━━━

👤 العميل: <b>${e.customerName}</b>${e.customerPhone?` 📱 ${e.customerPhone}`:""}
${e.warehouseName?`🏭 المستودع: <b>${e.warehouseName}</b>`:""}
${e.totalAmount?`💰 المبلغ: <b>${e.totalAmount.toLocaleString()}</b> ${e.currency||"₺"}`:""}

📋 <b>البنود المطلوبة:</b>
${t}
${$}${u}${c}${l}
${e.notes?`
📝 ملاحظات: ${e.notes}`:""}
${e.createdBy?`
👤 بواسطة: ${e.createdBy}`:""}

⚡ يرجى تجميع الطلب وإعداده للتسليم`;return b(o,"warehouse_picking",s.trim(),e.warehouseId,{warehouse_keeper:m.trim(),picker:m.trim(),owner:s.trim(),_safe:m.trim()})}catch(r){return console.warn("[TelegramNotify] warehousePickingOrder error:",r),{ok:!1,error:"Failed"}}},warehouseReceivingOrder:async(o,e)=>{if(h(`warehouse_receiving:${o}:${e.orderNumber}`))return{ok:!0,skipped:!0,reason:"duplicate"};try{const r=e.items.map(c=>c.materialId).filter(c=>!!c),i=await d(r,e.warehouseId),t=e.items.map((c,l)=>{var s;let m=`<b>${l+1}.</b> ${c.name}`;if(c.color&&(m+=` (${c.color})`),m+=`
   📏 الكمية: <b>${c.qty}</b> ${c.unit||"م"}`,c.rolls&&(m+=` | ${c.rolls} رول`),c.materialId&&((s=i[c.materialId])!=null&&s.length)){const n=i[c.materialId][0];m+=`
   💡 موقع مقترح: <code>${n.binCode}</code> (يوجد فيه ${n.rollCount} رول)`}return m}).join(`

`),$=`📥 <b>طلب استلام مشتريات — ${e.orderNumber}</b>
━━━━━━━━━━━━━━━━━━━━━━━━

👤 المورّد: <b>${e.supplierName}</b>
${e.warehouseName?`🏭 المستودع: <b>${e.warehouseName}</b>`:""}

📋 <b>المواد الواردة:</b>
${t}
${e.notes?`
📝 ملاحظات: ${e.notes}`:""}
${e.createdBy?`
👤 بواسطة: ${e.createdBy}`:""}

⚡ يرجى الفحص والاستلام وترتيب المواد بالمستودع`,u=`📥 <b>طلب استلام مشتريات — ${e.orderNumber}</b>
━━━━━━━━━━━━━━━━━━━━━━━━

👤 المورّد: <b>${e.supplierName}</b>
${e.warehouseName?`🏭 المستودع: <b>${e.warehouseName}</b>`:""}
${e.totalAmount?`💰 المبلغ: <b>${e.totalAmount.toLocaleString()}</b> ${e.currency||"₺"}`:""}

📋 <b>المواد الواردة:</b>
${t}
${e.notes?`
📝 ملاحظات: ${e.notes}`:""}
${e.createdBy?`
👤 بواسطة: ${e.createdBy}`:""}

⚡ يرجى الفحص والاستلام وترتيب المواد بالمستودع`;return b(o,"warehouse_receiving",u.trim(),e.warehouseId,{warehouse_keeper:$.trim(),picker:$.trim(),owner:u.trim(),_safe:$.trim()})}catch(r){return console.warn("[TelegramNotify] warehouseReceivingOrder error:",r),{ok:!1,error:"Failed"}}},warehouseTransferPicking:async(o,e)=>{if(h(`warehouse_transfer_picking:${o}:${e.transferNumber}`))return{ok:!0,skipped:!0,reason:"duplicate"};try{const r=e.items.map(m=>m.materialId).filter(m=>!!m),i=await d(r,e.fromWarehouseId),t=e.items.map((m,s)=>{var p;let n=`<b>${s+1}.</b> ${m.name}`;if(m.color&&(n+=` (${m.color})`),n+=`
   📏 الكمية: <b>${m.qty}</b> ${m.unit||"م"}`,m.rolls&&(n+=` | ${m.rolls} رول`),m.materialId&&((p=i[m.materialId])!=null&&p.length)){const N=i[m.materialId].slice(0,3).map(_=>`📍 <code>${_.binCode}</code> (${_.rollCount} رول, ${_.totalLength} م)`).join(`
   `);n+=`
   ${N}`}return n}).join(`

`),$=e.shippingMethod?`
🚛 طريقة النقل: ${L(e.shippingMethod)}`:"",u=e.driverName?`
👤 السائق: ${e.driverName}${e.driverPhone?` (${e.driverPhone})`:""}`:"",c=e.vehicleNumber?`
🚗 رقم المركبة: ${e.vehicleNumber}`:"",l=`🔄 <b>طلب تجميع مناقلة — ${e.transferNumber}</b>
━━━━━━━━━━━━━━━━━━━━━━━━

📍 من: <b>${e.fromWarehouseName}</b>
📍 إلى: <b>${e.toWarehouseName}</b>

📋 <b>المواد المطلوب نقلها:</b>
${t}
${$}${u}${c}
${e.notes?`
📝 ملاحظات: ${e.notes}`:""}
${e.createdBy?`
👤 بواسطة: ${e.createdBy}`:""}

⚡ يرجى تجميع المواد وتجهيزها للنقل`;return b(o,"warehouse_transfer_picking",l.trim(),e.fromWarehouseId,{_safe:l.trim()})}catch(r){return console.warn("[TelegramNotify] warehouseTransferPicking error:",r),{ok:!1,error:"Failed"}}},remittanceCreated:(o,e)=>{const r=u=>u.toLocaleString("en-US",{minimumFractionDigits:2}),i={branch:"🏬 استلام من الفرع",agent:"🤝 عبر وكيل",bank:"🏦 تحويل بنكي",wallet:"📱 محفظة إلكترونية",internal:"🔄 داخلي",delegate:"🚗 مندوب"},t=`💸 <b>حوالة صادرة جديدة ${e.remittanceNumber}</b>
━━━━━━━━━━━━━━━━━━━━

👤 المرسل: <b>${e.senderName}</b>
👤 المستقبل: <b>${e.receiverName}</b>
${e.deliveryCountry?`🌍 الوجهة: ${e.deliveryCountry}`:""}

💵 مبلغ الإرسال: <b>${r(e.sendAmount)}</b> ${e.sendCurrency}
${e.receiveAmount?`💰 مبلغ الاستلام: <b>${r(e.receiveAmount)}</b> ${e.receiveCurrency||e.sendCurrency}`:""}
${e.commission?`🏷 العمولة: <b>${r(e.commission)}</b> ${e.sendCurrency}`:""}
📦 طريقة التسليم: ${i[e.deliveryMethod]||e.deliveryMethod}
${e.trackingCode?`🔍 كود التتبع: <b>${e.trackingCode}</b>`:""}
${e.createdBy?`👤 بواسطة: ${e.createdBy}`:""}`,$=`💸 <b>حوالة ${e.remittanceNumber}</b>
━━━━━━━━━━━━━━━━━━━━

👤 ${e.senderName} → ${e.receiverName}
💵 المبلغ: <b>${r(e.sendAmount)}</b> ${e.sendCurrency}
${e.commission?`🏷 العمولة: <b>${r(e.commission)}</b>`:""}
💰 إجمالي التحصيل: <b>${r(e.sendAmount+(e.commission||0))}</b> ${e.sendCurrency}`;return b(o,"remittance_created",t.trim(),void 0,{owner:t.trim(),cashier:$.trim(),accountant:t.trim()})},remittanceSent:(o,e)=>{const r=t=>t.toLocaleString("en-US",{minimumFractionDigits:2}),i=`✈️ <b>تم إرسال الحوالة ${e.remittanceNumber}</b>
━━━━━━━━━━━━━━━━━━━━

👤 ${e.senderName} → <b>${e.receiverName}</b>
💵 المبلغ: <b>${r(e.sendAmount)}</b> ${e.sendCurrency}
${e.agentName?`🤝 الوكيل: ${e.agentName}`:""}
${e.trackingCode?`🔍 كود التتبع: <b>${e.trackingCode}</b>`:""}

⏳ بانتظار تأكيد التسليم`;return b(o,"remittance_sent",i.trim())},remittanceDelivered:(o,e)=>{const r=t=>t.toLocaleString("en-US",{minimumFractionDigits:2}),i=`✅ <b>تم تسليم الحوالة ${e.remittanceNumber}</b>
━━━━━━━━━━━━━━━━━━━━

👤 المستقبل: <b>${e.receiverName}</b>
💰 المبلغ المسلّم: <b>${r(e.receiveAmount)}</b> ${e.receiveCurrency}
${e.deliveredBy?`👤 سلّمها: ${e.deliveredBy}`:""}

✅ الحوالة مكتملة`;return b(o,"remittance_delivered",i.trim())},remittanceIncoming:(o,e)=>{const r=$=>$.toLocaleString("en-US",{minimumFractionDigits:2}),i=e.partnerName||e.agentName||"غير محدد",t=`📥 <b>حوالة واردة ${e.remittanceNumber}</b>
━━━━━━━━━━━━━━━━━━━━

🤝 المصدر: <b>${i}</b>
👤 المرسل: ${e.senderName}
👤 المستقبل: <b>${e.receiverName}</b>

💵 مبلغ الإرسال: <b>${r(e.sendAmount)}</b> ${e.sendCurrency}
💰 مبلغ التسليم: <b>${r(e.receiveAmount)}</b> ${e.receiveCurrency}

⏳ يرجى تسليم المبلغ للمستقبل`;return b(o,"remittance_incoming",t.trim())},remittanceCancelled:(o,e)=>{const r=t=>t.toLocaleString("en-US",{minimumFractionDigits:2}),i=`❌ <b>إلغاء حوالة ${e.remittanceNumber}</b>
━━━━━━━━━━━━━━━━━━━━

👤 المرسل: <b>${e.senderName}</b>
💵 المبلغ: <b>${r(e.sendAmount)}</b> ${e.sendCurrency}
${e.reason?`📝 السبب: ${e.reason}`:""}
${e.cancelledBy?`👤 بواسطة: ${e.cancelledBy}`:""}

⚠️ يجب إرجاع المبلغ للمرسل`;return b(o,"remittance_cancelled",i.trim())},remittanceStatusChange:(o,e)=>{const r={pending:"⏳ بانتظار",processing:"🔄 معالجة",sent:"✈️ أُرسلت",delivered:"✅ تم التسليم",completed:"🏁 مكتملة",cancelled:"❌ ملغاة",returned:"↩️ مرتجعة"},i=`🔄 <b>تحديث حالة حوالة ${e.remittanceNumber}</b>
━━━━━━━━━━━━━━━━━━━━

${r[e.oldStatus]||e.oldStatus} → <b>${r[e.newStatus]||e.newStatus}</b>
${e.senderName?`👤 ${e.senderName}`:""}${e.receiverName?` → ${e.receiverName}`:""}
${e.changedBy?`👤 بواسطة: ${e.changedBy}`:""}`;return b(o,"remittance_status_change",i.trim())},ecomNewOrder:(o,e)=>{const r=e.currency||"UAH",i={cod:"💵 عند الاستلام",liqpay:"💳 LiqPay",wayforpay:"💳 WayForPay",bank_transfer:"🏦 تحويل بنكي",partial_prepay:"💰 دفعة مقدمة"},t=`🛒 <b>طلب جديد #${e.orderNumber}</b>
━━━━━━━━━━━━━━━━━━━━

👤 ${e.customerName}
📱 ${e.phone}
📦 ${e.itemsCount} منتج
💰 <b>${e.totalAmount.toLocaleString()} ${r}</b>
💳 ${i[e.paymentMethod]||e.paymentMethod}
${e.city?`🏙 ${e.city}`:""}${e.warehouse?`
📬 ${e.warehouse}`:""}

⚡ <b>[تأكيد] [رفض] [تفاصيل]</b>`;return b(o,"ecom_new_order",t.trim())},ecomOrderConfirmed:(o,e)=>{var m,s;const r=e.currency||"UAH",i={cod:"💵 عند الاستلام",liqpay:"💳 LiqPay",wayforpay:"💳 WayForPay",bank_transfer:"🏦 تحويل بنكي",partial_prepay:"💰 دفعة مقدمة"},t=((m=e.items)==null?void 0:m.map((n,p)=>{let g=`  ${p+1}. ${n.name} — <b>${n.qty}</b> ${n.unit||"م"}`;return n.price&&(g+=` × ${n.price.toLocaleString()} = <b>${(n.qty*n.price).toLocaleString()}</b>`),g}).join(`
`))||"",$=((s=e.items)==null?void 0:s.map((n,p)=>`  ${p+1}. ${n.name} — <b>${n.qty}</b> ${n.unit||"م"}`).join(`
`))||"";let u="";if(e.shippingAddress){const n=e.shippingAddress;typeof n=="string"?u=n:u=[n.nova_poshta_city_name||n.city,n.nova_poshta_warehouse_name||n.novaPoshtaWarehouseName,n.street,n.fullName||n.full_name].filter(Boolean).join(" — ")}const c=`✅ <b>طلب مؤكد #${e.orderNumber}</b>
━━━━━━━━━━━━━━━━━━━━

👤 العميل: <b>${e.customerName}</b>
${e.customerPhone?`📱 الهاتف: ${e.customerPhone}`:""}
${u?`📍 العنوان: ${u}`:""}
${e.paymentMethod?`💳 الدفع: ${i[e.paymentMethod]||e.paymentMethod}`:""}

${t?`📋 المنتجات:
${t}
`:""}${e.subtotal?`💵 المجموع: ${e.subtotal.toLocaleString()} ${r}`:""}
${e.shippingAmount!=null?`🚚 الشحن: ${e.shippingAmount.toLocaleString()} ${r}`:""}
💰 <b>الإجمالي: ${e.totalAmount.toLocaleString()} ${r}</b>
${e.confirmedBy?`👤 بواسطة: ${e.confirmedBy}`:""}

📦 <b>مطلوب تجهيز وشحن</b>`,l=`✅ <b>طلب مؤكد #${e.orderNumber}</b>
━━━━━━━━━━━━━━━━━━━━

👤 العميل: <b>${e.customerName}</b>
${e.customerPhone?`📱 الهاتف: ${e.customerPhone}`:""}
${u?`📍 العنوان: ${u}`:""}
${e.paymentMethod?`💳 الدفع: ${i[e.paymentMethod]||e.paymentMethod}`:""}

${$?`📋 المنتجات:
${$}`:""}

📦 <b>مطلوب تجهيز وشحن</b>`;return b(o,"ecom_order_confirmed",c.trim(),void 0,{warehouse_keeper:l.trim(),picker:l.trim(),order_manager:l.trim(),owner:c.trim(),_safe:l.trim()})},ecomOrderShipped:(o,e)=>{const r=`https://novaposhta.ua/tracking/?cargo_number=${e.trackingNumber}`,i=`🚚 <b>تم شحن الطلب #${e.orderNumber}</b>
━━━━━━━━━━━━━━━━━━━━

👤 ${e.customerName}
📦 رقم التتبع: <code>${e.trackingNumber}</code>
${e.carrier?`🏢 ${e.carrier}`:"🏢 Nova Poshta"}
${e.warehouseName?`📬 ${e.warehouseName}`:""}

🔗 <a href="${r}">تتبع الشحنة</a>`;return b(o,"ecom_order_shipped",i.trim())},ecomOrderDelivered:(o,e)=>{const r=e.currency||"UAH",i=`📬 <b>تم تسليم الطلب #${e.orderNumber}</b>
━━━━━━━━━━━━━━━━━━━━

👤 ${e.customerName}
💰 ${e.totalAmount.toLocaleString()} ${r}
${e.codCollected?`💵 تم تحصيل: ${e.codCollected.toLocaleString()} ${r}`:""}

🎉 <b>مكتمل</b>`;return b(o,"ecom_order_delivered",i.trim())},ecomOrderCancelled:(o,e)=>{const r=e.currency||"UAH",i=`❌ <b>طلب ملغي #${e.orderNumber}</b>
━━━━━━━━━━━━━━━━━━━━

👤 ${e.customerName}
💰 ${e.totalAmount.toLocaleString()} ${r}
${e.reason?`📝 السبب: ${e.reason}`:""}
${e.cancelledBy?`👤 بواسطة: ${e.cancelledBy}`:""}`;return b(o,"ecom_order_cancelled",i.trim())},ecomPaymentReceived:(o,e)=>{const r=e.currency||"UAH",i={liqpay:"LiqPay",wayforpay:"WayForPay",bank_transfer:"تحويل بنكي",cod:"عند الاستلام",partial_prepay:"دفعة مقدمة"},t=`💳 <b>دفعة مستلمة — طلب #${e.orderNumber}</b>
━━━━━━━━━━━━━━━━━━━━

💰 <b>${e.amount.toLocaleString()} ${r}</b>
💳 ${i[e.method]||e.method}
👤 ${e.customerName}`;return b(o,"ecom_payment_received",t.trim())},ecomOrderReturned:(o,e)=>{const r=e.currency||"UAH",i=`↩️ <b>طلب إرجاع — #${e.orderNumber}</b>
━━━━━━━━━━━━━━━━━━━━

👤 ${e.customerName}
💰 ${e.totalAmount.toLocaleString()} ${r}
${e.reason?`📝 السبب: ${e.reason}`:""}

⚡ <b>[قبول الإرجاع] [رفض]</b>`;return b(o,"ecom_order_returned",i.trim())},ecomLowStock:(o,e)=>{const r=`⚠️ <b>مخزون منخفض — متجر إلكتروني</b>
━━━━━━━━━━━━━━━━━━━━

📦 ${e.productName}
${e.sku?`🏷 SKU: ${e.sku}`:""}
📊 المخزون: <b>${e.currentStock}</b> ${e.unit||""} (الحد الأدنى: ${e.minStock})

⚡ <b>يرجى إعادة التوريد</b>`;return b(o,"ecom_low_stock",r.trim())}};export{R as default,D as sendTestNotification,R as telegramNotify};
