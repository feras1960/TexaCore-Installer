import{g as o}from"./vendor-data-CLVn9T7b.js";import{s as i}from"./index-B2ZDZha3.js";function s(t){return o({queryKey:["accounting_defaults",t],queryFn:async()=>{if(!t)return null;const{data:e,error:a}=await i.from("company_accounting_settings").select(`
                    default_cash_account_id,
                    default_bank_account_id,
                    default_receivable_account_id,
                    default_payable_account_id,
                    default_revenue_account_id,
                    default_sales_account_id,
                    default_expense_account_id,
                    default_purchase_account_id,
                    default_cogs_account_id,
                    default_inventory_account_id,
                    default_tax_input_account_id,
                    default_tax_output_account_id,
                    default_fx_gain_account_id,
                    default_fx_loss_account_id,
                    default_freight_in_account_id
                `).eq("company_id",t).single();if(a||!e)return null;const n=Object.values(e).filter(Boolean);if(n.length===0)return{settings:e,codes:{}};const{data:_}=await i.from("chart_of_accounts").select("id, account_code, name_ar, name_en").in("id",n),c={};return _==null||_.forEach(u=>{c[u.id]={code:u.account_code,nameAr:u.name_ar,nameEn:u.name_en}}),{settings:e,codes:c}},enabled:!!t,staleTime:6e4})}function f(t,e,a="—"){return!e||!t[e]?a:t[e].code}function l(t,e,a,n=""){return!e||!t[e]?n:a?t[e].nameAr:t[e].nameEn}export{f as a,l as g,s as u};
