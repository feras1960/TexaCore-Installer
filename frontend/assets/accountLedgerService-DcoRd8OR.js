import{h as N,s as h}from"./index-B2ZDZha3.js";import"./vendor-data-CLVn9T7b.js";import"./vendor-react-jwcFVDcr.js";import"./vendor-ui-Da1ya4mL.js";import"./vendor-charts-BmzKQtJe.js";const F={async getLedger(o){const l=await N();let e=h.from("journal_entry_lines").select(`
        id,
        line_number,
        debit,
        credit,
        debit_fc,
        credit_fc,
        description,
        cost_center_id,
        party_type,
        party_id,
        reference_type,
        reference_id,
        currency,
        exchange_rate,
        created_at,
        journal_entries!inner (
          id,
          entry_number,
          entry_date,
          description,
          status,
          is_posted,
          reference_type,
          reference_id,
          reference_number,
          entry_type,
          currency
        )
      `).eq("account_id",o.accountId);l&&(e=e.eq("tenant_id",l)),o.dateFrom&&(e=e.gte("journal_entries.entry_date",o.dateFrom)),o.dateTo&&(e=e.lte("journal_entries.entry_date",o.dateTo)),e=e.neq("journal_entries.status","cancelled"),e=e.neq("journal_entries.status","voided"),o.status==="draft"?e=e.eq("journal_entries.status","draft"):o.status==="all"||(e=e.eq("journal_entries.is_posted",!0)),o.costCenterId&&o.costCenterId!=="all"&&(o.costCenterId==="null"?e=e.is("cost_center_id",null):e=e.eq("cost_center_id",o.costCenterId)),e=e.order("created_at",{ascending:!0}).limit(1e3);const{data:d,error:a}=await e;if(a)throw console.error("Error fetching ledger entries:",a),a;const{data:p}=await h.from("chart_of_accounts").select("opening_balance, current_balance").eq("id",o.accountId).maybeSingle(),s=(p==null?void 0:p.opening_balance)||0,t=(d||[]).sort((n,r)=>{var j,D;const y=((j=n.journal_entries)==null?void 0:j.entry_date)||"",g=((D=r.journal_entries)==null?void 0:D.entry_date)||"";return y!==g?y.localeCompare(g):(n.created_at||"").localeCompare(r.created_at||"")});let u=s;const i=t.map(n=>{const r=n.journal_entries,y=n.debit||0,g=n.credit||0,j=n.debit_fc!=null?Number(n.debit_fc):null,D=n.credit_fc!=null?Number(n.credit_fc):null;u=u+y-g;let q="journal";const b=r.reference_type||r.entry_type||"",w=r.entry_type||"";return b.includes("invoice")||b.includes("INV")?q="invoice":b.includes("payment")||b.includes("PAY")||w==="payment"?q="payment":b.includes("receipt")||b.includes("RCT")||w==="receipt"?q="receipt":b.includes("transfer")||b.includes("TRF")?q="transfer":w==="cash"&&(q="cash"),{id:n.id,date:r.entry_date,description:n.description||r.description,reference:r.reference_number||r.entry_number,referenceType:r.reference_type||r.entry_type||"manual",referenceId:r.reference_id||n.reference_id||void 0,entryId:r.id,entryType:r.entry_type||"manual",entryNumber:r.entry_number,lineNumber:n.line_number,debit:y,credit:g,debitFc:j,creditFc:D,balance:u,type:q,status:r.status,costCenterId:n.cost_center_id,partyType:n.party_type,partyId:n.party_id,currency:n.currency||r.currency,exchangeRate:n.exchange_rate||1,markerColor:n.marker_color||null,createdAt:n.created_at}}),c=i.reduce((n,r)=>n+r.debit,0),f=i.reduce((n,r)=>n+r.credit,0),T=i.length>0?i[i.length-1]:null;let _=0;if(i.length>0){const n=new Date(i[0].date),r=new Date(i[i.length-1].date),y=Math.max(1,(r.getTime()-n.getTime())/(1e3*60*60*24*30));_=Math.round((c+f)/2/y)}const m={totalDebit:c,totalCredit:f,currentBalance:u,openingBalance:s,transactionCount:i.length,lastActivityDate:(T==null?void 0:T.date)||null,monthlyAverage:_,periodDebit:c,periodCredit:f};return{entries:i,stats:m}},async getStats(o,l){const e=await N(),{data:d}=await h.from("chart_of_accounts").select("opening_balance, current_balance").eq("id",o).maybeSingle();let a=h.from("journal_entry_lines").select(`
        debit,
        credit,
        journal_entries!inner (
          entry_date,
          is_posted
        )
      `).eq("account_id",o);e&&(a=a.eq("tenant_id",e)),a=a.eq("journal_entries.is_posted",!0);const{data:p,error:s}=await a;if(s)throw console.error("Error fetching account stats:",s),s;const t=p||[],u=t.reduce((_,m)=>_+(m.debit||0),0),i=t.reduce((_,m)=>_+(m.credit||0),0),c=(d==null?void 0:d.opening_balance)||0;let f=null;if(t.length>0){const _=t.map(m=>m.journal_entries.entry_date).sort();f=_[_.length-1]}let T=0;if(t.length>0){const _=t.map(y=>new Date(y.journal_entries.entry_date)).sort((y,g)=>y.getTime()-g.getTime()),m=_[0],n=_[_.length-1],r=Math.max(1,(n.getTime()-m.getTime())/(1e3*60*60*24*30));T=Math.round((u+i)/2/r)}return{totalDebit:u,totalCredit:i,currentBalance:c+u-i,openingBalance:c,transactionCount:t.length,lastActivityDate:f,monthlyAverage:T,periodDebit:u,periodCredit:i}},async getPayments(o,l,e){const d=await N();let a=h.from("cash_transactions").select(`
        id,
        transaction_number,
        transaction_date,
        transaction_type,
        amount,
        currency,
        party_name,
        party_type,
        payment_method,
        check_number,
        check_date,
        description,
        status,
        reference_number,
        created_at,
        cash_accounts!inner (
          gl_account_id
        )
      `).eq("company_id",l);d&&(a=a.eq("tenant_id",d)),a=a.eq("cash_accounts.gl_account_id",o),e!=null&&e.dateFrom&&(a=a.gte("transaction_date",e.dateFrom)),e!=null&&e.dateTo&&(a=a.lte("transaction_date",e.dateTo)),e!=null&&e.transactionType&&e.transactionType!=="all"&&(a=a.eq("transaction_type",e.transactionType)),a=a.order("transaction_date",{ascending:!1});const{data:p,error:s}=await a;if(s){let t=h.from("cash_transactions").select("*").eq("company_id",l).eq("contra_account_id",o);d&&(t=t.eq("tenant_id",d)),e!=null&&e.dateFrom&&(t=t.gte("transaction_date",e.dateFrom)),e!=null&&e.dateTo&&(t=t.lte("transaction_date",e.dateTo)),t=t.order("transaction_date",{ascending:!1});const{data:u,error:i}=await t;return i?(console.error("Error fetching payments:",i),[]):(u||[]).map(c=>({id:c.id,transactionNumber:c.transaction_number,transactionDate:c.transaction_date,transactionType:c.transaction_type,amount:c.amount,currency:c.currency||"",partyName:c.party_name,partyType:c.party_type,paymentMethod:c.payment_method,checkNumber:c.check_number,checkDate:c.check_date,description:c.description,status:c.status,referenceNumber:c.reference_number,createdAt:c.created_at}))}return(p||[]).map(t=>({id:t.id,transactionNumber:t.transaction_number,transactionDate:t.transaction_date,transactionType:t.transaction_type,amount:t.amount,currency:t.currency||"",partyName:t.party_name,partyType:t.party_type,paymentMethod:t.payment_method,checkNumber:t.check_number,checkDate:t.check_date,description:t.description,status:t.status,referenceNumber:t.reference_number,createdAt:t.created_at}))},async getRecentActivity(o,l=10){const e=await N();let d=h.from("journal_entry_lines").select(`
        id,
        line_number,
        debit,
        credit,
        description,
        created_at,
        journal_entries!inner (
          id,
          entry_number,
          entry_date,
          description,
          status,
          reference_type,
          reference_number,
          entry_type
        )
      `).eq("account_id",o).order("created_at",{ascending:!1}).limit(l);e&&(d=d.eq("tenant_id",e)),d=d.eq("journal_entries.is_posted",!0);const{data:a,error:p}=await d;return p?(console.error("Error fetching recent activity:",p),[]):(a||[]).map(s=>{const t=s.journal_entries;return{id:s.id,date:t.entry_date,description:s.description||t.description,reference:t.reference_number||t.entry_number,referenceType:t.reference_type||t.entry_type||"manual",entryId:t.id,entryNumber:t.entry_number,lineNumber:s.line_number,debit:s.debit||0,credit:s.credit||0,debitFc:null,creditFc:null,balance:0,type:"journal",status:t.status,createdAt:s.created_at}})}};export{F as accountLedgerService};
