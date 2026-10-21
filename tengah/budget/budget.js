/* Tengah household budget. Figures are stored only in this browser (localStorage); nothing is sent anywhere. */
(function(){
const DOC = "budget/main";
const AGES = ["35 and below","36 to 45","46 to 50","51 to 55"];
// [employee, employer, OA, SA, MA] as share of wages, employees aged 55 and below (CPF Board, 2026)
const RATES = {"35 and below":[.20,.17,.23,.06,.08],"36 to 45":[.20,.17,.21,.07,.09],"46 to 50":[.20,.17,.19,.08,.10],"51 to 55":[.20,.17,.15,.115,.105]};
const person = n => ({name:n,salary:0,age:"35 and below",other:0,cash:0,oa:0,sa:0,ma:0,asOf:"",hdbShare:0,hdbOA:0});
const CATS = ["Home","Food","Transport","Family","Insurance","Personal","Yearly & occasional","Other"];
const FREQ = [["month","Monthly"],["year","Yearly"]];
const WHEN = [["always","Always"],["after","After we move in"],["before","Until we move in"]];
const perMonth = x => (+x.amt || 0) / (x.freq === "year" ? 12 : 1);
const applies = (x, after) => x.when === "always" || x.when === (after ? "after" : "before");
const ymOf = d => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
const fmtYM = ym => { if(!ym) return ""; const [y, m] = ym.split("-"); return new Date(+y, +m - 1, 1).toLocaleDateString("en-SG", {month:"short", year:"numeric"}); };
function moveInYM(){ return state.moveIn || (state.loan.keyDate ? state.loan.keyDate.slice(0, 7) : ""); }
function isAfterMove(ym){ const mi = moveInYM(); return !mi || ym >= mi; }
const LOAN = () => ({price:0,grants:0,ltv:75,type:"HDB loan",rate:2.6,years:25,legal:0,dpPaidPct:0,stampPaid:false,legalPaid:false,keyDate:"",splitA:50,oaPctA:100,oaPctB:100});
const STARTER = [["Home","S&CC (conservancy)","month","after"],["Home","Electricity, water & gas","month","after"],["Home","Home internet","month","after"],["Food","Eating out & hawker","month","always"],["Food","Groceries","month","always"],["Transport","MRT, bus & Grab","month","always"],["Family","Allowance to parents","month","always"],["Insurance","Insurance premiums","year","always"],["Personal","Mobile plan","month","always"],["Personal","Shopping & personal care","month","always"],["Yearly & occasional","Holidays","year","always"],["Yearly & occasional","Ang bao, gifts & weddings","year","always"]];
const STARTER_MONTHLY = () => [0, 1].flatMap(o => STARTER.map(([cat, name, freq, when], i) => ({id:"s" + o + "-" + i, owner:o, cat, name, amt:0, freq, when})));
const TEMPLATE = () => ({loan:LOAN(),people:[person("Person A"),person("Person B")],settings:{splitA:50,emergencyMonths:6,emergencyMode:"months",emergencyFixed:0,emergencySetAside:0,contingencyPct:10,ceiling:8000},housing:{items:[]},reno:{cap:0,items:["ID / design fee","Hacking & masonry","Flooring","Carpentry (kitchen, wardrobes)","Electrical & lighting","Plumbing & bathrooms","Painting","Cleaning & haulage"].map((n, i) => ({id:"r" + i, name:n, cost:0, paid:0, date:"", include:true, note:""}))},family:{angbao:0,items:["ROM solemnisation","Wedding rings","Pre-wedding photoshoot","Wedding banquet","Honeymoon"].map((n, i) => ({id:"f" + i, name:n, cost:0, paid:0, date:"", include:true, note:""}))},monthly:STARTER_MONTHLY()});

let state = TEMPLATE(), db = null, ref = null, lastSaved = null, timer = null, writing = false, again = false, loaded = false;
let tab = "overview", raw = null, lastTab = null;
const openCats = new Set(window.innerWidth >= 640 ? [0, 1].flatMap(o => CATS.map(c => o + ":" + c)) : []);
tab = document.body.dataset.page || "overview";
const FILES = {overview:"index.html", monthly:"monthly.html", housing:"housing.html", reno:"renovation.html", family:"family.html", emergency:"emergency.html"};

const app = document.getElementById("app");
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const num = v => { const n = parseFloat(String(v).replace(/[^0-9.\-]/g,"")); return isFinite(n) ? n : 0; };
const money = (v, sign) => { const r = Math.round(v); const s = "S$" + Math.abs(r).toLocaleString("en-SG"); return r < 0 ? "−" + s : (sign && r > 0 ? "+" + s : s); };
const sum = (a, f) => a.reduce((t, x) => t + (f(x) || 0), 0);
const uid = () => Math.random().toString(36).slice(2, 9);

function normalize(d){
  const t = TEMPLATE(); d = JSON.parse(JSON.stringify(d || {}));
  const out = Object.assign(t, d);
  out.settings = Object.assign(TEMPLATE().settings, d.settings || {});
  out.people = [0,1].map(i => Object.assign(person(i ? "Person B" : "Person A"), (d.people || [])[i] || {}));
  out.housing = Object.assign({items:[]}, d.housing || {});
  out.family = Object.assign({angbao:0, items:[]}, d.family || {});
  out.reno = Object.assign({cap:0, items:[], depPct:10, startPct:40, signYM:""}, d.reno || {});
  out.monthly = (d.monthly || []).flatMap(x => {
    const base = Object.assign({cat:"Other", freq:"month", when:"always", name:""}, x);
    if(base.owner === 0 || base.owner === 1) return [Object.assign({amt:0}, base)];
    const {a, b, ...rest} = base;   // old shape: one row with both people's amounts
    const rows = [];
    if(+a || !(+b)) rows.push(Object.assign({}, rest, {id: rest.id + "-a", owner: 0, amt: +a || 0}));
    if(+b) rows.push(Object.assign({}, rest, {id: rest.id + "-b", owner: 1, amt: +b}));
    return rows;
  });
  out.moveIn = d.moveIn || "";
  out.loan = Object.assign(LOAN(), d.loan || {});
  return out;
}

function monthsSince(iso){
  if(!iso) return 0;
  const a = new Date(iso + "T00:00:00"), n = new Date();
  if(isNaN(a)) return 0;
  let m = (n.getFullYear() - a.getFullYear()) * 12 + (n.getMonth() - a.getMonth());
  if(n.getDate() < a.getDate()) m--;
  return Math.max(0, m);
}

function bsd(p){ // Buyer's Stamp Duty, residential tiers
  const tiers = [[180000,.01],[180000,.02],[640000,.03],[500000,.04],[1500000,.05],[Infinity,.06]];
  let left = p, t = 0; for(const [w, r] of tiers){ const x = Math.min(left, w); t += x * r; left -= x; if(left <= 0) break; } return t;
}
function pmt(rateYr, years, pv){ const n = years * 12, r = rateYr / 1200; if(pv <= 0 || n <= 0) return 0; return r === 0 ? pv / n : pv * r / (1 - Math.pow(1 + r, -n)); }

function calc(){
  const S = state.settings, L = state.loan, k = S.contingencyPct / 100, share = [S.splitA / 100, 1 - S.splitA / 100];
  const lshare = [L.splitA / 100, 1 - L.splitA / 100], oaPct = [L.oaPctA / 100, L.oaPctB / 100];
  const rem = it => it.include ? Math.max(0, it.cost - it.paid) : 0;
  // loan
  const price = L.price, ltvAmt = price * L.ltv / 100, dp = price - ltvAmt;
  const loanAmt = Math.max(0, ltvAmt - Math.max(0, L.grants - dp));
  const dpNet = Math.max(0, dp - L.grants);
  const dpPaid = Math.min(dpNet, price * Math.max(0, L.dpPaidPct) / 100);
  const dpLeft = dpNet - dpPaid;
  const stamp = price > 0 ? bsd(price) : 0;
  const upfrontFull = dpNet + stamp + L.legal;
  const upfrontPaid = dpPaid + (L.stampPaid ? stamp : 0) + (L.legalPaid ? L.legal : 0);
  const upfront = upfrontFull - upfrontPaid;
  const minCash = L.type === "Bank loan" ? Math.max(0, Math.min(dpNet, price * 0.05) - dpPaid) : 0;
  const inst = pmt(L.rate, L.years, loanAmt);
  const totalInterest = inst * L.years * 12 - loanAmt;
  const keyM = L.keyDate ? monthsSince(L.keyDate) : 0;
  // other items
  const H = state.housing.items, F = state.family.items;
  const hCash = sum(H.filter(i => i.source !== "CPF OA"), rem), hCPF = sum(H.filter(i => i.source === "CPF OA"), rem);
  const RN = activeReno(), remR = it => !it.include ? 0 : effCost(it) < 0 ? effCost(it) : Math.max(0, effCost(it) - it.paid);
  const rRem = sum(RN, remR), rEst = Math.max(0, sum(RN.filter(it => !(+it.quote > 0)), remR));  // contingency only on items without a firm quote
  const fRem = sum(F, rem), ang = state.family.angbao || 0;
  const cont = (hCash + rEst + fRem) * k;
  const famNet = Math.max(0, fRem - ang);
  const P = state.people.map((p, i) => {
    const r = RATES[p.age] || RATES[AGES[0]], wage = Math.min(p.salary, S.ceiling);
    const emp = wage * r[0], er = wage * r[1], oaM = wage * r[2], saM = wage * r[3], maM = wage * r[4];
    const m = monthsSince(p.asOf);
    const instShare = inst * lshare[i], instOA = instShare * oaPct[i], hdbCash = instShare - instOA;
    const paidMonths = L.keyDate ? Math.min(m, keyM) : 0;
    const estOA = p.oa + oaM * m - instOA * paidMonths, estSA = p.sa + saM * m, estMA = p.ma + maM * m;
    const takeHome = p.salary - emp;
    // upfront housing: required cash first, then CPF OA, then cash for any gap
    const upMine = upfront * lshare[i], cashMin = minCash * lshare[i];
    const oaForUp = Math.max(0, Math.min(estOA - hCPF * share[i], upMine - cashMin));
    const upCash = upMine - oaForUp;
    const nowAfter = isAfterMove(ymOf(new Date()));
    const expFor = after => sum(state.monthly.filter(x => x.owner === i && applies(x, after)), perMonth) + (after ? hdbCash : 0);
    const expAfter = expFor(true), expBefore = expFor(false);
    const monthlyExp = nowAfter ? expAfter : expBefore;
    const income = takeHome + p.other;
    const surplus = income - monthlyExp, surplusAfter = income - expAfter, surplusBefore = income - expBefore;
    const myNeed = (hCash + rRem + famNet + cont) * share[i] + upCash, myCPF = hCPF * share[i] + oaForUp;
    const efGross = S.emergencyMode === "fixed" ? S.emergencyFixed * share[i] : S.emergencyMonths * expAfter;
    const target = Math.max(0, efGross - S.emergencySetAside * share[i]);
    const after = p.cash - myNeed, buffer = after - target;
    const oaAfter = estOA - myCPF;
    const status = buffer >= 0 ? "good" : after >= 0 ? "warn" : "bad";
    return {p, efGross, wage, emp, er, cpfTotal: emp + er, oaM, saM, maM, m, estOA, estSA, estMA, cpf: estOA + estSA + estMA, takeHome, instShare, instOA, hdbCash, expAfter, expBefore, surplusAfter, surplusBefore, nowAfter, upMine, oaForUp, upCash, monthlyExp, income, surplus, share: share[i], lshare: lshare[i], myNeed, myCPF, after, target, buffer, oaAfter, status, oaDrain: instOA > oaM};
  });
  const C = {};
  ["expAfter","expBefore","surplusAfter","surplusBefore","efGross","cpf","estOA","estSA","estMA","takeHome","monthlyExp","income","surplus","myNeed","myCPF","after","target","buffer","oaAfter","cpfTotal","hdbCash","oaForUp","upCash","instOA"].forEach(f => C[f] = P[0][f] + P[1][f]);
  C.cash = P[0].p.cash + P[1].p.cash;
  C.nowAfter = P[0].nowAfter;
  // month-by-month projection of combined cash, before any planned spending
  const proj = []; { let cash = C.cash; const d0 = new Date(); for(let t = 0; t <= 120; t++){ const ym = ymOf(new Date(d0.getFullYear(), d0.getMonth() + t, 1)); if(t > 0) cash += isAfterMove(ym) ? C.surplusAfter : C.surplusBefore; proj.push({t, ym, cash}); } }
  C.proj = proj;
  C.status = C.buffer >= 0 ? "good" : C.after >= 0 ? "warn" : "bad";
  const gross = P[0].p.salary + P[1].p.salary;
  const msr = gross > 0 ? inst / gross : 0;
  const cashNeed = C.myNeed, cpfNeed = C.myCPF;
  const planned = sum(H.concat(F, RN), i => i.include ? i.cost : 0) + upfrontFull, paid = sum(H.concat(F, RN), i => i.include ? i.paid : 0) + upfrontPaid;
  return {P, C, hCash, hCPF, rRem, rEst, fRem, famNet, ang, cont, cashNeed, cpfNeed, planned, paid, k,
    loan: {price, ltvAmt, dp, dpNet, dpPaid, dpLeft, loanAmt, stamp, upfront, upfrontFull, upfrontPaid, minCash, inst, totalInterest, msr, gross, keyM}};
}

/* ---------- rendering ---------- */
const STATUS = {good:"Enough", warn:"Tight", bad:"Short"};
const chip = s => `<span class="chip ${s}">${STATUS[s]}</span>`;
function fld(id, path, val, opts = {}){
  const isNum = opts.type !== "text" && opts.type !== "date" && opts.type !== "month";
  const shown = raw && raw.id === id ? raw.v : (isNum ? (val ? Number(val).toLocaleString("en-SG", {maximumFractionDigits: 2}) : "") : (val ?? ""));
  const type = opts.type === "date" ? "date" : opts.type === "month" ? "month" : "text";
  return `<input id="${id}" data-b="${path}" data-t="${isNum ? "n" : "s"}" type="${type}" ${isNum ? 'inputmode="decimal" class="n" placeholder="0"' : ""} value="${esc(shown)}" aria-label="${esc(opts.label || "")}" ${db ? "" : ""}>`;
}
function sel(id, path, val, options, label){
  return `<select id="${id}" data-b="${path}" data-t="s" aria-label="${esc(label)}">${options.map(o => { const [v, l] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(v)}"${v === val ? " selected" : ""}>${esc(l)}</option>`; }).join("")}</select>`;
}
function hasExamples(){
  return state.people.some(p => p.ex) || state.housing.items.some(i => i.ex) || state.family.items.some(i => i.ex) || state.reno.items.some(i => i.ex) || state.monthly.some(i => i.ex) || state.loan.ex;
}
const exBanner = () => hasExamples() ? `<div class="banner"><span>●</span><span><b>Example figures.</b> Rows tagged <span class="chip ex">Example</span> are placeholders, not your real numbers. Type over a value, or tap the tag to keep it as yours.</span></div>` : "";

function moveInPlan(R){
  const {C} = R, k = R.k, RS = state.reno, now = ymOf(new Date());
  const keyYM = state.loan.keyDate ? state.loan.keyDate.slice(0, 7) : "", miYM = moveInYM();
  if(!keyYM && !miYM) return {missing: true};
  const keyAt = keyYM || miYM, mi = miYM || keyAt, signAt = RS.signYM || keyAt;
  const ev = [], add = (ym, what, amt) => { if(amt > 0.5) ev.push({ym: ym < now ? now : ym, what, amt, late: ym < now}); };
  add(keyAt, "HDB downpayment balance, stamp duty & legal fees (cash part)", C.upCash);
  state.housing.items.filter(i => i.include && i.source !== "CPF OA").forEach(i => add(i.date ? i.date.slice(0, 7) : keyAt, i.name || "Housing cost", Math.max(0, i.cost - i.paid) * (1 + k)));
  const renoDue = R.rRem + R.rEst * k, dep = Math.min(100, Math.max(0, +RS.depPct || 0)), st = Math.min(100 - dep, Math.max(0, +RS.startPct || 0)), rest = 100 - dep - st;
  add(signAt, `Renovation deposit at signing (${dep}%)`, renoDue * dep / 100);
  add(keyAt, `Renovation start of works (${st}%)`, renoDue * st / 100);
  add(mi, `Renovation balance, furniture & appliances (${rest}%)`, renoDue * rest / 100);
  state.family.items.filter(i => i.include && i.date && i.date.slice(0, 7) <= mi).forEach(i => add(i.date.slice(0, 7), i.name || "Family cost", Math.max(0, i.cost - i.paid) * (1 + k)));
  ev.sort((a, b) => a.ym < b.ym ? -1 : a.ym > b.ym ? 1 : 0);
  const at = ym => ym <= now ? C.proj[0] : (C.proj.find(p => p.ym === ym) || C.proj[C.proj.length - 1]);
  const months = [...new Set(ev.map(e => e.ym))];
  let out = 0, low = {bal: C.cash, ym: now, t: 0}, need = 0, needPay = 0;
  const groups = months.map(ym => {
    const items = ev.filter(e => e.ym === ym), amt = sum(items, e => e.amt), p = at(ym);
    out += amt; const bal = p.cash - out;
    if(bal < low.bal) low = {bal, ym, t: p.t};
    if(bal < 0) needPay = Math.max(needPay, -bal / Math.max(1, p.t));
    return {ym, items, amt, saved: p.cash - C.cash, bal, t: p.t};
  });
  const pm = at(mi), final = pm.cash - out, target = C.target;
  need = needPay; if(final < target) need = Math.max(need, (target - final) / Math.max(1, pm.t));
  const state_ = low.bal < -0.5 ? "bad" : final < target - 0.5 ? "warn" : "good";
  return {keyYM, miYM: mi, signAt, now, groups, total: out, final, low, target, need, needPay, t: pm.t, state: state_, renoDue, past: mi < now, keyPast: keyYM && keyYM < now, nowMonth: pm.t === 0};
}
function moveInCard(R){
  const {C} = R, M = moveInPlan(R), L = state.loan, RS = state.reno;
  const keyLbl = M.keyYM ? fmtYM(M.keyYM) : "key collection";
  const inputs = `<div class="settings">
      <label for="o-key">Key collection date${fld("o-key", "loan.keyDate", L.keyDate, {type:"date", label:"Key collection date"})}</label>
      <label for="o-mi">Move-in month <span class="hint">(blank = key month)</span>${fld("o-mi", "moveIn", state.moveIn, {type:"month", label:"Move-in month"})}</label>
      <label for="o-sign">Sign with ID <span class="hint">(blank = key month)</span>${fld("o-sign", "reno.signYM", RS.signYM, {type:"month", label:"ID signing month"})}</label>
      <label for="o-dep">Deposit at signing (%)${fld("o-dep", "reno.depPct", RS.depPct, {label:"Deposit %"})}</label>
      <label for="o-st">At start of works (%)${fld("o-st", "reno.startPct", RS.startPct, {label:"Start of works %"})}</label>
    </div>`;
  if(M.missing) return `<div class="card"><header><h2>By move-in day</h2></header>${inputs}<p class="note">Enter your key collection date to see how much cash you'll have when each payment is due.</p></div>`;
  const warn = M.past ? `<div class="banner" style="background:var(--warn-soft);color:var(--warn)"><span>●</span><span>The move-in month saved here (${fmtYM(M.miYM)}) has already passed, so this section is paused. Enter your expected key collection date and move-in month above to see the plan.</span></div>` : "";
  if(M.past) return `<div class="card"><header><h2>By move-in day</h2><span class="hint">Change the dates and everything below recalculates</span></header>${inputs}${warn}</div>`;
  const sav = M.t > 0 ? C.surplusBefore : 0;
  let verdict;
  if(M.state === "good") verdict = `On move-in day we'll have <b>${money(M.final)}</b> left after paying everything due, with the ${money(M.target)} emergency fund intact.`;
  else if(M.state === "warn") verdict = `We can pay everything, but on move-in day only <b>${money(M.final)}</b> is left, ${money(M.target - M.final)} below our ${money(M.target)} emergency fund.`;
  else verdict = `We're <b>short ${money(-M.low.bal)}</b> in ${fmtYM(M.low.ym)}, when the payments then are due.`;
  if(M.state === "warn") verdict += M.t > 0 ? ` To keep the full emergency fund, save <b>${money(M.need)} more a month</b> until then.` : "";
  else if(M.state === "bad") verdict += M.t > 0 && M.low.t > 0 ? ` To cover the payments, save <b>${money(M.needPay)} more a month</b> (${money(C.surplusBefore + M.needPay)} a month in total) from now; ${money(M.need)} more a month also keeps the ${money(M.target)} emergency fund intact.` : ` That money is needed this month, so it can't come from monthly saving; push the payment later or cut the plan.`;
  const rows = M.groups.map(g => `<tr class="grp"><td><b>${fmtYM(g.ym)}</b>${g.saved > 0.5 ? ` <span class="hint">· saved ${money(g.saved, true)} by then</span>` : ""}</td><td class="r num">${money(-g.amt)}</td><td class="r num ${g.bal < 0 ? "neg" : ""}">${money(g.bal)}</td></tr>`
    + g.items.map(e => `<tr class="sub"><td>&nbsp;&nbsp;${esc(e.what)}${e.late ? ' <span class="chip warn">date passed</span>' : ""}</td><td class="r num">${money(e.amt)}</td><td></td></tr>`).join("")).join("");
  return `<div class="card">
    <header><h2>By move-in day</h2><span class="hint">Change the dates and everything below recalculates</span></header>
    ${inputs}
    ${warn}
    <div class="verdict ${M.state}" style="margin-top:14px">
      <div class="q">Cash on move-in day, ${fmtYM(M.miYM)}</div>
      <div class="a">${M.state === "bad" ? "Short before we move in" : money(M.final)}</div>
      <p>${verdict}</p>
      <p class="hint">${M.t} month${M.t === 1 ? "" : "s"} away. Starts from ${money(C.cash)} today, saving ${money(sav)} a month${M.t > 0 && C.surplusAfter !== C.surplusBefore ? ` (${money(C.surplusAfter)} after move-in)` : ""}. Renovation ${money(M.renoDue)} (incl. contingency) is paid ${RS.depPct || 0}% at signing, ${RS.startPct || 0}% at keys, the rest at move-in. Family costs dated before move-in are included.</p>
    </div>
    <div class="tablebox"><table><thead><tr><th>When</th><th class="r">Pay</th><th class="r">Cash left</th></tr></thead><tbody>
      <tr><td><b>Today</b> <span class="hint">· ${fmtYM(M.now)}</span></td><td></td><td class="r num">${money(C.cash)}</td></tr>
      ${rows}
      <tr class="total"><td>On move-in day <span class="hint">· ${fmtYM(M.miYM)}</span></td><td class="r num">${money(-M.total)}</td><td class="r num ${M.final < 0 ? "neg" : ""}">${money(M.final)}</td></tr>
    </tbody></table></div>
  </div>`;
}

function renderOverview(R){
  const {P, C} = R, A = P[0].p.name, B = P[1].p.name;
  const k = R.k, Q = R.loan;
  const stages = [
    {key:"housing", name:"Housing", due: (state.loan.keyDate && state.loan.keyDate.slice(0, 7) >= ymOf(new Date()) && Q.dpLeft) ? state.loan.keyDate.slice(0, 7) : "", cash: C.upCash + R.hCash * (1 + k), cpf: C.oaForUp + R.hCPF,
     lines: [
       Q.dpLeft ? `HDB downpayment still to pay ${money(Q.dpLeft)}` : "HDB downpayment fully paid",
       (Q.upfront - Q.dpLeft) > 0 ? `Stamp duty & legal fees ${money(Q.upfront - Q.dpLeft)}` : "",
       R.hCash + R.hCPF ? `Other housing costs ${money(R.hCash + R.hCPF)}` : "",
       (C.oaForUp + R.hCPF) ? `CPF OA pays ${money(C.oaForUp + R.hCPF)}, cash pays the rest` : ""]},
    {key:"reno", name:"Renovation", due: firstDue(activeReno()), cash: R.rRem + R.rEst * k, cpf: 0,
     lines: [R.rRem ? `Still to pay ${money(R.rRem)} + ${state.settings.contingencyPct}% contingency on the ${money(R.rEst)} not yet quoted` : "No renovation costs entered yet", "Cash only"]},
    {key:"family", name:"Family Planning", due: firstDue(state.family.items), cash: R.famNet + R.fRem * k, cpf: 0,
     lines: [R.fRem ? `Still to pay ${money(R.fRem)}${R.ang ? `, less ${money(Math.min(R.ang, R.fRem))} ang bao` : ""} + ${state.settings.contingencyPct}% contingency` : "No family costs entered yet"]},
    {key:"emergency", name:"Emergency fund", due: "", cash: C.target, cpf: 0,
     lines: [efDesc(C)]},
  ];
  let run = C.cash, cum = 0;
  stages.forEach(st => {
    cum += st.cash; st.cum = cum;
    const hit = C.proj.find(p => p.cash >= cum - 0.5);
    st.ready = hit ? hit.ym : null; st.readyT = hit ? hit.t : null;
    st.late = st.due && st.cash > 0 && (!st.ready || st.ready > st.due);
    st.before = run; run -= st.cash; st.after = run;
    st.covered = Math.max(0, Math.min(st.before, st.cash));
    st.short = st.cash - st.covered;
    st.state = st.cash <= 0 ? "none" : st.short <= 0.5 ? "good" : st.covered > 0 ? "warn" : "bad";

  });
  const firstFail = stages.find(st => st.state === "warn" || st.state === "bad");
  const okNames = stages.filter(st => st.state === "good" && st.key).map(st => st.name);
  const listJoin = a => a.length < 2 ? a.join("") : a.slice(0, -1).join(", ") + " and " + a[a.length - 1];
  const vClass = !firstFail ? "good" : firstFail.key === "housing" ? "bad" : "warn";
  const headline = !firstFail ? "Enough for every step" : (okNames.length ? `Enough for ${listJoin(okNames)}` : `Not enough for ${firstFail.name} yet`);
  let vText = !firstFail ? `Our savings cover Housing, Renovation and Family Planning, and still leave a full emergency fund with ${money(run)} to spare.`
    : (okNames.length ? `We can pay for ${listJoin(okNames)}. ` : "") + `${firstFail.name} is short by ${money(firstFail.short)}.`;
  if(firstFail){
    if(firstFail.ready) vText += ` Saving ${money(C.nowAfter ? C.surplusAfter : C.surplusBefore)} a month${!C.nowAfter && C.surplusAfter !== C.surplusBefore ? ` (${money(C.surplusAfter)} after we move in)` : ""}, we'll have enough for it by <b>${fmtYM(firstFail.ready)}</b>.`;
    else vText += ` At our current saving rate we won't get there within 10 years.`;
    if(firstFail.late) vText += ` That's later than when it's needed (${fmtYM(firstFail.due)}).`;
  }
  const lateOther = stages.filter(st => st.late && st !== firstFail).map(st => st.name);
  if(lateOther.length) vText += ` ${listJoin(lateOther)} may not be ready in time either.`;
  if(state.monthly.length === 0) vText += ` <b>No monthly expenses entered yet</b>, so these dates are too optimistic. Add them on the Monthly tab.`;
  const warnText = P.filter(x => x.oaDrain && x.instOA > 0).map(x => `${esc(x.p.name)}'s HDB instalment from CPF OA (${money(x.instOA)}/mo) is more than their monthly OA contribution, so their OA will run down. `).join("")
    + (R.loan.msr > 0.3 ? `The HDB instalment is ${Math.round(R.loan.msr * 100)}% of our gross income, above the 30% limit (MSR). ` : "")
    + (P.some(x => x.status === "bad") && P.some(x => x.status !== "bad") ? `One of us can't cover their own share; consider changing the split in Settings.` : "");
  const stLabel = st => st.state === "none" ? `<span class="chip">${st.key === "emergency" ? "No target set" : "Nothing planned"}</span>` : st.state === "good" ? '<span class="chip good">Enough</span>' : st.state === "warn" ? `<span class="chip warn">Short ${money(st.short)}</span>` : `<span class="chip bad">Short ${money(st.short)}</span>`;
  const ladder = stages.map((st, n) => `<li class="stage ${st.state}">
      <div class="step">${n + 1}</div>
      <div class="sbody">
        <div class="stitle"><h2>${st.name}</h2>${st.key ? `<a href="${FILES[st.key]}" data-go="${st.key}" class="hint">Edit</a>` : ""}</div>
        <div class="hint">${st.lines.filter(Boolean).join(" · ")}</div>
        <div class="prog ${st.state === "good" ? "" : "f"}" style="height:6px;margin-top:10px"><span style="width:${st.cash > 0 ? st.covered / st.cash * 100 : 100}%;${st.state === "none" ? "background:var(--line)" : st.state === "good" ? "background:var(--good)" : "background:var(--bad)"}"></span></div>
      </div>
      <dl class="sfig">
        <div><dt>Cash available</dt><dd class="num">${money(Math.max(0, st.before))}</dd></div>
        <div><dt>Cash needed</dt><dd class="num">${money(st.cash)}</dd></div>
        <div><dt>Left after</dt><dd class="num ${st.after < 0 ? "neg" : ""}">${money(st.after)}</dd></div>
      </dl>
      <div class="sstat">${stLabel(st)}${st.short > 0.5 ? `<div class="hint">${st.ready ? "Ready by " + fmtYM(st.ready) : "Not within 10 yrs"}</div>` : ""}${st.due ? `<div class="hint ${st.late ? "neg" : ""}">${st.late ? "Needed by" : "Due"} ${fmtYM(st.due)}</div>` : ""}</div>
    </li>`).join("");

  const rows = [
    ["Cash savings", x => x.p.cash],
    ["CPF total (est. today)", x => x.cpf],
    ["Cash needed for plans", x => x.myNeed],
    ["CPF OA used for housing", x => x.myCPF],
    ["Cash left after plans", x => x.after, null, true],
    ["Monthly take-home + other", x => x.income],
    ["Monthly expenses (now)", x => x.monthlyExp],
    ["Monthly saving (now)", x => x.surplus, null, true, true],
  ];
  const cell = (v, colored) => `<td class="r num ${colored ? (v < 0 ? "neg" : v > 0 ? "pos" : "") : ""}">${money(v)}</td>`;
  const ptable = rows.map(([l, f, subf, bold, colored]) => `<tr${bold ? ' style="font-weight:600"' : ""}><td>${l}${subf ? ` <span class="hint">(${subf(P[0])} / ${subf(P[1])})</span>` : ""}</td>${cell(f(P[0]), colored)}${cell(f(P[1]), colored)}${cell(f(P[0]) + f(P[1]), colored)}</tr>`).join("")
;

  const H = state.housing.items, F = state.family.items;
  const t = (arr, f) => sum(arr.filter(i => i.include), f);
  const exp = [
    ["HDB downpayment, stamp duty & legal fees", R.loan.upfrontFull, R.loan.upfrontPaid],
    ["Other housing costs", t(H, i => i.cost), t(H, i => i.paid)],
    ["Renovation (" + PLANS[activePlan()] + ")", t(activeReno(), effCost), t(activeReno(), i => i.paid)],
    ["Family planning", t(F, i => i.cost), t(F, i => i.paid)],
  ];
  const expRows = exp.map((e, n) => `<tr><td>${e[0]}</td><td class="r num">${money(e[1])}</td><td class="r num">${money(e[2])}</td><td class="r num">${money(Math.max(0, e[1] - e[2]))}</td></tr>`
    + (n === 0 && R.loan.upfront ? `<tr class="sub"><td>&nbsp;&nbsp;from CPF OA ${money(C.oaForUp)} · in cash ${money(C.upCash)}</td><td></td><td></td><td></td></tr>` : "")).join("")
    + `<tr class="sub"><td>Contingency (${state.settings.contingencyPct}% of cash items still to pay)</td><td></td><td></td><td class="r num">${money(R.cont)}</td></tr>`
    + (R.ang ? `<tr class="sub"><td>Less expected ang bao</td><td></td><td></td><td class="r num">${money(-Math.min(R.ang, R.fRem))}</td></tr>` : "")
    + `<tr class="total"><td>Total</td><td class="r num">${money(R.planned)}</td><td class="r num">${money(R.paid)}</td><td class="r num">${money(R.cashNeed + R.cpfNeed)}</td></tr>`;



  return `<section class="panel" role="tabpanel" aria-labelledby="tab-overview">
  ${exBanner()}
  <div class="verdict ${vClass}">
    <div class="q">Can we afford it, step by step?</div>
    <div class="a">${headline}</div>
    <p>${vText}</p>
    <p class="hint">Starts from our cash savings today (${money(C.cash)}) and pays for each step in order. CPF OA goes to housing first.</p>
  </div>
  <ol class="stages">${ladder}</ol>
  ${moveInCard(R)}
  ${warnText ? `<div class="banner" style="background:var(--warn-soft);color:var(--warn)"><span>●</span><span>${warnText}</span></div>` : ""}
  <div class="kpis">
    <div class="kpi"><span class="l">Cash savings</span><span class="v">${money(C.cash)}</span><span class="s">${esc(A)} ${money(P[0].p.cash)} · ${esc(B)} ${money(P[1].p.cash)}</span></div>
    <div class="kpi"><span class="l">CPF, estimated today</span><span class="v">${money(C.cpf)}</span><span class="s">OA ${money(C.estOA)} · after housing ${money(C.oaAfter)}</span></div>
    <div class="kpi"><span class="l">All plans still to pay</span><span class="v">${money(R.cashNeed + R.cpfNeed)}</span><span class="s">${money(R.cashNeed)} cash · ${money(R.cpfNeed)} CPF OA</span></div>
    <div class="kpi"><span class="l">Saving per month</span><span class="v ${C.surplus < 0 ? "neg" : ""}">${money(C.surplus, true)}</span><span class="s">${!C.nowAfter ? `${money(C.surplusAfter, true)} after we move in · ` : ""}<a href="monthly.html" data-go="monthly">expenses</a></span></div>
  </div>
  ${timelineCard(stages, C)}
  <div class="card">
    <header><h2>Each of us</h2><span class="hint">Costs split ${state.settings.splitA}/${100 - state.settings.splitA}; change it in Settings</span></header>
    <div class="tablebox"><table><thead><tr><th></th><th class="r">${esc(A)}</th><th class="r">${esc(B)}</th><th class="r">Combined</th></tr></thead><tbody>${ptable}</tbody></table></div>
  </div>
  <div class="card">
    <header><h2>Total planned expenses</h2><span class="hint">One-off costs from Housing, Renovation and Family Planning</span></header>
    <div class="tablebox"><table><thead><tr><th></th><th class="r">Planned</th><th class="r">Paid</th><th class="r">Still to pay</th></tr></thead><tbody>${expRows}</tbody></table></div>
  </div>
  <div class="card">
    <header><h2>Settings</h2></header>
    <div class="settings">
      <label for="s-split">${esc(A)} pays this % of planned spending${fld("s-split", "settings.splitA", state.settings.splitA, {label:"Split"})}</label>
      <label for="s-ct">Contingency on cash spending (%)${fld("s-ct", "settings.contingencyPct", state.settings.contingencyPct, {label:"Contingency"})}</label>
      <label for="s-cl">CPF monthly wage ceiling (S$)${fld("s-cl", "settings.ceiling", state.settings.ceiling, {label:"Ceiling"})}</label>
    </div>
    <p class="note">Monthly expenses are on the Monthly tab; the emergency fund on its own tab.</p>
  </div>
</section>`;
}

function itemTable(list, kind){
  const items = state[kind].items, fam = kind !== "housing";
  const rows = items.map(it => {
    const pct = it.cost > 0 ? Math.min(100, it.paid / it.cost * 100) : 0, p = kind[0] + "-" + it.id;
    return `<tr>
      <td class="c-inc"><input type="checkbox" id="${p}-inc" data-b="${kind}.items.#${it.id}.include" data-t="b" ${it.include ? "checked" : ""} aria-label="Include ${esc(it.name)}"></td>
      <td class="namecell c-name">${fld(p + "-name", kind + ".items.#" + it.id + ".name", it.name, {type:"text", label:"Item"})}<div class="prog ${fam ? "f" : ""}"><span style="width:${pct}%"></span></div></td>
      ${fam ? `<td class="c-when" data-label="Target month" style="min-width:150px">${fld(p + "-date", kind + ".items.#" + it.id + ".date", it.date, {type:"month", label:"Month"})}</td>`
            : `<td class="c-when" data-label="Paid from" style="min-width:110px">${sel(p + "-src", "housing.items.#" + it.id + ".source", it.source || "Cash", ["Cash","CPF OA"], "Paid from")}</td>`}
      <td class="c-cost" data-label="Planned (S$)" style="min-width:110px">${fld(p + "-cost", kind + ".items.#" + it.id + ".cost", it.cost, {label:"Planned"})}</td>
      <td class="c-paid" data-label="Paid (S$)" style="min-width:110px">${fld(p + "-paid", kind + ".items.#" + it.id + ".paid", it.paid, {label:"Paid"})}</td>
      <td class="c-note" data-label="Note" style="min-width:180px">${fld(p + "-note", kind + ".items.#" + it.id + ".note", it.note, {type:"text", label:"Note"})}</td>
      <td class="c-ex">${it.ex ? `<button class="chip ex" data-act="keep" data-list="${kind}.items" data-id="${it.id}" title="Keep this value as ours">Example · keep</button>` : ""}</td>
      <td class="c-del"><button class="x" data-act="del" data-list="${kind}.items" data-id="${it.id}" aria-label="Remove ${esc(it.name)}">×</button></td></tr>`;
  }).join("");
  const inc = items.filter(i => i.include);
  return `<div class="tablebox"><table class="items"><thead><tr><th title="Include in totals">Incl.</th><th>Item</th><th>${fam ? "Target month" : "Paid from"}</th><th class="r">Planned (S$)</th><th class="r">Paid (S$)</th><th>Note</th><th></th><th></th></tr></thead>
  <tbody>${rows || `<tr class="empty"><td colspan="8" class="hint" style="padding:18px 6px">No items yet. Add the first one below.</td></tr>`}
  <tr class="total"><td class="c-inc"></td><td class="c-name">Included items</td><td class="c-when"></td><td class="r num c-cost" data-label="Planned">${money(sum(inc, i => i.cost))}</td><td class="r num c-paid" data-label="Paid">${money(sum(inc, i => i.paid))}</td><td class="hint c-note">${money(sum(inc, i => Math.max(0, i.cost - i.paid)))} still to pay</td><td class="c-ex"></td><td class="c-del"></td></tr></tbody></table></div>
  <div style="margin-top:12px"><button class="btn" data-act="add" data-list="${kind}.items">+ Add item</button></div>`;
}

function renderHousing(R){
  const cards = R.P.map((x, i) => { const p = x.p, b = "people." + i + ".", id = "p" + i + "-";
    return `<div class="card">
      <header><div class="pname">${fld(id + "name", b + "name", p.name, {type:"text", label:"Name"})}</div>${p.ex ? `<button class="chip ex" data-act="keep" data-owner="people.${i}">Example · keep</button>` : ""}</header>
      <div class="form">
        <h3 class="sep" style="border:0;margin:0;padding:0">Income</h3>
        <label for="${id}sal">Monthly gross salary</label>${fld(id + "sal", b + "salary", p.salary, {label:"Salary"})}
        <label for="${id}age">Age band</label>${sel(id + "age", b + "age", p.age, AGES, "Age band")}
        <label for="${id}oth">Other monthly income</label>${fld(id + "oth", b + "other", p.other, {label:"Other income"})}
        <label>Employee CPF (deducted)</label><div class="out num">${money(x.emp)}</div>
        <label>Employer CPF (on top)</label><div class="out num">${money(x.er)}</div>
        <label><b>Take-home pay</b></label><div class="out num"><b>${money(x.takeHome)}</b></div>
        <h3 class="sep">Savings and CPF balances</h3>
        <label for="${id}cash">Cash savings (bank, FD, T-bills)</label>${fld(id + "cash", b + "cash", p.cash, {label:"Cash"})}
        <label for="${id}oa">CPF Ordinary Account</label>${fld(id + "oa", b + "oa", p.oa, {label:"OA"})}
        <label for="${id}sa">CPF Special Account</label>${fld(id + "sa", b + "sa", p.sa, {label:"SA"})}
        <label for="${id}ma">CPF MediSave</label>${fld(id + "ma", b + "ma", p.ma, {label:"MA"})}
        <label for="${id}asof">CPF balances as of</label>${fld(id + "asof", b + "asOf", p.asOf, {type:"date", label:"As of"})}
        <h3 class="sep">CPF estimated today <span class="hint" style="text-transform:none;letter-spacing:0;font-weight:400">· ${x.m} month${x.m === 1 ? "" : "s"} of contributions added</span></h3>
        <label>Ordinary Account <span class="hint">(+${money(x.oaM)}${x.instOA && state.loan.keyDate ? ` − ${money(x.instOA)} HDB` : ""} /mo)</span></label><div class="out num">${money(x.estOA)}</div>
        <label>Special Account <span class="hint">(+${money(x.saM)} /mo)</span></label><div class="out num">${money(x.estSA)}</div>
        <label>MediSave <span class="hint">(+${money(x.maM)} /mo)</span></label><div class="out num">${money(x.estMA)}</div>
        <label><b>Total CPF</b></label><div class="out num"><b>${money(x.cpf)}</b></div>
      </div></div>`; }).join("");
  const L = state.loan, Q = R.loan, A = R.P[0].p.name, B = R.P[1].p.name;
  const out = (l, v, bold, cls) => `<label>${bold ? "<b>" + l + "</b>" : l}</label><div class="out num ${cls || ""}">${bold ? "<b>" + v + "</b>" : v}</div>`;
  const warns = [];
  if(L.type === "HDB loan" && L.ltv > 75) warns.push("HDB loans are capped at 75% LTV.");
  if(L.years > 25 && L.ltv > 55) warns.push("Tenures above 25 years need LTV of 55% or less.");
  if(L.type === "HDB loan" && Q.gross > 14000) warns.push("Combined income is above the S$14,000 ceiling for an HDB loan.");
  if(Q.msr > 0.3) warns.push("Instalment is above 30% of gross income (MSR).");
  const loanCard = `<div class="card">
    <header><h2>HDB loan</h2>${L.ex ? `<button class="chip ex" data-act="keep" data-owner="loan">Example · keep</button>` : ""}</header>
    <div class="two">
      <div class="form" style="align-content:start">
        <h3 class="sep" style="border:0;margin:0;padding:0">The flat</h3>
        <label for="l-price">Flat price (S$)</label>${fld("l-price", "loan.price", L.price, {label:"Flat price"})}
        <label for="l-grants">CPF housing grants (S$)</label>${fld("l-grants", "loan.grants", L.grants, {label:"Grants"})}
        <label for="l-legal">Legal &amp; conveyancing fees (S$)</label>${fld("l-legal", "loan.legal", L.legal, {label:"Legal fees"})}
        <h3 class="sep">Already paid</h3>
        <label for="l-dpp">Downpayment paid (% of price)</label>${fld("l-dpp", "loan.dpPaidPct", L.dpPaidPct, {label:"Downpayment paid %"})}
        <label for="l-sp">Stamp duty already paid</label><div class="out"><input type="checkbox" id="l-sp" data-b="loan.stampPaid" data-t="b" ${L.stampPaid ? "checked" : ""}></div>
        <label for="l-lp">Legal fees already paid</label><div class="out"><input type="checkbox" id="l-lp" data-b="loan.legalPaid" data-t="b" ${L.legalPaid ? "checked" : ""}></div>
        <label for="l-key">Key collection / first instalment</label>${fld("l-key", "loan.keyDate", L.keyDate, {type:"date", label:"Key date"})}
        <h3 class="sep">The loan</h3>
        <label for="l-type">Loan type</label>${sel("l-type", "loan.type", L.type, ["HDB loan","Bank loan"], "Loan type")}
        <label for="l-ltv">Loan-to-value (%)</label>${fld("l-ltv", "loan.ltv", L.ltv, {label:"LTV"})}
        <label for="l-rate">Interest rate (% a year)</label>${fld("l-rate", "loan.rate", L.rate, {label:"Interest rate"})}
        <label for="l-yrs">Tenure (years)</label>${fld("l-yrs", "loan.years", L.years, {label:"Tenure"})}
        <h3 class="sep">Who pays the instalment</h3>
        <label for="l-split">${esc(A)} pays (%)</label>${fld("l-split", "loan.splitA", L.splitA, {label:"Loan split"})}
        <label for="l-oaa">${esc(A)}: % of share from CPF OA</label>${fld("l-oaa", "loan.oaPctA", L.oaPctA, {label:"From OA"})}
        <label for="l-oab">${esc(B)}: % of share from CPF OA</label>${fld("l-oab", "loan.oaPctB", L.oaPctB, {label:"From OA"})}
      </div>
      <div class="form" style="align-content:start">
        <h3 class="sep" style="border:0;margin:0;padding:0">Upfront</h3>
        ${out("Loan amount (" + L.ltv + "% LTV)", money(Q.loanAmt), true)}
        ${out("Downpayment (" + (100 - L.ltv) + "%)", money(Q.dp))}
        ${L.grants ? out("Less grants", money(-Math.min(L.grants, Q.dp))) : ""}
        ${out("Downpayment after grants", money(Q.dpNet))}
        ${Q.dpPaid ? out("Already paid (" + L.dpPaidPct + "%)", money(-Q.dpPaid), false, "pos") : ""}
        ${out("Downpayment still to pay", money(Q.dpLeft), true)}
        ${L.type === "Bank loan" ? out("of which in cash (min 5%)", money(Q.minCash)) : ""}
        ${out("Buyer's stamp duty" + (L.stampPaid ? " (paid)" : ""), L.stampPaid ? money(0) : money(Q.stamp))}
        ${out("Legal fees" + (L.legalPaid ? " (paid)" : ""), L.legalPaid ? money(0) : money(L.legal))}
        ${out("Upfront still to pay", money(Q.upfront), true)}
        ${out("Paid from CPF OA", money(R.C.oaForUp), false, "")}
        ${out("Paid in cash", money(R.C.upCash), false, R.C.upCash > 0 ? "neg" : "")}
        <h3 class="sep">Monthly</h3>
        ${out("Monthly instalment", money(Q.inst), true)}
        ${out(esc(A) + " pays", money(R.P[0].instShare) + ` <span class="hint">(${money(R.P[0].instOA)} OA)</span>`)}
        ${out(esc(B) + " pays", money(R.P[1].instShare) + ` <span class="hint">(${money(R.P[1].instOA)} OA)</span>`)}
        <label>Share of gross income (MSR, max 30%)</label><div class="out"><span class="chip ${Q.msr > 0.3 ? "bad" : Q.msr > 0.25 ? "warn" : "good"}">${(Q.msr * 100).toFixed(1)}%</span></div>
        ${out("Total interest over " + L.years + " years", money(Q.totalInterest))}
      </div>
    </div>
    ${warns.length ? `<div class="banner" style="margin-top:14px;background:var(--warn-soft);color:var(--warn)"><span>●</span><span>${warns.join(" ")}</span></div>` : ""}
    <p class="note">HDB loan: up to 75% LTV at 2.6% a year, up to 25 years, and the 25% downpayment can come entirely from CPF OA. Bank loan: also 75% LTV, but at least 5% of the price must be paid in cash. Upfront costs are paid from CPF OA first, then cash for anything OA can't cover. Grants are deducted from the downpayment. Anything marked as already paid is left out, because your savings and CPF balances already reflect it. Check your actual figures in your HDB Flat Eligibility letter and on hdb.gov.sg.</p>
  </div>`;
  const C = R.C;
  return `<section class="panel" role="tabpanel" aria-labelledby="tab-housing">
  ${exBanner()}
  <div class="kpis">
    <div class="kpi"><span class="l">HDB loan</span><span class="v">${money(Q.loanAmt)}</span><span class="s">${L.ltv}% of ${money(Q.price)}</span></div>
    <div class="kpi"><span class="l">Monthly instalment</span><span class="v">${money(Q.inst)}</span><span class="s">${L.rate}% over ${L.years} years</span></div>
    <div class="kpi"><span class="l">Upfront still to pay</span><span class="v">${money(Q.upfront)}</span><span class="s">${money(C.oaForUp)} CPF OA · ${money(C.upCash)} cash</span></div>
    <div class="kpi"><span class="l">CPF OA left after upfront</span><span class="v ${C.oaAfter < 0 ? "neg" : ""}">${money(C.oaAfter)}</span><span class="s">Estimated OA today ${money(C.estOA)}</span></div>
  </div>
  ${loanCard}
  <div class="people">${cards}</div>
  <div class="card">
    <header><h2>Other housing costs</h2><span class="hint">Renovation and appliances are left out for now</span></header>
    ${itemTable(state.housing.items, "housing")}
    <p class="note">For one-off costs not covered above, such as fire insurance or admin fees. Mark each as paid in cash or from CPF OA.</p>
  </div>
  <p class="note">CPF estimates add each month's contributions since your "as of" date, and take off HDB instalments paid from OA once the key collection date has passed. Interest, bonuses and top-ups are not included, so update the balances from the CPF app from time to time. Rates are for employees aged 55 and below.</p>
</section>`;
}

const RGROUPS = ["ACE: design & preparation","ACE: carpentry & tops","ACE: glass, doors & finishing","Not in ACE quote: works & fittings","Works & services","Kitchen & dining","Living & entrance","Bedrooms","Bathrooms & service yard","Aircon & appliances","Furniture & décor","Possible extras","Other"];
const planOf = it => it.plan || "ours";
const activePlan = () => state.reno.active || "ours";
const activeReno = () => state.reno.items.filter(i => planOf(i) === activePlan());
const PLANS = {ours: "Our list", ace: "ACE proposal"};
let renoView = null;
const effCost = it => (+it.quote > 0 ? +it.quote : +it.cost || 0);
function firstDue(items){ const d = items.filter(i => i.include && i.date && i.cost > i.paid).map(i => i.date).sort()[0]; return d || ""; }
function efDesc(C){
  const S = state.settings;
  const base = S.emergencyMode === "fixed" ? `Fixed target ${money(S.emergencyFixed)}` : `${S.emergencyMonths} months of expenses (${money(C.expAfter)}/mo)`;
  return base + (S.emergencySetAside ? `, less ${money(S.emergencySetAside)} already set aside` : "");
}
function renderMonthly(R){
  const {P, C} = R, mi = moveInYM(), now = C.nowAfter;
  const personCard = i => {
    const x = P[i], name = x.p.name, mine = state.monthly.filter(m => m.owner === i);
    const row = m => `<tr>
      <td class="namecell c-name">${fld("m-" + m.id + "-name", "monthly.#" + m.id + ".name", m.name, {type:"text", label:"Expense"})}${m.ex ? ` <button class="chip ex" data-act="keep" data-list="monthly" data-id="${m.id}">Example · keep</button>` : ""}</td>
      <td class="c-amt" data-label="Amount (S$)" style="min-width:100px">${fld("m-" + m.id + "-amt", "monthly.#" + m.id + ".amt", m.amt, {label:"Amount"})}</td>
      <td class="c-freq" data-label="How often" style="min-width:104px">${sel("m-" + m.id + "-f", "monthly.#" + m.id + ".freq", m.freq, FREQ, "How often")}</td>
      <td class="c-when" data-label="When" style="min-width:150px">${sel("m-" + m.id + "-w", "monthly.#" + m.id + ".when", m.when, WHEN, "When")}</td>
      <td class="r num c-sum" data-label="Per month">${money(perMonth(m))}</td>
      <td class="c-del"><button class="x" data-act="del" data-list="monthly" data-id="${m.id}" aria-label="Remove ${esc(m.name)}">×</button></td></tr>`;
    const groups = CATS.map(cat => {
      const items = mine.filter(m => (CATS.includes(m.cat) ? m.cat : "Other") === cat);
      const hdb = cat === "Home" ? x.hdbCash : 0;
      const tNow = sum(items.filter(m => applies(m, now)), perMonth) + (now ? hdb : 0), tAft = sum(items.filter(m => applies(m, true)), perMonth) + hdb;
      const key = i + ":" + cat, open = openCats.has(key);
      if(!items.length && !hdb && !open && cat !== "Other") return `<tr class="cat empty-cat"><td colspan="6"><button class="cattog" data-act="cat" data-owner="${i}" data-cat="${cat}" aria-expanded="false"><span class="caret">▸</span><span class="catname">${cat}</span><span class="hint">nothing yet</span></button></td></tr>`;
      const hdbRow = hdb ? `<tr class="sub"><td class="c-name">HDB instalment, cash part <span class="hint">(Housing tab)</span></td><td class="r num c-amt" data-label="Amount">${money(hdb)}</td><td class="c-freq hint">Monthly</td><td class="c-when hint">After we move in</td><td class="r num c-sum">${money(hdb)}</td><td class="c-del"></td></tr>` : "";
      return `<tr class="cat"><td colspan="6"><button class="cattog" data-act="cat" data-owner="${i}" data-cat="${cat}" aria-expanded="${open}"><span class="caret">${open ? "▾" : "▸"}</span><span class="catname">${cat}</span><span class="hint num">${money(tNow)}/mo${!now && tAft !== tNow ? ` → ${money(tAft)} after move-in` : ""}</span></button></td></tr>${open ? items.map(row).join("") + hdbRow + `<tr class="addrow"><td colspan="6"><button class="linkbtn" data-act="add" data-list="monthly" data-owner="${i}" data-cat="${cat}">+ Add to ${cat}</button></td></tr>` : ""}`;
    }).join("");
    return `<div class="card">
      <header><h2>${esc(name)}'s expenses</h2><span class="hint num">${money(x.monthlyExp)}/mo now${!now ? ` · ${money(x.expAfter)} after move-in` : ""}</span></header>
      <div class="tablebox"><table class="items monthly3"><thead><tr><th>Expense</th><th class="r">Amount (S$)</th><th>How often</th><th>When</th><th class="r">Per month</th><th></th></tr></thead>
      <tbody>${groups}
      <tr class="total"><td class="c-name">${esc(name)}'s total ${now ? "per month" : "until move-in"}</td><td class="c-amt"></td><td class="c-freq"></td><td class="c-when"></td><td class="r num c-sum" data-label="Per month">${money(x.monthlyExp)}</td><td class="c-del"></td></tr>
      </tbody></table></div>
    </div>`;
  };
  // combined summary by category
  const catRow = (cat, after) => { const f = i => sum(state.monthly.filter(m => m.owner === i && (CATS.includes(m.cat) ? m.cat : "Other") === cat && applies(m, after)), perMonth) + (cat === "Home" && after ? P[i].hdbCash : 0); return [f(0), f(1)]; };
  const sumRows = CATS.map(cat => { const [a, b] = catRow(cat, now); const [a2, b2] = catRow(cat, true); return (a + b + a2 + b2) ? `<tr><td>${cat}</td><td class="r num">${money(a)}</td><td class="r num">${money(b)}</td><td class="r num">${money(a + b)}</td></tr>` : ""; }).join("");
  const A = P[0].p.name, B = P[1].p.name;
  const line = (l, a, b, cls) => `<tr class="${cls || ""}"><td>${l}</td><td class="r num">${money(a)}</td><td class="r num">${money(b)}</td><td class="r num">${money(a + b)}</td></tr>`;
  const phaseNote = !mi ? `Set a move-in month so costs that start or stop when you move in are timed correctly. Until then, we assume you've already moved in.`
    : now ? `From ${fmtYM(mi)} you're living in the new flat, so "After we move in" costs apply now.` : `Until ${fmtYM(mi)}: "Always" + "Until we move in" costs. From then on: "Always" + "After we move in" costs.`;
  return `<section class="panel" role="tabpanel" aria-labelledby="tab-monthly">
  ${exBanner()}
  <div class="card">
    <header><h2>When do we move in?</h2></header>
    <div class="form" style="max-width:560px">
      <label for="m-movein">Move-in month</label>${fld("m-movein", "moveIn", state.moveIn, {type:"month", label:"Move-in month"})}
    </div>
    <p class="note">${phaseNote} ${!state.moveIn && state.loan.keyDate ? `Using your key collection date (${fmtYM(state.loan.keyDate.slice(0, 7))}) from the Housing tab.` : ""}</p>
  </div>
  ${personCard(0)}
  ${personCard(1)}
  <div class="card">
    <header><h2>Together</h2><span class="hint">Per month${now ? "" : ", until we move in"}</span></header>
    <div class="tablebox"><table><thead><tr><th></th><th class="r">${esc(A)}</th><th class="r">${esc(B)}</th><th class="r">Combined</th></tr></thead>
    <tbody>${sumRows || `<tr><td colspan="4" class="hint">No expenses yet.</td></tr>`}
      ${line("Total expenses" + (now ? "" : " until move-in"), P[0].monthlyExp, P[1].monthlyExp, "total")}
      ${now ? "" : line("Total expenses after move-in", P[0].expAfter, P[1].expAfter, "sub")}
      ${line("Take-home pay", P[0].income, P[1].income)}
      ${line("We save per month", P[0].surplus, P[1].surplus, "total")}
      ${now ? "" : line("We save per month after move-in", P[0].surplusAfter, P[1].surplusAfter, "sub")}
    </tbody></table></div>
    <p class="note">For shared bills like S&amp;CC or utilities, each of you enters your own share. Yearly costs (insurance, holidays, ang bao) are spread over 12 months. One-off big costs belong in their own tabs.</p>
  </div>
</section>`;
}

function timelineCard(stages, C){
  const steps = stages.filter(st => st.cash > 0);
  if(!steps.length) return "";
  const lastReady = Math.max(...steps.map(st => st.readyT == null ? 36 : st.readyT));
  const H = Math.min(60, Math.max(12, lastReady + 4));
  const pts = C.proj.slice(0, H + 1);
  const W = Math.max(300, Math.min(1000, (app.clientWidth || 700) - 40)), Ht = 240, ml = 64, mr = 16, mt = 14, mb = 30;
  const ymax = Math.max(...pts.map(p => p.cash), steps[steps.length - 1].cum, 1) * 1.08;
  const ymin = Math.min(0, ...pts.map(p => p.cash));
  const x = t => ml + (W - ml - mr) * t / H, y = v => mt + (Ht - mt - mb) * (1 - (v - ymin) / (ymax - ymin));
  const path = pts.map((p, i) => (i ? "L" : "M") + x(p.t).toFixed(1) + " " + y(p.cash).toFixed(1)).join(" ");
  const nice = v => { const e = Math.pow(10, Math.floor(Math.log10(v))); const f = v / e; return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * e; };
  const step = nice((ymax - ymin) / 4); const ticks = []; for(let v = Math.ceil(ymin / step) * step; v <= ymax; v += step) ticks.push(v);
  const kfmt = v => v === 0 ? "0" : (Math.abs(v) >= 1e6 ? (v / 1e6).toFixed(1) + "M" : Math.round(v / 1000) + "k");
  const xev = H <= 18 ? 3 : H <= 36 ? 6 : 12;
  const xt = pts.filter(p => p.t % xev === 0);
  const mi = moveInYM(), miP = pts.find(p => p.ym === mi && p.t > 0);
  const labels = ["Housing", "+ Renovation", "+ Family", "+ Emergency fund"];
  let lastLy = Infinity;
  const thr = steps.map(st => { const yy = y(st.cum); const r = st.readyT != null && st.readyT <= H ? pts[st.readyT] : null;
    let ly = Math.min(yy - 5, lastLy - 13); lastLy = ly;
    return `<line x1="${ml}" x2="${W - mr}" y1="${yy}" y2="${yy}" class="thr"/><text x="${ml + 6}" y="${ly}" class="tl2">${labels[stages.indexOf(st)]} ${money(st.cum)}</text>`
      + (r ? `<circle cx="${x(r.t)}" cy="${y(r.cash)}" r="5" class="rdot"/>` : ""); }).join("");
  return `<div class="card">
    <header><h2>When will we have enough?</h2><span class="hint">Projected cash if we keep saving, before spending on any step</span></header>
    <div class="chartwrap" id="tlchart" data-h="${H}" data-ml="${ml}" data-w="${W}" data-mr="${mr}">
    <svg width="${W}" height="${Ht}" viewBox="0 0 ${W} ${Ht}" role="img" aria-label="Projected cash savings over the next ${H} months">
      ${ticks.map(v => `<line x1="${ml}" x2="${W - mr}" y1="${y(v)}" y2="${y(v)}" class="grid"/><text x="${ml - 8}" y="${y(v) + 4}" text-anchor="end" class="ax">S$${kfmt(v)}</text>`).join("")}
      ${xt.map(p => `<text x="${x(p.t)}" y="${Ht - 8}" text-anchor="middle" class="ax">${fmtYM(p.ym).replace(/ (\d\d)(\d\d)$/, " ’$2")}</text>`).join("")}
      ${miP ? `<line x1="${x(miP.t)}" x2="${x(miP.t)}" y1="${mt}" y2="${Ht - mb}" class="mv"/><text x="${x(miP.t) + 4}" y="${mt + 10}" class="ax">Move in</text>` : ""}
      ${thr}
      <path d="${path}" class="pline"/>
      <line class="hov" x1="0" x2="0" y1="${mt}" y2="${Ht - mb}" visibility="hidden"/>
    </svg>
    <div class="tip" hidden></div>
    </div>
    <p class="note">Where the line crosses a dashed level, we have enough for that step and every step before it. Assumes today's pay and the expenses on the Monthly tab, with no interest, bonuses or pay rises.</p>
  </div>`;
}

function renderEmergency(R){
  const {P, C} = R, S = state.settings, A = P[0].p.name, B = P[1].p.name;
  const months = C.expAfter > 0 ? C.efGross / C.expAfter : 0;
  const mRows = state.monthly.map(m => `<tr><td class="namecell c-name">${fld("m-" + m.id + "-name", "monthly.#" + m.id + ".name", m.name, {type:"text", label:"Expense"})}${m.ex ? ` <button class="chip ex" data-act="keep" data-list="monthly" data-id="${m.id}">Example · keep</button>` : ""}</td>
    <td class="c-a" data-label="${esc(A)}">${fld("m-" + m.id + "-a", "monthly.#" + m.id + ".a", m.a, {label:A})}</td><td class="c-b" data-label="${esc(B)}">${fld("m-" + m.id + "-b", "monthly.#" + m.id + ".b", m.b, {label:B})}</td>
    <td class="r num c-sum" data-label="Combined">${money(m.a + m.b)}</td><td class="c-del"><button class="x" data-act="del" data-list="monthly" data-id="${m.id}" aria-label="Remove ${esc(m.name)}">×</button></td></tr>`).join("");
  const hdbRow = `<tr class="sub"><td class="c-name">HDB instalment paid in cash <span class="hint">(from the loan calculator)</span></td><td class="r num c-a" data-label="${esc(A)}">${money(P[0].hdbCash)}</td><td class="r num c-b" data-label="${esc(B)}">${money(P[1].hdbCash)}</td><td class="r num c-sum" data-label="Combined">${money(C.hdbCash)}</td><td class="c-del"></td></tr>`;
  const fixed = S.emergencyMode === "fixed";
  return `<section class="panel" role="tabpanel" aria-labelledby="tab-emergency">
  ${exBanner()}
  <div class="kpis">
    <div class="kpi"><span class="l">Emergency fund target</span><span class="v">${money(C.efGross)}</span><span class="s">${fixed ? "Fixed amount" : S.emergencyMonths + " months of expenses"}</span></div>
    <div class="kpi"><span class="l">Already set aside</span><span class="v">${money(S.emergencySetAside)}</span><span class="s">In a separate account</span></div>
    <div class="kpi"><span class="l">Still to keep from savings</span><span class="v">${money(C.target)}</span><span class="s">Step 4 on the Overview</span></div>
    <div class="kpi"><span class="l">Covers</span><span class="v">${months ? months.toFixed(1) + " months" : "—"}</span><span class="s">of our expenses (${money(C.expAfter)}/mo)</span></div>
  </div>
  <div class="card">
    <header><h2>How big should it be?</h2></header>
    <div class="form" style="max-width:560px">
      <label for="e-mode">Set the target by</label>${sel("e-mode", "settings.emergencyMode", S.emergencyMode, [["months","Months of expenses"],["fixed","Fixed amount"]], "Target type")}
      ${fixed ? `<label for="e-fixed">Target amount (S$)</label>${fld("e-fixed", "settings.emergencyFixed", S.emergencyFixed, {label:"Fixed target"})}`
              : `<label for="e-months">Months of expenses</label>${fld("e-months", "settings.emergencyMonths", S.emergencyMonths, {label:"Months"})}`}
      <label for="e-aside">Already set aside in a separate account (S$)</label>${fld("e-aside", "settings.emergencySetAside", S.emergencySetAside, {label:"Set aside"})}
    </div>
    <p class="note">Only count money here that is <b>not</b> already in your cash savings on the Housing tab, or it will be counted twice. Common guidance is 3 to 6 months of expenses; more if one income is less stable.</p>
  </div>
  <p class="note">"Months of expenses" uses our monthly expenses after we move in (${money(C.expAfter)}/mo), from the <a href="monthly.html" data-go="monthly">Monthly tab</a>.</p>
</section>`;
}

function renderReno(R){
  const view = renoView || activePlan(), cap = state.reno.cap;
  const RN = state.reno.items.filter(i => planOf(i) === view), inc = RN.filter(i => i.include);
  const planTot = pl => sum(state.reno.items.filter(i => planOf(i) === pl && i.include), effCost);
  const planEst = pl => Math.max(0, sum(state.reno.items.filter(i => planOf(i) === pl && i.include && !(+i.quote > 0)), effCost));
  const planAll = pl => planTot(pl) + planEst(pl) * R.k;
  const hasAce = state.reno.items.some(i => planOf(i) === "ace");
  const tile = pl => { const t = planTot(pl), on = activePlan() === pl, n = state.reno.items.filter(i => planOf(i) === pl && i.include).length;
    return `<div class="plan ${on ? "on" : ""} ${view === pl ? "viewing" : ""}">
      <div class="pt"><b>${PLANS[pl]}</b>${on ? '<span class="chip good">Used in budget</span>' : ""}</div>
      <div class="v num">${money(planAll(pl))}</div>
      <div class="hint">${n} items · ${money(t)} + ${state.settings.contingencyPct}% on unquoted items</div>
      <div class="pacts">${view === pl ? '<span class="hint">Showing below</span>' : `<button class="linkbtn" data-act="rview" data-plan="${pl}">Show items</button>`}${on ? "" : `<button class="linkbtn" data-act="ruse" data-plan="${pl}">Use this plan</button>`}</div>
    </div>`; };
  const diff = planAll("ace") - planAll("ours");
  const compare = hasAce ? `<div class="card">
    <header><h2>Compare plans</h2><span class="hint">ACE plan is ${money(Math.abs(diff))} ${diff >= 0 ? "more" : "less"} than our list, incl. contingency</span></header>
    <div class="plans">${tile("ours")}${tile("ace")}</div>
    <p class="note">Only the plan marked "Used in budget" counts on the Overview. The lists don't cover exactly the same things: check what's missing from each before comparing totals.</p>
  </div>` : "";
  const est = sum(inc, i => +i.cost || 0), planned = sum(inc, effCost), paid = sum(inc, i => i.paid);
  const quoted = inc.filter(i => +i.quote > 0 && +i.cost > 0), qSum = sum(quoted, i => +i.quote), qEst = sum(quoted, i => +i.cost || 0);
  const nQuoted = inc.filter(i => +i.quote > 0).length, firm = sum(inc.filter(i => +i.quote > 0), i => +i.quote);
  const withCont = R.rRem + R.rEst * R.k;
  const head = cap ? planned + planEst(view) * R.k - cap : 0;
  const row = it => {
    const p = "r-" + it.id, q = +it.quote || 0, d = q - (+it.cost || 0);
    const pos = q ? (it.lo && q < it.lo ? "below" : it.hi && q > it.hi ? "above" : "within") : "";
    return `<tr>
      <td class="c-inc"><input type="checkbox" id="${p}-inc" data-b="reno.items.#${it.id}.include" data-t="b" ${it.include ? "checked" : ""} aria-label="Include ${esc(it.name)}"></td>
      <td class="namecell c-name">${fld(p + "-name", "reno.items.#" + it.id + ".name", it.name, {type:"text", label:"Item"})}${it.ex ? ` <button class="chip ex" data-act="keep" data-list="reno.items" data-id="${it.id}">Example · keep</button>` : ""}</td>
      <td class="c-cost" data-label="Estimate (S$)" style="min-width:110px">${fld(p + "-cost", "reno.items.#" + it.id + ".cost", it.cost, {label:"Estimate"})}${it.lo || it.hi ? `<div class="hint num rng">${money(it.lo)}–${money(it.hi)}</div>` : ""}</td>
      <td class="c-when" data-label="Quote (S$)" style="min-width:110px">${fld(p + "-quote", "reno.items.#" + it.id + ".quote", it.quote, {label:"Quote"})}${q && +it.cost ? `<div class="hint num rng ${pos === "above" ? "neg" : ""}">${money(d, true)} vs est.${pos ? " · " + pos + " range" : ""}</div>` : q ? `<div class="hint rng">Quoted</div>` : ""}</td>
      <td class="c-paid" data-label="Paid (S$)" style="min-width:100px">${fld(p + "-paid", "reno.items.#" + it.id + ".paid", it.paid, {label:"Paid"})}</td>
      <td class="c-note" data-label="Note" style="min-width:140px">${fld(p + "-note", "reno.items.#" + it.id + ".note", it.note, {type:"text", label:"Note"})}</td>
      <td class="c-del"><button class="x" data-act="del" data-list="reno.items" data-id="${it.id}" aria-label="Remove ${esc(it.name)}">×</button></td></tr>`;
  };
  const groups = RGROUPS.map(g => {
    const items = RN.filter(i => (RGROUPS.includes(i.group) ? i.group : "Other") === g);
    if(!items.length && g !== "Other") return "";
    const gi = items.filter(i => i.include);
    return `<tr class="cat"><td colspan="7"><span class="catname">${g === "Other" && view === "ours" ? "Our items" : g}</span> <span class="hint num">${money(sum(gi, effCost))}</span></td></tr>${items.map(row).join("")}<tr class="addrow"><td colspan="7"><button class="linkbtn" data-act="add" data-list="reno.items" data-cat="${g}">+ Add to ${g}</button></td></tr>`;
  }).join("");
  return `<section class="panel" role="tabpanel" aria-labelledby="tab-reno">
  ${exBanner()}
  <div class="kpis">
    <div class="kpi"><span class="l">Renovation planned</span><span class="v">${money(planned)}</span><span class="s">Quotes where entered, estimates elsewhere</span></div>
    <div class="kpi"><span class="l">${quoted.length ? "Quotes vs estimate" : "Firmly quoted"}</span><span class="v ${quoted.length && qSum > qEst ? "neg" : ""}">${quoted.length ? money(qSum - qEst, true) : money(firm)}</span><span class="s">${quoted.length ? `${quoted.length} items quoted (${money(qSum)} vs ${money(qEst)})` : nQuoted ? `${nQuoted} of ${inc.length} items have a quote; the rest are estimates` : "Enter quoted prices in the Quote column"}</span></div>
    <div class="kpi"><span class="l">Still to pay</span><span class="v">${money(withCont)}</span><span class="s">Incl. ${state.settings.contingencyPct}% contingency · paid ${money(paid)}</span></div>
    <div class="kpi"><span class="l">Against our budget</span><span class="v ${head > 0 ? "neg" : ""}">${cap ? (head > 0 ? money(head) + " over" : money(-head) + " under") : "No budget set"}</span><span class="s">${cap ? "Budget " + money(cap) + ", incl. contingency" : "Set one below"}</span></div>
  </div>
  ${compare}
  <div class="card">
    <header><h2>Renovation budget</h2></header>
    <div class="form" style="max-width:520px">
      <label for="r-cap">Our renovation budget (S$)</label>${fld("r-cap", "reno.cap", cap, {label:"Renovation budget"})}
    </div>
  </div>
  <div class="card">
    <header><h2>${hasAce ? PLANS[view] + " items" : "Renovation items"}</h2><span class="hint">Estimate = typical market price (range below it). Type the quoted price to compare; the quote is used in all totals</span></header>
    <div class="tablebox"><table class="items reno2"><thead><tr><th title="Include in totals">Incl.</th><th>Item</th><th class="r">Estimate (S$)</th><th class="r">Quote (S$)</th><th class="r">Paid (S$)</th><th>Note</th><th></th></tr></thead>
    <tbody>${groups}
    <tr class="total"><td class="c-inc"></td><td class="c-name">Included items</td><td class="r num c-cost" data-label="Estimate">${money(est)}</td><td class="r num c-when" data-label="Planned (quotes used)">${money(planned)}</td><td class="r num c-paid" data-label="Paid">${money(paid)}</td><td class="hint c-note">+ ${state.settings.contingencyPct}% on unquoted = ${money(planAll(view))}</td><td class="c-del"></td></tr>
    </tbody></table></div>
    <p class="note">The ${state.settings.contingencyPct}% contingency is added only to items without a firm quote. Renovation, appliances and furniture are paid in cash; CPF can't be used. Estimates assume laminate carpentry (veneer ≈ +30%, spray paint ≈ +45%); interior-designer quotes usually run 20–40% above direct contractors. Untick "Incl." to leave an item out.</p>
  </div>
</section>`;
}

function renderFamily(R){
  const F = state.family.items.filter(i => i.include && i.date).slice().sort((a, b) => a.date.localeCompare(b.date));
  const now = new Date().toISOString().slice(0, 7);
  const next = F.find(i => i.date >= now);
  const fmtM = d => { const [y, m] = d.split("-"); return new Date(+y, +m - 1, 1).toLocaleDateString("en-SG", {month:"short", year:"numeric"}); };
  const tl = F.length ? F.map(i => `<div class="tl"><span class="d">${fmtM(i.date)}</span><span>${esc(i.name)}${i === next ? ' <span class="chip warn">Next up</span>' : ""}${i.date < now && i.paid < i.cost ? ' <span class="chip bad">Overdue</span>' : ""}</span><span class="num">${money(i.cost)}</span></div>`).join("")
    : `<p class="hint">Give items a target month to see them here in date order.</p>`;
  const fPlanned = sum(state.family.items.filter(i => i.include), i => i.cost), fPaid = sum(state.family.items.filter(i => i.include), i => i.paid);
  return `<section class="panel" role="tabpanel" aria-labelledby="tab-family">
  ${exBanner()}
  <div class="kpis">
    <div class="kpi"><span class="l">Family plans, total</span><span class="v">${money(fPlanned)}</span><span class="s">Included items</span></div>
    <div class="kpi"><span class="l">Paid so far</span><span class="v">${money(fPaid)}</span><span class="s">${fPlanned ? Math.round(fPaid / fPlanned * 100) : 0}% of plan</span></div>
    <div class="kpi"><span class="l">Expected ang bao</span><span class="v">${money(R.ang)}</span><span class="s">Offsets what's still to pay</span></div>
    <div class="kpi"><span class="l">Net still to pay</span><span class="v">${money(R.famNet)}</span><span class="s">Plus ${state.settings.contingencyPct}% contingency</span></div>
  </div>
  <div class="two">
    <div class="card" style="min-width:0">
      <header><h2>Timeline</h2></header>
      <div class="timeline">${tl}</div>
    </div>
    <div class="card" style="min-width:0">
      <header><h2>Ang bao and gifts</h2></header>
      <div class="form">
        <label for="f-ang">Expected ang bao from the banquet (S$)</label>${fld("f-ang", "family.angbao", state.family.angbao, {label:"Ang bao"})}
      </div>
      <p class="note">Leave this at 0 to plan without counting on gifts. Ang bao usually arrives after the banquet, so you may need the cash up front.</p>
    </div>
  </div>
  <div class="card">
    <header><h2>ROM, wedding and family plans</h2><span class="hint">Add anything you're saving for together</span></header>
    ${itemTable(state.family.items, "family")}
  </div>
</section>`;
}

function syncAttrs(o, n){
  for(const at of Array.from(o.attributes)) if(!n.hasAttribute(at.name)) o.removeAttribute(at.name);
  for(const at of Array.from(n.attributes)) if(o.getAttribute(at.name) !== at.value) o.setAttribute(at.name, at.value);
}
function morph(from, to){
  const a = Array.from(from.childNodes), b = Array.from(to.childNodes);
  b.forEach((n, i) => {
    const o = a[i];
    if(!o){ from.appendChild(n); return; }
    if(o.nodeType !== n.nodeType || o.nodeName !== n.nodeName || (o.nodeType === 1 && o.id !== n.id)){ from.replaceChild(n, o); return; }
    if(o.nodeType !== 1){ if(o.nodeValue !== n.nodeValue) o.nodeValue = n.nodeValue; return; }
    syncAttrs(o, n);
    const active = o === document.activeElement;
    if(o.tagName === "INPUT"){
      if(!active){ if(o.type === "checkbox") o.checked = n.hasAttribute("checked"); else if(o.value !== (n.getAttribute("value") ?? "")) o.value = n.getAttribute("value") ?? ""; }
      return;
    }
    if(o.tagName === "SELECT"){ morph(o, n); if(!active){ const sv = n.querySelector("option[selected]"); o.value = sv ? sv.value : (o.options[0] ? o.options[0].value : ""); } return; }
    morph(o, n);
  });
  for(let i = a.length - 1; i >= b.length; i--) if(a[i].parentNode === from) from.removeChild(a[i]);
}
function render(){
  const R = calc();
  const a = document.activeElement, fid = a && a.id && app.contains(a) ? a.id : null;
  const tmp = document.createElement("div");
  tmp.innerHTML = tab === "housing" ? renderHousing(R) : tab === "reno" ? renderReno(R) : tab === "emergency" ? renderEmergency(R) : tab === "monthly" ? renderMonthly(R) : tab === "family" ? renderFamily(R) : renderOverview(R);
  morph(app, tmp);
  document.querySelectorAll("nav.tabs a").forEach(b => { if(b.dataset.tab === tab) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current"); });
  if(lastTab !== tab){ lastTab = tab; const tb = document.getElementById("tab-" + tab); const nv = tb && tb.parentNode; if(nv) nv.scrollLeft = Math.max(0, tb.offsetLeft - nv.clientWidth / 2 + tb.clientWidth / 2); }
  if(!loaded || readOnly) app.querySelectorAll("input,select,button.x,button.btn").forEach(el => el.disabled = true);
  if(fid && document.activeElement !== document.getElementById(fid)){ const el = document.getElementById(fid); if(el) el.focus(); }
}

/* ---------- editing ---------- */
function resolve(path){
  const segs = path.split("."); let o = state, owner = null;
  for(let i = 0; i < segs.length - 1; i++){
    const s = segs[i];
    if(s[0] === "#"){ o = o.find(x => x.id === s.slice(1)); owner = o; } else o = o[s];
    if(o == null) return null;
    if(segs[i - 1] === "people") owner = o;
  }
  if(segs[0] === "people") owner = state.people[+segs[1]];
  if(segs[0] === "loan") owner = state.loan;
  return {obj: o, key: segs[segs.length - 1], owner};
}
function onEdit(el){
  const r = resolve(el.dataset.b); if(!r) return;
  const t = el.dataset.t;
  let v = t === "b" ? el.checked : t === "n" ? num(el.value) : el.value;
  if(el.dataset.b === "settings.splitA") v = Math.min(100, Math.max(0, v));
  r.obj[r.key] = v;
  if(r.owner && r.owner.ex) delete r.owner.ex;
  raw = t === "n" ? {id: el.id, v: el.value} : null;
  render(); queueSave();
}
app.addEventListener("input", e => { const el = e.target; if(el.dataset && el.dataset.b && el.type !== "checkbox" && el.tagName !== "SELECT") onEdit(el); });
app.addEventListener("change", e => { const el = e.target; if(el.dataset && el.dataset.b && (el.type === "checkbox" || el.tagName === "SELECT")) onEdit(el); });
app.addEventListener("focusout", e => { if(raw && e.target.id === raw.id){ raw = null; setTimeout(() => { if(!app.contains(document.activeElement) || document.activeElement === document.body) render(); else { const id = document.activeElement.id; render(); const el = document.getElementById(id); if(el) el.focus(); } }, 0); } });
app.addEventListener("click", e => {
  const g = e.target.closest("a[data-go]"); if(g){ e.preventDefault(); setTab(g.dataset.go); window.scrollTo(0, 0); return; }
  const b = e.target.closest("button[data-act]"); if(!b) return;
  if(b.dataset.act === "rview"){ renoView = b.dataset.plan; render(); return; }
  if(b.dataset.act === "ruse"){ state.reno.active = b.dataset.plan; renoView = b.dataset.plan; render(); queueSave(); return; }
  if(b.dataset.act === "cat"){ const c = b.dataset.owner + ":" + b.dataset.cat; openCats.has(c) ? openCats.delete(c) : openCats.add(c); render(); return; }
  if(b.dataset.act === "keep"){
    const own = b.dataset.list ? b.dataset.list.split(".").reduce((o, k) => o[k], state).find(x => x.id === b.dataset.id) : b.dataset.owner.split(".").reduce((o, k) => o[k], state);
    if(own) delete own.ex; render(); queueSave(); return;
  }
  const list = b.dataset.list.split(".").reduce((o, k) => o[k], state);
  if(b.dataset.act === "del"){ const i = list.findIndex(x => x.id === b.dataset.id); if(i >= 0) list.splice(i, 1); }
  else {
    const id = uid();
    if(b.dataset.list === "monthly"){ const ow = +b.dataset.owner || 0, ct = b.dataset.cat || "Other"; list.push({id, owner: ow, name:"", cat: ct, amt:0, freq:"month", when:"always"}); openCats.add(ow + ":" + ct); }
    else if(b.dataset.list === "housing.items") list.push({id, name:"", cost:0, paid:0, source:"Cash", include:true, note:""});
    else list.push(Object.assign({id, name:"", cost:0, paid:0, date:"", include:true, note:""}, b.dataset.list === "reno.items" ? {group: b.dataset.cat || "Other", quote:0, plan: renoView || activePlan()} : {}));
    render(); const el = document.getElementById((b.dataset.list === "monthly" ? "m-" : b.dataset.list[0] + "-") + id + "-name"); if(el) el.focus();
    queueSave(); return;
  }
  render(); queueSave();
});
function setTab(t){ if(t !== tab && FILES[t]){ flush(); location.href = FILES[t]; } }

/* ---------- saving ---------- */
const saveEl = document.getElementById("save"), saveText = document.getElementById("saveText");
function status(cls, txt){ saveEl.className = "save " + cls; saveText.textContent = txt; }
const KEY = "tengah-budget-v1";
function queueSave(){ status("busy", "Saving…"); clearTimeout(timer); timer = setTimeout(flush, 400); }
function flush(){
  clearTimeout(timer); timer = null;
  const body = JSON.stringify(state);
  if(body === lastSaved){ status("ok", "Saved on this device"); return; }
  try{ localStorage.setItem(KEY, body); lastSaved = body; status("ok", "Saved on this device"); }
  catch(e){ status("off", "Can't save in this browser. Use Export to keep a copy"); }
}
window.addEventListener("pagehide", () => { if(timer) flush(); });
function stamp(){ const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
function exportData(){
  flush();
  const blob = new Blob([JSON.stringify(Object.assign({app:"tengah-budget", version:1, exported:new Date().toISOString()}, state), null, 2)], {type:"application/json"});
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "tengah-budget-" + stamp() + ".json";
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
function importData(file){
  const rd = new FileReader();
  rd.onload = () => {
    let d; try{ d = JSON.parse(rd.result); }catch(e){ alert("That file isn't a budget export (it isn't valid JSON)."); return; }
    if(!d || !Array.isArray(d.people)){ alert("That file doesn't look like a budget export."); return; }
    if(!confirm("Replace the figures on this device with the ones in this file?")) return;
    state = normalize(d); raw = null; lastSaved = null; flush(); render();
  };
  rd.readAsText(file);
}
function clearData(){
  if(!confirm("Clear every figure saved on this device? Export a copy first if you might need it.")) return;
  try{ localStorage.removeItem(KEY); }catch(e){}
  state = TEMPLATE(); lastSaved = null; raw = null; render(); status("ok", "Cleared");
}
document.getElementById("btnExport").addEventListener("click", exportData);
document.getElementById("btnImport").addEventListener("click", () => document.getElementById("fileImport").click());
document.getElementById("fileImport").addEventListener("change", e => { const f = e.target.files[0]; if(f) importData(f); e.target.value = ""; });
document.getElementById("btnClear").addEventListener("click", clearData);
let readOnly = false;
app.addEventListener("pointermove", e => {
  const w = e.target.closest && e.target.closest("#tlchart"); if(!w) return;
  const svg = w.querySelector("svg"), tip = w.querySelector(".tip"), hov = w.querySelector(".hov"); if(!svg) return;
  const r = svg.getBoundingClientRect(), W = +w.dataset.w, ml = +w.dataset.ml, mr = +w.dataset.mr, H = +w.dataset.h;
  const px = (e.clientX - r.left) * W / r.width; const t = Math.round((px - ml) / (W - ml - mr) * H);
  if(t < 0 || t > H){ tip.hidden = true; hov.setAttribute("visibility", "hidden"); return; }
  const p = calc().C.proj[t]; const xx = ml + (W - ml - mr) * t / H;
  hov.setAttribute("x1", xx); hov.setAttribute("x2", xx); hov.setAttribute("visibility", "visible");
  tip.hidden = false; tip.textContent = fmtYM(p.ym) + " · " + money(p.cash);
  const left = xx * r.width / W; tip.style.left = Math.min(Math.max(0, left - 60), r.width - 150) + "px";
});
app.addEventListener("pointerleave", () => { const w = document.getElementById("tlchart"); if(w){ w.querySelector(".tip").hidden = true; w.querySelector(".hov").setAttribute("visibility", "hidden"); } }, true);
let rsT = null; window.addEventListener("resize", () => { clearTimeout(rsT); rsT = setTimeout(render, 150); });


(function load(){
  let got = null, ok = true;
  try{ const s = localStorage.getItem(KEY); got = s ? JSON.parse(s) : null; }catch(e){ ok = false; }
  if(got) state = normalize(got);
  lastSaved = got ? JSON.stringify(state) : null;
  loaded = true;
  status(ok ? "ok" : "off", !ok ? "Can't save in this browser" : got ? "Saved on this device" : "Nothing saved on this device yet");
  render();
})();
window.addEventListener("storage", e => { if(e.key === KEY && e.newValue){ try{ state = normalize(JSON.parse(e.newValue)); lastSaved = e.newValue; raw = null; render(); }catch(err){} } });

})();
