/* ============================
   2M Notas + DRE (Revisado)
   - HTML único
   - localStorage persistence
   ============================ */

const App = (() => {
  const LS_KEY = "dre_mock_v2"; // novo key para evitar conflito com versões quebradas
  const state = { view:"cadastro", selectedId:null };

  const DRE_LABELS = {
    RECEITA_OPERACIONAL: "Receita Operacional",
    RECEITA_FINANCEIRA: "Receita Financeira",
    CUSTOS_PROCESSAMENTO: "Custos de Processamento",
    DESPESAS_OPERACIONAIS: "Despesas Operacionais",
    DESPESAS_ADM: "Despesas Administrativas",
    DESPESAS_PESSOAL: "Despesas com Pessoal",
    IMPOSTOS: "Impostos",
    OUTROS: "Outros"
  };

  function nowISODate(){
    const d = new Date();
    const off = d.getTimezoneOffset();
    const d2 = new Date(d.getTime() - off*60*1000);
    return d2.toISOString().slice(0,10);
  }
  function ymToday(){
    const d = new Date();
    const m = String(d.getMonth()+1).padStart(2,"0");
    return `${d.getFullYear()}-${m}`;
  }
  function moneyBRL(n){
    try{ return new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format(n); }
    catch(e){ return "R$ " + (n||0).toFixed(2); }
  }
  function parseMoney(str){
    if(!str) return 0;
    const s = String(str).trim().replace(/\./g,"").replace(",",".").replace(/[^\d.-]/g,"");
    const v = Number(s);
    return isNaN(v) ? 0 : v;
  }
  function uid(){ return "N" + Math.random().toString(16).slice(2) + Date.now().toString(16); }

  function load(){
    const raw = localStorage.getItem(LS_KEY);
    if(!raw) return { notas: [], receitaManualByMonth: {} };
    try{
      const obj = JSON.parse(raw);
      if(!Array.isArray(obj.notas)) obj.notas = [];
      if(!obj.receitaManualByMonth) obj.receitaManualByMonth = {};
      return obj;
    }catch(e){
      return { notas: [], receitaManualByMonth: {} };
    }
  }
  function save(db){ localStorage.setItem(LS_KEY, JSON.stringify(db)); }
  function getDB(){ return load(); }
  function setDB(db){ save(db); }

  function toast(title, msg){
    const el = document.getElementById("toast");
    document.getElementById("toastT").textContent = title || "OK";
    document.getElementById("toastM").textContent = msg || "";
    el.style.display = "block";
    clearTimeout(toast._t);
    toast._t = setTimeout(()=> el.style.display="none", 3200);
  }

  function go(view){
    state.view = view;
    ["cadastro","notas","dre","documentos"].forEach(v=>{
      document.getElementById("nav-"+v).classList.toggle("active", v===view);
      document.getElementById("view-"+v).style.display = (v===view) ? "" : "none";
    });

    const title = document.getElementById("pageTitle");
    const sub = document.getElementById("pageSub");
    if(view==="cadastro"){
      title.textContent = "Cadastro / Upload de Nota";
      sub.textContent = "Cadastre notas e receitas/despesas.";
    }else if(view==="notas"){
      title.textContent = "Lançamentos (Notas)";
      sub.textContent = "Lista completa com detalhamento e status.";
    }else if(view==="dre"){
      title.textContent = "DRE (Dashboard)";
      sub.textContent = "Consolidado por período + detalhamento por categoria.";
    }else{
      title.textContent = "Documentos (Pastas)";
      sub.textContent = "Organização por Tipo → Categoria → Competência.";
    }
    renderAll();
  }

  function clearForm(){
    document.getElementById("f_tipo").value = "DESPESA";
    document.getElementById("f_status").value = "PENDENTE";
    document.getElementById("f_nome").value = "";
    document.getElementById("f_doc").value = "";
    document.getElementById("f_categoria").value = "DESPESAS_OPERACIONAIS";
    document.getElementById("f_cc").value = "";
    document.getElementById("f_competencia").value = ymToday();
    document.getElementById("f_venc").value = nowISODate();
    document.getElementById("f_valor").value = "";
    document.getElementById("f_numero").value = "";
    document.getElementById("f_desc").value = "";
    document.getElementById("f_file").value = "";
    document.getElementById("f_pagoem").value = "";
  }

  async function fileToDataURL(file){
    return new Promise((resolve,reject)=>{
      const r = new FileReader();
      r.onload = ()=> resolve(r.result);
      r.onerror = ()=> reject(new Error("Falha ao ler arquivo"));
      r.readAsDataURL(file);
    });
  }

  function badgeForStatus(status){
    if(status==="PAGA") return `<span class="badge ok"><span class="dot"></span>Paga</span>`;
    if(status==="LANCADA") return `<span class="badge warn"><span class="dot"></span>Lançada</span>`;
    return `<span class="badge bad"><span class="dot"></span>Pendente</span>`;
  }
  function statusOptions(cur){
    const opts = [["PENDENTE","Pendente"],["LANCADA","Lançada"],["PAGA","Paga"]];
    return opts.map(([v,l])=>`<option value="${v}" ${v===cur?"selected":""}>${l}</option>`).join("");
  }
  function esc(s){ return String(s ?? "").replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
  function escAttr(s){ return String(s ?? "").replace(/"/g,'&quot;'); }
  function formatBytes(bytes){
    if(!bytes && bytes!==0) return "—";
    const units = ["B","KB","MB","GB"];
    let v = bytes, i=0;
    while(v>=1024 && i<units.length-1){ v/=1024; i++; }
    return `${v.toFixed(i?1:0)} ${units[i]}`;
  }

  function getPeriod(){
    const ini = document.getElementById("filtro_inicio").value || ymToday();
    const fim = document.getElementById("filtro_fim").value || ymToday();
    // normalize if user inverted
    const start = ini <= fim ? ini : fim;
    const end = ini <= fim ? fim : ini;
    return { start, end };
  }

  // Receita manual: por mês do período (modelo simples de mercado: valor fixo por mês)
  function getReceitaManualPerMonth(){
    return parseMoney(document.getElementById("receita_manual").value || "");
  }

  function monthsBetweenInclusive(startYm, endYm){
    const [sy, sm] = startYm.split("-").map(Number);
    const [ey, em] = endYm.split("-").map(Number);
    const out = [];
    let y = sy, m = sm;
    while(y < ey || (y===ey && m<=em)){
      out.push(`${y}-${String(m).padStart(2,"0")}`);
      m++;
      if(m===13){ m=1; y++; }
    }
    return out;
  }

  async function addNota(){
    const tipo = document.getElementById("f_tipo").value;
    const status = document.getElementById("f_status").value;
    const nome = document.getElementById("f_nome").value.trim();
    const doc  = document.getElementById("f_doc").value.trim();
    const categoria = document.getElementById("f_categoria").value;
    const cc = document.getElementById("f_cc").value.trim();
    const competencia = document.getElementById("f_competencia").value || ymToday();
    const venc = document.getElementById("f_venc").value || nowISODate();
    const valor = parseMoney(document.getElementById("f_valor").value);
    const numero = document.getElementById("f_numero").value.trim();
    const desc = document.getElementById("f_desc").value.trim();
    let pagoEm = document.getElementById("f_pagoem").value;

    if(!nome){ toast("Faltou algo", "Informe o fornecedor/colaborador (PJ)."); return; }
    if(!valor || valor<=0){ toast("Faltou algo", "Informe um valor válido (maior que zero)."); return; }
    if(status==="PAGA" && !pagoEm) pagoEm = nowISODate();

    const fileInput = document.getElementById("f_file");
    const file = fileInput.files && fileInput.files[0] ? fileInput.files[0] : null;

    let attachment = null;
    if(file){
      if(file.size > 3.5 * 1024 * 1024){
        toast("Arquivo grande", "Use arquivos menores (até ~3.5MB) neste protótipo.");
        return;
      }
      const dataUrl = await fileToDataURL(file);
      attachment = { name:file.name, type:file.type || "application/octet-stream", size:file.size, dataUrl };
    }

    const nota = {
      id: uid(),
      tipo,
      status,
      fornecedor: nome,
      doc,
      categoria,
      centroCusto: cc,
      competencia,
      vencimento: venc,
      valor,
      numero,
      descricao: desc,
      criadoEm: new Date().toISOString(),
      pagoEm: status==="PAGA" ? pagoEm : null,
      attachment
    };

    const db = getDB();
    db.notas.unshift(nota);
    setDB(db);

    toast("Salvo", "Lançamento adicionado com sucesso.");
    clearForm();
    renderAll();
  }

  function updateStatus(id, status){
    const db = getDB();
    const n = db.notas.find(x=>x.id===id);
    if(!n) return;
    n.status = status;
    if(status==="PAGA" && !n.pagoEm) n.pagoEm = nowISODate();
    if(status!=="PAGA") n.pagoEm = null;
    setDB(db);
    renderAll();
    toast("Atualizado", `Status: ${status==="PAGA"?"Paga":(status==="LANCADA"?"Lançada":"Pendente")}.`);
  }
  function markPaid(id){ updateStatus(id, "PAGA"); }

  function deleteNota(id){
    if(!confirm("Excluir este lançamento?")) return;
    const db = getDB();
    db.notas = db.notas.filter(x=>x.id!==id);
    setDB(db);
    renderAll();
    toast("Excluído", "Lançamento removido.");
  }

  function kvLine(k,v){
    return `<div style="margin-bottom:10px">
      <div class="k">${k}</div>
      <div class="v">${v}</div>
    </div>`;
  }

  function openModal(id){
    const db = getDB();
    const n = db.notas.find(x=>x.id===id);
    if(!n) return;
    state.selectedId = id;

    document.getElementById("m_title").textContent = `${n.fornecedor} — ${moneyBRL(n.valor)}`;
    document.getElementById("m_sub").textContent = `${n.tipo} • ${DRE_LABELS[n.categoria] || n.categoria} • Competência ${n.competencia}`;

    const kv = [];
    kv.push(kvLine("ID", `<span class="mono">${n.id}</span>`));
    kv.push(kvLine("Fornecedor", esc(n.fornecedor)));
    kv.push(kvLine("Documento", esc(n.doc || "—")));
    kv.push(kvLine("Tipo", n.tipo==="RECEITA" ? "Receita" : "Despesa"));
    kv.push(kvLine("Categoria DRE", DRE_LABELS[n.categoria] || n.categoria));
    kv.push(kvLine("Centro de Custo", esc(n.centroCusto || "—")));
    kv.push(kvLine("Competência", esc(n.competencia)));
    kv.push(kvLine("Vencimento", esc(n.vencimento)));
    kv.push(kvLine("Valor", `<b>${moneyBRL(n.valor)}</b>`));
    kv.push(kvLine("Status", badgeForStatus(n.status)));
    kv.push(kvLine("Pago em", esc(n.pagoEm || "—")));
    kv.push(kvLine("Número da Nota", esc(n.numero || "—")));
    kv.push(kvLine("Descrição", esc(n.descricao || "—")));
    document.getElementById("m_kv").innerHTML = kv.join("");

    const p = document.getElementById("m_preview");
    if(n.attachment && n.attachment.dataUrl){
      const isImg = (n.attachment.type||"").startsWith("image/");
      const isPdf = (n.attachment.type||"").includes("pdf") || (n.attachment.name||"").toLowerCase().endsWith(".pdf");
      let html = `<div class="muted" style="font-size:12px; margin-bottom:10px">
        Anexo: <b>${esc(n.attachment.name)}</b> (${formatBytes(n.attachment.size)})
      </div>`;
      html += `<a class="btn small" download="${escAttr(n.attachment.name)}" href="${n.attachment.dataUrl}">⬇️ Baixar anexo</a>`;
      html += `<div class="sep"></div>`;
      if(isImg){
        html += `<img src="${n.attachment.dataUrl}" alt="Anexo"/>`;
      }else if(isPdf){
        html += `<iframe title="pdf" src="${n.attachment.dataUrl}" style="width:100%; height:340px; border:0; border-radius:12px"></iframe>`;
      }else{
        html += `<div class="muted" style="font-size:13px">Pré-visualização não disponível. Use “Baixar anexo”.</div>`;
      }
      p.innerHTML = html;
    }else{
      p.innerHTML = `<div class="muted" style="font-size:13px">Sem anexo.</div>`;
    }

    document.getElementById("m_footer").textContent = `Criado em ${new Date(n.criadoEm).toLocaleString("pt-BR")}`;
    document.getElementById("modalOverlay").style.display = "flex";
  }

  function modalClose(evt){
    if(evt && evt.target && evt.target.id!=="modalOverlay") return;
    document.getElementById("modalOverlay").style.display = "none";
    state.selectedId = null;
  }
  function markPaidFromModal(){
    if(!state.selectedId) return;
    markPaid(state.selectedId);
    openModal(state.selectedId);
  }
  function duplicateFromModal(){
    if(!state.selectedId) return;
    const db = getDB();
    const n = db.notas.find(x=>x.id===state.selectedId);
    if(!n) return;
    const copy = JSON.parse(JSON.stringify(n));
    copy.id = uid();
    copy.status = "PENDENTE";
    copy.pagoEm = null;
    copy.criadoEm = new Date().toISOString();
    db.notas.unshift(copy);
    setDB(db);
    toast("Duplicado", "Criamos uma cópia como Pendente.");
    renderAll();
  }

  function computeMonth(db, ym, statusMode="TODOS"){
    const statusOk = (n) => {
      if(statusMode==="APENAS_PAGAS") return n.status==="PAGA";
      if(statusMode==="PAGAS_E_LANCADAS") return (n.status==="PAGA" || n.status==="LANCADA");
      return true;
    };
    const rows = db.notas.filter(n => (n.competencia||"")===ym).filter(statusOk);

    let receitas = 0, despesas = 0;
    const byCat = {};
    rows.forEach(n=>{
      const isRec = n.tipo==="RECEITA";
      if(isRec) receitas += n.valor; else despesas += n.valor;
      const cat = n.categoria || "OUTROS";
      if(!byCat[cat]) byCat[cat] = { receitas:0, despesas:0, total:0, count:0 };
      if(isRec) byCat[cat].receitas += n.valor; else byCat[cat].despesas += n.valor;
      byCat[cat].count += 1;
    });
    Object.keys(byCat).forEach(cat=>{
      byCat[cat].total = (byCat[cat].receitas||0) - (byCat[cat].despesas||0);
    });

    return { ym, rows, receitas, despesas, resultado: receitas - despesas, byCat };
  }

  function computePeriod(db, startYm, endYm, statusMode="TODOS"){
    const months = monthsBetweenInclusive(startYm, endYm);
    const byCat = {};
    let receitas = 0, despesas = 0;
    let rows = [];

    months.forEach(m=>{
      const r = computeMonth(db, m, statusMode);
      rows = rows.concat(r.rows);
      receitas += r.receitas;
      despesas += r.despesas;
      for(const [cat,agg] of Object.entries(r.byCat)){
        if(!byCat[cat]) byCat[cat] = { receitas:0, despesas:0, total:0, count:0 };
        byCat[cat].receitas += agg.receitas||0;
        byCat[cat].despesas += agg.despesas||0;
        byCat[cat].count += agg.count||0;
      }
    });

    for(const cat of Object.keys(byCat)){
      byCat[cat].total = (byCat[cat].receitas||0) - (byCat[cat].despesas||0);
    }

    return { months, rows, receitas, despesas, resultado: receitas - despesas, byCat };
  }

  function drawDREChart(receitas, despesas, resultado){
    const c = document.getElementById("dreChart");
    const ctx = c.getContext("2d");
    const w = c.width, h = c.height;
    ctx.clearRect(0,0,w,h);

    const pad = 26;
    const baseY = h - pad;
    const leftX = pad;
    const rightX = w - pad;

    ctx.strokeStyle = "rgba(255,255,255,.12)";
    ctx.lineWidth = 1;
    for(let i=0;i<5;i++){
      const y = pad + i*((h-2*pad)/4);
      ctx.beginPath(); ctx.moveTo(leftX, y); ctx.lineTo(rightX, y); ctx.stroke();
    }

    const maxV = Math.max(receitas, despesas, Math.abs(resultado), 1);
    const bars = [
      { label:"Receitas", value: receitas, color:"rgba(34,197,94,.75)" },
      { label:"Despesas", value: despesas, color:"rgba(245,158,11,.70)" },
      { label:"Resultado", value: resultado, color: resultado>=0 ? "rgba(34,197,94,.55)" : "rgba(239,68,68,.70)" },
    ];

    const bw = (rightX-leftX) / (bars.length*1.8);
    const gap = bw*0.8;

    bars.forEach((b, i)=>{
      const x = leftX + i*(bw+gap) + 60;
      const val = b.value;
      const bh = (Math.abs(val) / maxV) * (h - 2*pad);
      const y = val>=0 ? (baseY - bh) : baseY;

      ctx.fillStyle = b.color;
      ctx.fillRect(x, y, bw, bh);

      ctx.fillStyle = "rgba(232,238,252,.92)";
      ctx.font = "12px ui-sans-serif, system-ui";
      ctx.fillText(b.label, x, h-8);

      ctx.fillStyle = "rgba(155,176,211,.95)";
      ctx.font = "12px ui-sans-serif, system-ui";
      ctx.fillText(shortMoney(val), x, y-8);
    });

    function shortMoney(v){
      const abs = Math.abs(v);
      let s = "";
      if(abs>=1000000) s = (abs/1000000).toFixed(2).replace(".",",") + "M";
      else if(abs>=1000) s = (abs/1000).toFixed(1).replace(".",",") + "k";
      else s = abs.toFixed(0);
      return (v<0? "-":"") + "R$ " + s;
    }
  }

  function renderCadastro(){
    const db = getDB();
    if(!document.getElementById("f_competencia").value) document.getElementById("f_competencia").value = ymToday();
    if(!document.getElementById("f_venc").value) document.getElementById("f_venc").value = nowISODate();
    if(!document.getElementById("cad_comp_filter").value) document.getElementById("cad_comp_filter").value = ymToday();

    const ym = document.getElementById("cad_comp_filter").value || ymToday();
    const stFilter = document.getElementById("cad_status_filter").value || "TODOS";

    const items = db.notas.filter(n => n.competencia === ym && (stFilter==="TODOS" ? true : n.status===stFilter));
    let rec = 0, desp = 0, pend = 0, pagas = 0;
    items.forEach(n=>{
      if(n.tipo==="RECEITA") rec += n.valor; else desp += n.valor;
      if(n.status==="PENDENTE") pend++;
      if(n.status==="PAGA") pagas++;
    });

    const kpis = [
      { label:"Receitas (mês)", value: moneyBRL(rec), chip:`${items.filter(n=>n.tipo==="RECEITA").length} itens` },
      { label:"Despesas (mês)", value: moneyBRL(desp), chip:`${items.filter(n=>n.tipo==="DESPESA").length} itens` },
      { label:"Resultado (mês)", value: moneyBRL(rec-desp), chip:(rec-desp)>=0 ? "positivo" : "negativo", tone:(rec-desp)>=0 ? "ok":"bad" },
      { label:"Pagas / Pendentes", value: `${pagas} / ${pend}`, chip:`Total ${items.length}`, tone: pend>0 ? "warn":"ok" },
    ];
    document.getElementById("kpis-cadastro").innerHTML = kpis.map(k=>`
      <div class="kpi">
        <div class="t">
          <div class="l">${k.label}</div>
          <div class="chip ${k.tone||""}">${k.chip||""}</div>
        </div>
        <div class="n">${k.value}</div>
      </div>
    `).join("");

    const last = [...db.notas].slice(0,6);
    if(last.length===0){
      document.getElementById("lastList").innerHTML = `Ainda não há lançamentos. Cadastre uma <b>receita</b> e uma <b>despesa</b> para validar o DRE.`;
    }else{
      document.getElementById("lastList").innerHTML = last.map(n=>`
        <div style="display:flex; justify-content:space-between; gap:10px; padding:10px 12px; border:1px solid rgba(255,255,255,.10); border-radius:14px; background: rgba(255,255,255,.03); margin-bottom:10px">
          <div>
            <div style="font-weight:650">${esc(n.fornecedor)}</div>
            <div class="mini">Comp: ${esc(n.competencia)} • Venc: ${esc(n.vencimento)} • ${esc(DRE_LABELS[n.categoria]||n.categoria)}</div>
          </div>
          <div style="text-align:right">
            <div style="font-weight:750">${moneyBRL(n.valor)}</div>
            <div class="mini">${badgeForStatus(n.status)}</div>
          </div>
        </div>
      `).join("");
    }
  }

  function renderNotas(){
    const db = getDB();
    const q = (document.getElementById("q").value||"").toLowerCase().trim();
    const tipo = document.getElementById("notas_tipo").value || "TODOS";
    const status = document.getElementById("notas_status").value || "TODOS";
    const compExact = document.getElementById("notas_comp").value || "";

    const { start, end } = getPeriod();

    let rows = [...db.notas];

    // Period filter always applies (market expectation)
    rows = rows.filter(n => (n.competencia||"") >= start && (n.competencia||"") <= end);

    // optional exact month filter
    if(compExact) rows = rows.filter(n => n.competencia===compExact);

    if(tipo!=="TODOS") rows = rows.filter(n => n.tipo===tipo);
    if(status!=="TODOS") rows = rows.filter(n => n.status===status);

    if(q){
      rows = rows.filter(n =>
        (n.fornecedor||"").toLowerCase().includes(q) ||
        (n.numero||"").toLowerCase().includes(q) ||
        (n.descricao||"").toLowerCase().includes(q) ||
        (n.doc||"").toLowerCase().includes(q)
      );
    }

    const tbody = document.getElementById("tbodyNotas");
    if(rows.length===0){
      tbody.innerHTML = `<tr><td colspan="8" class="muted">Nenhum lançamento encontrado para os filtros / período.</td></tr>`;
      return;
    }

    tbody.innerHTML = rows.map(n=>{
      const typeLabel = n.tipo==="RECEITA" ? "Receita" : "Despesa";
      const typeBadge = n.tipo==="RECEITA"
        ? `<span class="badge ok"><span class="dot"></span>${typeLabel}</span>`
        : `<span class="badge bad"><span class="dot"></span>${typeLabel}</span>`;

      return `<tr>
        <td>
          <div style="font-weight:650">${esc(n.fornecedor)}</div>
          <div class="mini">${esc(n.doc||"")} ${n.numero?("• "+esc(n.numero)):""}</div>
        </td>
        <td>${esc(n.competencia)}</td>
        <td>
          ${esc(n.vencimento)}
          <div class="mini">${n.pagoEm ? ("Pago em "+esc(n.pagoEm)) : ""}</div>
        </td>
        <td>${typeBadge}</td>
        <td>${esc(DRE_LABELS[n.categoria]||n.categoria)}</td>
        <td><b>${moneyBRL(n.valor)}</b></td>
        <td>
          <select class="statusSel" onchange="App.updateStatus('${n.id}', this.value)">
            ${statusOptions(n.status)}
          </select>
          <div class="mini">${badgeForStatus(n.status)}</div>
        </td>
        <td>
          <div class="tdActions">
            <button class="btn small" onclick="App.openModal('${n.id}')">🔎 Detalhar</button>
            <button class="btn small primary" onclick="App.markPaid('${n.id}')">✅ Pagar</button>
            <button class="btn small" onclick="App.deleteNota('${n.id}')">🗑️ Excluir</button>
          </div>
        </td>
      </tr>`;
    }).join("");
  }

  function renderDRE(){
    const db = getDB();
    const { start, end } = getPeriod();
    const statusMode = document.getElementById("dre_status_mode").value || "TODOS";
    const mode = document.getElementById("dre_mode").value || "PERIODO";

    const receitaManualMensal = getReceitaManualPerMonth();
    const months = monthsBetweenInclusive(start, end);
    const receitaManualTotal = receitaManualMensal * months.length;

    const calc = computePeriod(db, start, end, statusMode);

    const receitasAdj = calc.receitas + receitaManualTotal;
    const resultadoAdj = receitasAdj - calc.despesas;

    const kpis = [
      { label:"Receitas (lançadas)", value: moneyBRL(calc.receitas), chip:`${calc.rows.filter(n=>n.tipo==="RECEITA").length} itens` },
      { label:"Receita manual (período)", value: moneyBRL(receitaManualTotal), chip:`${months.length} mês(es)` },
      { label:"Despesas (período)", value: moneyBRL(calc.despesas), chip:`${calc.rows.filter(n=>n.tipo==="DESPESA").length} itens`, tone:"warn" },
      { label:"Resultado (período)", value: moneyBRL(resultadoAdj), chip: resultadoAdj>=0 ? "positivo":"negativo", tone: resultadoAdj>=0 ? "ok":"bad" },
    ];

    document.getElementById("kpis-dre").innerHTML = kpis.map(k=>`
      <div class="kpi">
        <div class="t">
          <div class="l">${k.label}</div>
          <div class="chip ${k.tone||""}">${k.chip||""}</div>
        </div>
        <div class="n">${k.value}</div>
      </div>
    `).join("");

    // categories
    const cats = Object.entries(calc.byCat).sort((a,b)=> Math.abs(b[1].total) - Math.abs(a[1].total));
    if(cats.length===0){
      document.getElementById("dreCats").innerHTML = "Sem lançamentos no período.";
    }else{
      document.getElementById("dreCats").innerHTML = cats.map(([cat,agg])=>{
        const rec = agg.receitas||0, desp = agg.despesas||0;
        const res = rec - desp;
        const tone = res>=0 ? "ok" : "bad";
        return `<div style="padding:10px 12px; border:1px solid rgba(255,255,255,.10); border-radius:14px; background: rgba(255,255,255,.03); margin-bottom:10px">
          <div style="display:flex; justify-content:space-between; gap:12px; align-items:center">
            <div>
              <div style="font-weight:700">${esc(DRE_LABELS[cat]||cat)}</div>
              <div class="mini">${agg.count} itens • Receitas ${moneyBRL(rec)} • Despesas ${moneyBRL(desp)}</div>
            </div>
            <div class="badge ${tone}"><span class="dot"></span>${moneyBRL(res)}</div>
          </div>
        </div>`;
      }).join("");
    }

    // top launches
    const top = [...calc.rows].sort((a,b)=> b.valor - a.valor).slice(0,10);
    document.getElementById("dreTop").innerHTML = top.length===0
      ? "—"
      : top.map(n=>`
        <div style="display:flex; justify-content:space-between; gap:10px; padding:10px 12px; border:1px solid rgba(255,255,255,.10); border-radius:14px; background: rgba(255,255,255,.03); margin-bottom:10px">
          <div>
            <div style="font-weight:650">${esc(n.fornecedor)}</div>
            <div class="mini">${n.tipo==="RECEITA"?"Receita":"Despesa"} • ${esc(DRE_LABELS[n.categoria]||n.categoria)} • ${badgeForStatus(n.status)}</div>
          </div>
          <div style="text-align:right">
            <div style="font-weight:750">${moneyBRL(n.valor)}</div>
            <div class="mini"><button class="btn small" onclick="App.openModal('${n.id}')">Detalhar</button></div>
          </div>
        </div>
      `).join("");

    drawDREChart(receitasAdj, calc.despesas, resultadoAdj);

    if(mode==="MENSAL"){
      // optionally show month breakdown by changing top list
      // (kept simple; user asked dashboard, not a full report grid)
    }
  }

  
  function exportCNAB(){
    // Exporta Excel offline (SpreadsheetML 2003) -> .XLS (abre no Excel Mac/Windows)
    const db = getDB();
    const { start, end } = getPeriod();
    const statusMode = document.getElementById("dre_status_mode")?.value || "TODOS";
    const months = monthsBetweenInclusive(start, end);

    const statusOk = (n) => {
      if(statusMode==="APENAS_PAGAS") return n.status==="PAGA";
      if(statusMode==="PAGAS_E_LANCADAS") return (n.status==="PAGA" || n.status==="LANCADA");
      return true;
    };

    const rows = db.notas
      .filter(n => (n.competencia||"") >= start && (n.competencia||"") <= end)
      .filter(statusOk);

    const header = ["Tipo (C/D)","Competência","Categoria","Fornecedor","Valor","Documento","Nota","Status"];
    const data = [header];

    rows.forEach(n=>{
      data.push([
        n.tipo==="RECEITA" ? "C" : "D",
        n.competencia,
        n.categoria,
        n.fornecedor,
        Number(n.valor||0),
        n.doc || "",
        n.numero || "",
        n.status
      ]);
    });

    const receitaManualMensal = getReceitaManualPerMonth();
    if(receitaManualMensal > 0){
      months.forEach(m=>{
        data.push(["C", m, "RECEITA_OPERACIONAL", "AJUSTE_RECEITA_MANUAL", Number(receitaManualMensal), "", "", "MANUAL"]);
      });
    }

    const xml = buildSpreadsheetML("CONTABIL", data);
    downloadFile(xml, `dre_contabil_${start}_a_${end}.xls`, "application/vnd.ms-excel;charset=utf-8");
    toast("Exportado", "Arquivo Excel (.xls) gerado e baixado.");
  }

  function buildSpreadsheetML(sheetName, aoa){
    const esc = (s)=> String(s ?? "")
      .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
      .replace(/"/g,"&quot;").replace(/'/g,"&apos;");
    const isNum = (v)=> typeof v==="number" && isFinite(v);

    let rowsXml = "";
    aoa.forEach((row, ri)=>{
      let cells = "";
      row.forEach((cell, ci)=>{
        const type = isNum(cell) ? "Number" : "String";
        const value = isNum(cell) ? String(cell) : esc(cell);
        // Header style on first row
        const style = (ri===0) ? ' ss:StyleID="sHeader"' : "";
        cells += `<Cell${style}><Data ss:Type="${type}">${value}</Data></Cell>`;
      });
      rowsXml += `<Row>${cells}</Row>`;
    });

    return `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:html="http://www.w3.org/TR/REC-html40">
  <Styles>
    <Style ss:ID="sHeader">
      <Font ss:Bold="1"/>
      <Interior ss:Color="#D9E1F2" ss:Pattern="Solid"/>
    </Style>
  </Styles>
  <Worksheet ss:Name="${esc(sheetName)}">
    <Table>
      ${rowsXml}
    </Table>
  </Worksheet>
</Workbook>`;
  }

  function downloadFile(content, filename, mime){
    const blob = new Blob([content], {type: mime});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(()=>{
      URL.revokeObjectURL(url);
      a.remove();
    }, 250);
  }

  function cleanPipe(s){
    return String(s||"").replace(/\|/g," ").replace(/\n/g," ").trim();
  }

  // =========================
  // Tela 4: Documentos (Pastas)
  // =========================
  const docsState = { tipo:null, grupo:null, ym:null };

  function grupoFromNota(n){
    // Separa Despesas: Operacionais / Administrativas / Pessoal
    if(n.tipo === "DESPESA"){
      if(n.categoria === "DESPESAS_PESSOAL") return "Pessoal";
      if(n.categoria === "DESPESAS_ADM") return "Administrativas";
      return "Operacionais";
    }
    // Receitas: Operacional / Financeira / Outros
    if(n.categoria === "RECEITA_FINANCEIRA") return "Financeira";
    if(n.categoria === "RECEITA_OPERACIONAL") return "Operacional";
    return "Outros";
  }

  function buildDocsIndex(db){
    // index[tipoLabel][grupo][ym] = array of notas
    const index = { "Despesas": {}, "Receitas": {} };
    db.notas.forEach(n=>{
      const tipoLabel = (n.tipo==="DESPESA") ? "Despesas" : "Receitas";
      const grupo = grupoFromNota(n);
      const ym = n.competencia || ymToday();
      if(!index[tipoLabel][grupo]) index[tipoLabel][grupo] = {};
      if(!index[tipoLabel][grupo][ym]) index[tipoLabel][grupo][ym] = [];
      index[tipoLabel][grupo][ym].push(n);
    });
    return index;
  }

  function renderDocs(){
    const db = getDB();
    const index = buildDocsIndex(db);

    // Build tree UI
    const tree = document.getElementById("docsTree");
    const types = ["Despesas","Receitas"];

    const treeHtml = types.map(tipoLabel=>{
      const grupos = Object.keys(index[tipoLabel]||{}).sort((a,b)=> a.localeCompare(b));
      if(grupos.length===0){
        return `<div style="padding:10px 12px; border:1px solid rgba(255,255,255,.10); border-radius:14px; background: rgba(255,255,255,.03); margin-bottom:10px">
          <div style="font-weight:800">${tipoLabel}</div>
          <div class="mini">Sem documentos.</div>
        </div>`;
      }

      const gruposHtml = grupos.map(gr=>{
        const monthsObj = index[tipoLabel][gr]||{};
        const months = Object.keys(monthsObj).sort((a,b)=> b.localeCompare(a));
        const monthsHtml = months.map(ym=>{
          const count = monthsObj[ym].length;
          const active = (docsState.tipo===tipoLabel && docsState.grupo===gr && docsState.ym===ym);
          return `<button class="btn small" style="width:100%; justify-content:space-between; margin-top:8px; ${active ? "border-color: rgba(34,197,94,.55); background: rgba(34,197,94,.10)" : ""}"
            data-docs="1" data-tipo="${escAttr(tipoLabel)}" data-grupo="${escAttr(gr)}" data-ym="${escAttr(ym)}">
            <span>📁 ${esc(ym)}</span>
            <span class="pill">${count}</span>
          </button>`;
        }).join("");

        const isOpen = (docsState.tipo===tipoLabel && docsState.grupo===gr);
        return `<div style="padding:10px 12px; border:1px solid rgba(255,255,255,.10); border-radius:14px; background: rgba(255,255,255,.03); margin:10px 0">
          <div style="display:flex; justify-content:space-between; align-items:center; gap:10px">
            <div style="font-weight:800">${esc(gr)}</div>
            <button class="btn small" data-docs-toggle="1" data-tipo="${escAttr(tipoLabel)}" data-grupo="${escAttr(gr)}">
              ${isOpen ? "▾" : "▸"}
            </button>
          </div>
          <div style="margin-top:8px; display:${isOpen ? "block" : "none"}" id="docs_${cssId(tipoLabel)}_${cssId(gr)}">
            ${monthsHtml}
          </div>
        </div>`;
      }).join("");

      const isTypeOpen = (docsState.tipo===tipoLabel);
      return `<div style="padding:12px; border:1px solid rgba(255,255,255,.12); border-radius:16px; background: rgba(255,255,255,.02); margin-bottom:12px">
        <div style="display:flex; justify-content:space-between; align-items:center; gap:10px">
          <div style="font-weight:900">${tipoLabel}</div>
          <button class="btn small" data-docs-type="1" data-tipo="${escAttr(tipoLabel)}">${isTypeOpen ? "▾" : "▸"}</button>
        </div>
        <div style="margin-top:10px; display:${isTypeOpen ? "block" : "none"}" id="docstype_${cssId(tipoLabel)}">
          ${gruposHtml}
        </div>
      </div>`;
    }).join("");

    tree.innerHTML = treeHtml;

    // bind interactions (event delegation)
    tree.onclick = (e)=>{
      const btn = e.target.closest("button");
      if(!btn) return;

      if(btn.dataset.docsType){
        const tipo = btn.dataset.tipo;
        // toggle type open/close: if already selected, collapse and clear selection
        if(docsState.tipo===tipo && !docsState.grupo && !docsState.ym){
          docsState.tipo = null;
        }else{
          docsState.tipo = tipo;
          docsState.grupo = null;
          docsState.ym = null;
        }
        renderDocs();
        renderDocsList();
        return;
      }

      if(btn.dataset.docsToggle){
        const tipo = btn.dataset.tipo;
        const grupo = btn.dataset.grupo;
        // toggle group open/close under a type
        if(docsState.tipo===tipo && docsState.grupo===grupo && !docsState.ym){
          docsState.grupo = null;
        }else{
          docsState.tipo = tipo;
          docsState.grupo = grupo;
          docsState.ym = null;
        }
        renderDocs();
        renderDocsList();
        return;
      }

      if(btn.dataset.docs){
        docsState.tipo = btn.dataset.tipo;
        docsState.grupo = btn.dataset.grupo;
        docsState.ym = btn.dataset.ym;
        renderDocs();
        renderDocsList();
      }
    };

    // initial list render
    renderDocsList();
  }

  function cssId(s){
    return String(s||"").toLowerCase().replace(/[^a-z0-9]+/g,"_");
  }

  function renderDocsList(){
    const db = getDB();
    const tbody = document.getElementById("docsTbody");
    const title = document.getElementById("docsTitle");
    const sub = document.getElementById("docsSub");

    if(!docsState.tipo || !docsState.grupo || !docsState.ym){
      title.textContent = "Selecione uma pasta";
      sub.textContent = "Escolha Tipo → Categoria → Competência para listar as notas.";
      tbody.innerHTML = `<tr><td colspan="6" class="muted">Nenhuma pasta selecionada.</td></tr>`;
      return;
    }

    title.textContent = `${docsState.tipo} → ${docsState.grupo} → ${docsState.ym}`;
    sub.textContent = "Mostrando todos os documentos dessa pasta.";

    let rows = db.notas.filter(n=>{
      const tipoLabel = (n.tipo==="DESPESA") ? "Despesas" : "Receitas";
      if(tipoLabel !== docsState.tipo) return false;
      if(grupoFromNota(n) !== docsState.grupo) return false;
      return (n.competencia||"") === docsState.ym;
    });

    // sort by created date desc
    rows.sort((a,b)=> (b.criadoEm||"").localeCompare(a.criadoEm||""));

    if(rows.length===0){
      tbody.innerHTML = `<tr><td colspan="6" class="muted">Sem notas nesta pasta.</td></tr>`;
      return;
    }

    tbody.innerHTML = rows.map(n=>{
      const fileName = n.attachment?.name ? esc(n.attachment.name) : "<span class='muted'>Sem anexo</span>";
      const fornecedor = esc(n.fornecedor||"—");
      const cat = esc(DRE_LABELS[n.categoria] || n.categoria);
      return `<tr>
        <td>
          <div style="font-weight:700">${fileName}</div>
          <div class="mini">${fornecedor} ${n.numero?("• "+esc(n.numero)):""}</div>
        </td>
        <td>${esc(n.competencia||"—")}</td>
        <td>${cat}</td>
        <td><b>${moneyBRL(n.valor||0)}</b></td>
        <td>${badgeForStatus(n.status)}</td>
        <td>
          <div class="tdActions">
            <button class="btn small" onclick="App.openModal('${n.id}')">🔎 Visualizar</button>
            <button class="btn small primary" onclick="App.markPaid('${n.id}')">✅ Pagar</button>
          </div>
        </td>
      </tr>`;
    }).join("");
  }

  function renderAll(){
    // persist top filters to localStorage for convenience
    const db = getDB();
    const { start, end } = getPeriod();
    db._ui = db._ui || {};
    db._ui.periodStart = start;
    db._ui.periodEnd = end;
    db._ui.receitaManualMensal = document.getElementById("receita_manual").value || "";
    setDB(db);

    if(state.view==="cadastro") renderCadastro();
    if(state.view==="notas") renderNotas();
    if(state.view==="dre") renderDRE();
    if(state.view==="documentos") renderDocs();
  }

  function initTopFilters(){
    const db = getDB();
    const pStart = db._ui?.periodStart || ymToday();
    const pEnd = db._ui?.periodEnd || ymToday();
    const recMan = db._ui?.receitaManualMensal || "";

    document.getElementById("filtro_inicio").value = pStart;
    document.getElementById("filtro_fim").value = pEnd;
    document.getElementById("receita_manual").value = recMan;

    // defaults for some selects
    document.getElementById("dre_status_mode").value = "TODOS";
    document.getElementById("dre_mode").value = "PERIODO";
  }

  function init(){
    clearForm();
    if(!document.getElementById("cad_comp_filter").value) document.getElementById("cad_comp_filter").value = ymToday();
    initTopFilters();
    renderAll();
  }

  return {
    go,
    addNota,
    clearForm,
    renderAll,
    renderNotas,
    renderDRE,
    renderDocs,
    updateStatus,
    markPaid,
    deleteNota,
    openModal,
    modalClose,
    markPaidFromModal,
    duplicateFromModal,
    exportCNAB
  };
})();

window.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll(".nav button[data-view]").forEach(btn => {
    btn.addEventListener("click", () => App.go(btn.getAttribute("data-view")));
  });
  window.App = App;
  App.go("dre");
});