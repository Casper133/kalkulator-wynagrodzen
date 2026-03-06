// ═══════════════════════════════════════════════════════
// Main — UI logic, DOM interactions, calculate()
// ═══════════════════════════════════════════════════════
let mode = 'brutto';

function getMonths() { return I18N[LANG].months; }
function getMonthsShort() { return I18N[LANG].monthsShort; }

function setMode(m) {
  mode = m;
  document.getElementById('btn-brutto').classList.toggle('active', m === 'brutto');
  document.getElementById('btn-employer').classList.toggle('active', m === 'employer');
  const L2 = I18N[LANG];
  document.getElementById('input-label').textContent = (m === 'brutto') ? L2.inputLabelB : L2.inputLabelE;
  document.getElementById('input-hint').textContent  = (m === 'brutto') ? L2.inputHintB  : L2.inputHintE;
  autoCalc();
}

function toggleCheck(id) {
  const cb = document.getElementById(id);
  const ci = document.getElementById('ci-' + id);
  cb.checked = !cb.checked;
  ci.classList.toggle('checked', cb.checked);

  if (id === 'autor') {
    document.getElementById('sf-autor').classList.toggle('visible', cb.checked);
  }

  autoCalc();
}

function fmt(n) {
  return n.toLocaleString('pl-PL', {minimumFractionDigits: 2, maximumFractionDigits: 2}) + ' zł';
}
function fmtN(n) {
  return n.toLocaleString('pl-PL', {minimumFractionDigits: 2, maximumFractionDigits: 2});
}

function getChecked(id) {
  return document.getElementById(id).checked;
}

function setAutorRate(v) {
  document.getElementById('autor-kup-rate').value = v;
  autoCalc();
}

function autoCalc() {
  if (window._calcMonths) calculate();
}

function calculate() {
  const inputVal = parseFloat(document.getElementById('salary-input').value) || 0;
  const wypRate = parseFloat(document.getElementById('wyp-rate').value) || 1.67;
  const ppk = getChecked('ppk');
  const limitZUS = true; // 282,600 zł limit always applies
  const pit0 = getChecked('pit0');
  const joint = getChecked('joint');
  const autor = getChecked('autor');
  const autorPct = parseFloat(document.getElementById('autor-pct').value) || 100;
  const autorKupRate = (parseFloat(document.getElementById('autor-kup-rate').value) || 50) / 100;
  const kupdoj = getChecked('kupdoj');
  const pit2 = getChecked('pit2');
  const spouseIncome = parseFloat(document.getElementById('spouse-income').value) || 0;

  let brutto;
  if (mode === 'employer') {
    brutto = bruttoFromEmployerCost(inputVal, wypRate, ppk);
  } else {
    brutto = inputVal;
  }

  brutto = Math.round(brutto * 100) / 100;

  const options = {pit0, joint, autor, autorPct, autorKupRate, kupdoj, pit2, ppk, limitZUS, wypRate, spouseIncome};

  const months = [];
  let cumulative   = 0;
  let cumPitBase   = 0;
  let cumKupAutor  = 0; // accumulated author KUP (120,000 zł/yr limit)
  for (let i = 0; i < 12; i++) {
    const m = calcMonth(brutto, i, cumulative, cumPitBase, cumKupAutor, options);
    months.push(m);
    cumulative  += brutto;
    cumPitBase  += m.pitDebug.pitBase ?? 0;
    cumKupAutor += m.kupAutorUsed;
  }

  // Annual sums
  const sum = (key) => months.reduce((a, m) => a + m[key], 0);

  const annBrutto    = sum('brutto');
  const annTotalCost = sum('totalCost');
  const annPit       = sum('pit');       // sum of monthly advances (depends on PIT-2)
  const annEmpZUS    = sum('emp_total');
  const annEwZUS     = sum('ew_zus_social');
  const annEwHealth  = sum('ew_health');
  const annEmpEm     = sum('emp_em');
  const annEmpRent   = sum('emp_rent');
  const annEmpWyp    = sum('emp_wyp');
  const annEmpFP     = sum('emp_fp');
  const annEmpFGSP   = sum('emp_fgsp');
  const annEmpPPK    = sum('emp_ppk');
  const annEwEm      = sum('ew_em');
  const annEwRent    = sum('ew_rent');
  const annEwChoro   = sum('ew_choro');
  const annEwPPK     = sum('ew_ppk');

  // Final annual PIT (after tax return) — independent of PIT-2
  function calcAnnualPitFinal() {
    const totalPitBase = months.reduce((a, m) => a + (m.pitDebug?.pitBase ?? 0), 0);

    if (pit0) {
      if (joint) {
        const jointTax = 2 * annualTaxScale((totalPitBase + spouseIncome) / 2)
                       - 2 * annualTaxScale((Math.min(totalPitBase, 85528) + spouseIncome) / 2);
        const workerShare = totalPitBase / (totalPitBase + spouseIncome);
        return jointTax * workerShare;
      }
      return annualTaxScale(totalPitBase) - annualTaxScale(Math.min(totalPitBase, 85528));
    } else if (joint) {
      const jointTax = 2 * annualTaxScale((totalPitBase + spouseIncome) / 2);
      const workerShare = totalPitBase / (totalPitBase + spouseIncome);
      return jointTax * workerShare;
    } else {
      return annualTaxScale(totalPitBase);
    }
  }
  // PIT-2 reduces the final tax by 3,600 zł (tax-free allowance applied via monthly advances)
  // but only if there is enough tax (result cannot go below zero)
  const annPitFinal  = Math.max(0, calcAnnualPitFinal());
  const annNetto     = annBrutto - annEwZUS - annEwHealth - annPitFinal - annEwPPK;

  const effTaxRate            = annBrutto > 0 ? (annPitFinal / annBrutto * 100) : 0;
  const effZusWorker          = annBrutto > 0 ? ((annEwZUS + annEwHealth) / annBrutto * 100) : 0;
  const effWorkerTotal        = annBrutto > 0 ? ((annBrutto - annNetto) / annBrutto * 100) : 0;
  const totalDeductionsFromCost = annTotalCost > 0 ? ((annTotalCost - annNetto) / annTotalCost * 100) : 0;

  // Monthly reference (first month)
  const M = months[0];

  // Build HTML
  let html = '';

  // Summary cards
  html += `<div class="summary-grid">
    <div class="summary-card highlight">
      <div class="card-label">${t('cardNettoMon')}</div>
      <div class="card-val accent">${fmt(annNetto / 12)}</div>
      <div class="card-sub">${t('cardNettoSub')}</div>
    </div>
    <div class="summary-card highlight4">
      <div class="card-label">${t('cardCostMon')}</div>
      <div class="card-val purple">${fmt(annTotalCost / 12)}</div>
      <div class="card-sub">${t('cardCostSub')}</div>
    </div>
    <div class="summary-card highlight2">
      <div class="card-label">${t('cardNettoYr')}</div>
      <div class="card-val accent2">${fmt(annNetto)}</div>
      <div class="card-sub">${t('cardNettoYrSub')}</div>
    </div>
    <div class="summary-card highlight3">
      <div class="card-label">${t('cardCostYr')}</div>
      <div class="card-val accent3">${fmt(annTotalCost)}</div>
      <div class="card-sub">${t('cardCostYrSub')}</div>
    </div>
  </div>`;

  // Efficiency bars
  html += `<div class="rate-bar-wrap">
    <div class="rate-bar-label">${t('effTitle')}</div>
    <div class="rate-bars">
      <div class="rate-bar-row">
        <div class="rate-bar-name">${t('effPit')}</div>
        <div class="rate-bar-track"><div class="rate-bar-fill" style="width:${Math.min(effTaxRate,50)}%;background:var(--accent3)"></div></div>
        <div class="rate-bar-pct">${effTaxRate.toFixed(1)}%</div>
      </div>
      <div class="rate-bar-row">
        <div class="rate-bar-name">${t('effZus')}</div>
        <div class="rate-bar-track"><div class="rate-bar-fill" style="width:${Math.min(effZusWorker,50)}%;background:var(--blue)"></div></div>
        <div class="rate-bar-pct">${effZusWorker.toFixed(1)}%</div>
      </div>
      <div class="rate-bar-row">
        <div class="rate-bar-name">${t('effWorker')}</div>
        <div class="rate-bar-track"><div class="rate-bar-fill" style="width:${Math.min(effWorkerTotal,60)}%;background:var(--orange)"></div></div>
        <div class="rate-bar-pct">${effWorkerTotal.toFixed(1)}%</div>
      </div>
      <div class="rate-bar-row">
        <div class="rate-bar-name">${t('effTotal')}</div>
        <div class="rate-bar-track"><div class="rate-bar-fill" style="width:${Math.min(totalDeductionsFromCost,70)}%;background:var(--accent)"></div></div>
        <div class="rate-bar-pct">${totalDeductionsFromCost.toFixed(1)}%</div>
      </div>
    </div>
  </div>`;

  // Breakdown grid
  html += `<div class="divider"></div>
  <div class="breakdown-grid">`;

  // Employer side
  html += `<div class="breakdown-section">
    <div class="breakdown-header employer">
      <span>${t('empHeader')}</span>
      <span>${fmt(M.emp_total)}</span>
    </div>
    <div class="breakdown-row">
      <span class="name">${t('empPension')}</span>
      <span><span class="rate">9,76%</span><span class="val">${fmt(M.emp_em)}</span></span>
    </div>
    <div class="breakdown-row">
      <span class="name">${t('empRent')}</span>
      <span><span class="rate">6,50%</span><span class="val">${fmt(M.emp_rent)}</span></span>
    </div>
    <div class="breakdown-row">
      <span class="name">${t('empAccident')}</span>
      <span><span class="rate">${wypRate.toFixed(2)}%</span><span class="val">${fmt(M.emp_wyp)}</span></span>
    </div>
    <div class="breakdown-row ${M.emp_fp === 0 ? 'zero' : ''}">
      <span class="name">${t('empFP')}${M.emp_fp === 0 ? ` <span class="tag orange">${t('empFPLow')}</span>` : ''}</span>
      <span><span class="rate">2,45%</span><span class="val">${fmt(M.emp_fp)}</span></span>
    </div>
    <div class="breakdown-row">
      <span class="name">FGŚP</span>
      <span><span class="rate">0,10%</span><span class="val">${fmt(M.emp_fgsp)}</span></span>
    </div>
    ${ppk ? `<div class="breakdown-row">
      <span class="name">PPK <span class="tag green">PPK</span></span>
      <span><span class="rate">1,50%</span><span class="val">${fmt(M.emp_ppk)}</span></span>
    </div>` : ''}
    <div class="breakdown-row subtotal">
      <span class="name">${t('empTotal')}</span>
      <span><span class="val total">${fmt(M.emp_total)}</span></span>
    </div>
    <div class="breakdown-row subtotal" style="background:rgba(232,255,71,0.07)">
      <span class="name" style="color:var(--accent)">${t('empTotalCost')}</span>
      <span><span class="val" style="color:var(--accent);font-weight:800">${fmt(M.totalCost)}</span></span>
    </div>
  </div>`;

  // Employee side — extracted to a function for reactive month updates
  function renderEmployeeBreakdown(midx) {
    const Mx = months[midx];
    const monthName = getMonths()[midx];
    const isPit0exempt = Mx.pitDebug && Mx.pitDebug.exempt;
    return `<div class="breakdown-header employee">
      <span>${t('ewHeader')}${monthName}</span>
      <span></span>
    </div>
    <div class="breakdown-row">
      <span class="name">${t('ewBrutto')}</span>
      <span><span class="val">${fmt(Mx.brutto)}</span></span>
    </div>
    <div class="breakdown-row">
      <span class="name">${t('ewPension')}</span>
      <span><span class="rate">9,76%</span><span class="val negative">−${fmt(Mx.ew_em)}</span></span>
    </div>
    <div class="breakdown-row">
      <span class="name">${t('ewRent')}</span>
      <span><span class="rate">1,50%</span><span class="val negative">−${fmt(Mx.ew_rent)}</span></span>
    </div>
    <div class="breakdown-row">
      <span class="name">${t('ewSick')}</span>
      <span><span class="rate">2,45%</span><span class="val negative">−${fmt(Mx.ew_choro)}</span></span>
    </div>
    <div class="breakdown-row">
      <span class="name">${t('ewHealth')}</span>
      <span><span class="rate">9,00%</span><span class="val negative">−${fmt(Mx.ew_health)}</span></span>
    </div>
    ${ppk ? `<div class="breakdown-row">
      <span class="name">${t('ewPpk')} <span class="tag green">PPK</span></span>
      <span><span class="rate">2,00%</span><span class="val negative">−${fmt(Mx.ew_ppk)}</span></span>
    </div>` : ''}
    <div class="breakdown-row">
      <span class="name">${t('ewKup')}</span>
      <span><span class="val">${fmt(Mx.kup)}</span></span>
    </div>
    <div class="breakdown-row ${isPit0exempt ? 'zero' : ''}">
      <span class="name">${t('ewPit')} ${isPit0exempt ? '<span class="tag green">0%</span>' : ''}</span>
      <span><span class="val negative">−${fmt(Mx.pit)}</span></span>
    </div>
    <div class="breakdown-row subtotal" style="background:rgba(232,255,71,0.07)">
      <span class="name" style="color:var(--accent)">${t('ewNetto')}</span>
      <span><span class="val" style="color:var(--accent);font-weight:800">${fmt(Mx.netto)}</span></span>
    </div>`;
  }

  html += `<div class="breakdown-section" id="employee-breakdown">${renderEmployeeBreakdown(0)}</div>`;


  html += `</div>`;

  // ---- PIT detail block — with month selector ----
  window._calcMonths = months;

  function renderPitDetail(midx) {
    const Mx  = months[midx];
    const pdx = Mx.pitDebug;
    let h = '';

    if (pdx.exempt) {
      const usedBefore = Math.max(0, 85528 - pdx.exemptRemaining);
      const usedAfter  = Math.min(85528, usedBefore + (pdx.pitBase || 0));
      h += `<div class="breakdown-row">
        <span class="name" style="color:var(--green)">${t('pitZeroOk')}</span>
        <span class="val" style="color:var(--green)">0,00 zł</span>
      </div>
      <div class="breakdown-row" style="background:rgba(74,222,128,0.05)">
        <span class="name" style="color:var(--text-muted)">${t('pitZeroUsed')}</span>
        <span class="val" style="color:var(--text-muted)">${fmtN(usedBefore)} zł ${t('pitZeroOfLimit')}</span>
      </div>
      <div class="breakdown-row" style="background:rgba(74,222,128,0.05)">
        <span class="name" style="color:var(--green)">${t('pitZeroRem')}</span>
        <span class="val" style="color:var(--green)">${fmtN(Math.max(0, 85528 - usedAfter))} zł</span>
      </div>`;

    } else if (pdx.pit0limitExceeded) {
      h += `<div class="breakdown-row" style="background:rgba(255,107,107,0.06)">
        <span class="name" style="color:var(--accent3)">${t('pitZeroExc')}</span>
        <span></span>
      </div>
      <div class="breakdown-row">
        <span class="name">${t('pitTaxBase')}</span>
        <span class="val">${fmtN(pdx.pitBase)} zł</span>
      </div>
      <div class="breakdown-row">
        <span class="name" style="color:var(--green)">${t('pitExemptRem')}</span>
        <span class="val" style="color:var(--green)">−${fmtN(pdx.exemptRemaining)} zł</span>
      </div>
      <div class="breakdown-row subtotal">
        <span class="name">${t('pitTaxableBase')}</span>
        <span class="val total">${fmtN(pdx.taxableBase)} zł${t('unitMo')}</span>
      </div>
      <div class="breakdown-row" style="background:rgba(255,255,255,0.015)">
        <span class="name" style="color:var(--text-muted)">${t('pitAnnualScale')}</span>
        <span class="val" style="color:var(--text-muted)">${fmtN(pdx.taxableBase * 12)} zł${t('unitYr')}</span>
      </div>
      <div class="breakdown-row">
        <span class="name">${t('pitMonthTax')}</span>
        <span class="val">${fmtN(pdx.monthlyTax)} zł${t('unitMo')}</span>
      </div>
      ${pit2 ? `<div class="breakdown-row">
        <span class="name">− PIT-2 <span class="tag green">${t('pit2Tag')}</span></span>
        <span class="val negative">−${fmtN(pdx.pit2reduction)} zł</span>
      </div>` : ''}
      <div class="breakdown-row subtotal" style="background:rgba(255,107,107,0.08)">
        <span class="name" style="color:var(--accent3)">${t('pitAdvance')}</span>
        <span class="val" style="color:var(--accent3);font-weight:800">${fmt(Mx.pit)}</span>
      </div>`;

    } else {
      h += `
      <div class="breakdown-row">
        <span class="name">${t('pitBrutto')}</span>
        <span class="val">${fmt(Mx.brutto)}</span>
      </div>
      <div class="breakdown-row">
        <span class="name">${t('pitZusSoc')}</span>
        <span class="val negative">−${fmt(Mx.ew_zus_social)}</span>
      </div>
      <div class="breakdown-row">
        <span class="name">${t('pitKup')}</span>
        <span class="val negative">−${fmt(Mx.kup)}</span>
      </div>
      <div class="breakdown-row subtotal">
        <span class="name">${t('pitBaseRound')} <span class="tag orange">${t('pitRounded')}</span></span>
        <span class="val total">${fmtN(pdx.pitBase)} zł</span>
      </div>
      <div class="breakdown-row" style="background:rgba(255,255,255,0.015)">
        <span class="name" style="color:var(--text-muted)">${t('pitPrevBase')}</span>
        <span class="val" style="color:var(--text-muted)">${fmtN(pdx.prevBase)} zł</span>
      </div>
      <div class="breakdown-row" style="background:rgba(255,255,255,0.025)">
        <span class="name" style="color:var(--text)">${t('pitYtdBase')}</span>
        <span class="val">${fmtN(pdx.ytdBase)} zł</span>
      </div>`;

      if (joint && pdx.halfCombined !== null) {
        h += `
        <div class="breakdown-row" style="background:rgba(192,132,252,0.06)">
          <span class="name" style="color:var(--purple)">${t('pitSpouseYtd')}</span>
          <span class="val" style="color:var(--purple)">${fmtN(spouseIncome)} zł${t('unitYr')}</span>
        </div>
        <div class="breakdown-row" style="background:rgba(192,132,252,0.06)">
          <span class="name" style="color:var(--purple)">${t('pitHalf')}</span>
          <span class="val" style="color:var(--purple)">${fmtN(pdx.halfCombined)} zł</span>
        </div>`;
      }

      h += `<div class="breakdown-row" style="padding-top:0.7rem;border-top:1px dashed var(--border)">
        <span class="name" style="color:var(--text-muted);font-size:0.68rem">${t('pitScale')}</span>
        <span></span>
      </div>`;

      const scaleBase = joint && pdx.halfCombined !== null ? pdx.halfCombined : pdx.ytdBase;
      const scalePrev = joint && pdx.halfCombined !== null
        ? (pdx.ytdBase - pdx.pitBase + pdx.prevBase) / 2   // approximation
        : pdx.prevBase;

      if (scaleBase <= 30000) {
        h += `<div class="breakdown-row">
          <span class="name">${t('pitFreeAll')}</span>
          <span class="val" style="color:var(--green)">0,00 zł</span>
        </div>`;
      } else {
        const r1b = Math.min(Math.max(0, scaleBase - 30000), 90000);
        const r2b = Math.max(0, scaleBase - 120000);
        h += `
        <div class="breakdown-row">
          <span class="name">${t('pitFreeQuota')}</span>
          <span><span class="rate">0%</span><span class="val" style="color:var(--green)">30 000 zł → 0,00 zł</span></span>
        </div>
        <div class="breakdown-row">
          <span class="name">${t('pitBracket12')} <span style="color:var(--text-muted);font-size:0.68rem">${fmtN(r1b)} zł × 12%</span></span>
          <span><span class="rate">12%</span><span class="val">${fmtN(r1b * 0.12)} zł</span></span>
        </div>`;
        if (r2b > 0) {
          h += `<div class="breakdown-row">
            <span class="name">${t('pitBracket32')} <span style="color:var(--text-muted);font-size:0.68rem">${fmtN(r2b)} zł × 32%</span></span>
            <span><span class="rate" style="color:var(--accent3)">32%</span><span class="val" style="color:var(--accent3)">${fmtN(r2b * 0.32)} zł</span></span>
          </div>`;
        }
        h += `<div class="breakdown-row subtotal">
          <span class="name">${joint ? t('pitYtdTaxJoint') : t('pitYtdTax')}</span>
          <span class="val total">${fmtN(pdx.ytdTax)} zł</span>
        </div>`;
      }

      h += `
      <div class="breakdown-row" style="background:rgba(255,255,255,0.015)">
        <span class="name" style="color:var(--text-muted)">${t('pitPrevTax')}</span>
        <span class="val" style="color:var(--text-muted)">−${fmtN(pdx.prevTax)} zł</span>
      </div>
      <div class="breakdown-row subtotal">
        <span class="name">${t('pitDiff')}</span>
        <span class="val total">${fmtN(pdx.taxThisMonth)} zł</span>
      </div>`;

      if (pit2) {
        h += `<div class="breakdown-row">
          <span class="name">${t('pit2Applied')} <span class="tag green">${t('pit2Tag')}</span></span>
          <span class="val negative">−${fmtN(pdx.pit2reduction)} zł</span>
        </div>`;
      } else {
        h += `<div class="breakdown-row zero">
          <span class="name">${t('pit2NotFiled')}</span>
          <span class="val">—</span>
        </div>`;
      }

      h += `<div class="breakdown-row subtotal" style="background:rgba(255,107,107,0.08)">
        <span class="name" style="color:var(--accent3)">${t('pitAdvanceMon')} <span class="tag orange">${t('pitRounded')}</span></span>
        <span class="val" style="color:var(--accent3);font-weight:800">${fmt(Mx.pit)}</span>
      </div>`;
    }
    return h;
  }

  const monthTabsHtml = getMonthsShort().map((name, i) => {
    const mx = months[i];
    const hasEvent = mx.limitApplied || (mx.pitDebug && (mx.pitDebug.pit0limitExceeded));
    const isFirst  = i === 0;
    return `<button
      onclick="selectPitMonth(${i})"
      id="pit-tab-${i}"
      style="padding:0.3rem 0.55rem;border-radius:5px;border:1px solid var(--border);
             background:${isFirst ? 'var(--accent3)' : 'var(--surface2)'};
             color:${isFirst ? '#0e0f14' : 'var(--text-dim)'};
             font-family:var(--font-mono);font-size:0.65rem;cursor:pointer;
             position:relative;white-space:nowrap;transition:all 0.15s"
    >${name}${hasEvent ? '<span style="position:absolute;top:-3px;right:-3px;width:6px;height:6px;background:var(--accent);border-radius:50%;display:block"></span>' : ''}</button>`;
  }).join('');

  html += `<div class="breakdown-section" style="margin-bottom:1rem">
    <div class="breakdown-header tax" style="flex-direction:column;gap:0.6rem;align-items:flex-start">
      <div style="display:flex;justify-content:space-between;width:100%;align-items:center">
        <span>${t('pitDetailTitle')}</span>
        <span id="pit-detail-val" style="color:var(--accent3)">${fmt(months[0].pit)}</span>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:0.35rem">${monthTabsHtml}</div>
    </div>
    <div id="pit-detail-body">${renderPitDetail(0)}</div>
  </div>`;

  window.selectPitMonth = function(idx) {
    const ms = window._calcMonths;
    if (!ms) return;
    for (let i = 0; i < 12; i++) {
      const btn = document.getElementById('pit-tab-' + i);
      if (!btn) continue;
      btn.style.background = i === idx ? 'var(--accent3)' : 'var(--surface2)';
      btn.style.color      = i === idx ? '#0e0f14'        : 'var(--text-dim)';
    }
    document.getElementById('employee-breakdown').innerHTML = renderEmployeeBreakdown(idx);
    document.getElementById('pit-detail-body').innerHTML    = renderPitDetail(idx);
    document.getElementById('pit-detail-val').textContent  = fmt(ms[idx].pit);
  };


  // Annual table
  html += `<div class="annual-section">
    <div class="annual-header">
      <span>${t('annualTitle')}</span>
      <span style="color:var(--text-muted);font-size:0.62rem">${t('annualZusNote')}</span>
    </div>
    <div style="overflow-x:auto">
    <table class="annual-table">
      <thead>
        <tr>
          <th>${t('tblMonth')}</th>
          <th>${t('tblBrutto')}</th>
          <th>${t('tblZus')}</th>
          <th>${t('tblHealth')}</th>
          <th>${t('tblPit')}</th>
          <th>${t('tblNetto')}</th>
          <th>${t('tblCost')}</th>
        </tr>
      </thead>
      <tbody>`;

  let annCumBrutto = 0;
  months.forEach((m, i) => {
    const limitRow = m.limitApplied;
    html += `<tr${limitRow ? ' class="month-limit"' : ''}>
      <td>${getMonths()[i]}</td>
      <td>${fmtN(m.brutto)}</td>
      <td style="color:var(--blue)">${fmtN(m.ew_zus_social)}</td>
      <td style="color:var(--blue)">${fmtN(m.ew_health)}</td>
      <td style="color:var(--accent3)">${fmtN(m.pit)}</td>
      <td style="color:var(--accent);font-weight:600">${fmtN(m.netto)}</td>
      <td style="color:var(--purple)">${fmtN(m.totalCost)}</td>
    </tr>`;
    annCumBrutto += m.brutto;
  });

  html += `</tbody>
      <tfoot>
        <tr>
          <td>${t('tblTotal')}</td>
          <td>${fmtN(annBrutto)}</td>
          <td style="color:var(--blue)">${fmtN(annEwZUS)}</td>
          <td style="color:var(--blue)">${fmtN(annEwHealth)}</td>
          <td style="color:var(--accent3)">${fmtN(annPit)}</td>
          <td style="color:var(--accent);font-weight:800">${fmtN(annNetto)}</td>
          <td style="color:var(--purple)">${fmtN(annTotalCost)}</td>
        </tr>
      </tfoot>
    </table>
    </div>
  </div>`;

  // Annual employer breakdown
  html += `<div class="breakdown-section" style="margin-bottom:1rem">
    <div class="breakdown-header employer">
      <span>${t('annEmpHeader')}</span>
      <span>${fmt(annEmpZUS)}</span>
    </div>
    <div class="breakdown-row">
      <span class="name">${t('annEmpPension')}</span>
      <span><span class="val">${fmt(annEmpEm)}</span></span>
    </div>
    <div class="breakdown-row">
      <span class="name">${t('annEmpRent')}</span>
      <span><span class="val">${fmt(annEmpRent)}</span></span>
    </div>
    <div class="breakdown-row">
      <span class="name">${t('annEmpAccident')}</span>
      <span><span class="val">${fmt(annEmpWyp)}</span></span>
    </div>
    <div class="breakdown-row">
      <span class="name">${t('annEmpFP')}</span>
      <span><span class="val">${fmt(annEmpFP)}</span></span>
    </div>
    <div class="breakdown-row">
      <span class="name">FGŚP</span>
      <span><span class="val">${fmt(annEmpFGSP)}</span></span>
    </div>
    ${ppk ? `<div class="breakdown-row"><span class="name">PPK</span><span class="val">${fmt(annEmpPPK)}</span></div>` : ''}
    <div class="breakdown-row subtotal">
      <span class="name">${t('annBrutto')}</span><span class="val total">${fmt(annBrutto)}</span>
    </div>
    <div class="breakdown-row subtotal" style="background:rgba(232,255,71,0.07)">
      <span class="name" style="color:var(--accent)">${t('annTotalCost')}</span>
      <span class="val" style="color:var(--accent);font-weight:800">${fmt(annTotalCost)}</span>
    </div>
  </div>`;

  // Notes
  let notes = [];
  if (pit0) notes.push(t('noteZerowy')({pit0, spouseFmt:fmt(spouseIncome)}));
  if (joint) notes.push(t('noteJoint')({spouseFmt:fmt(spouseIncome), pit0}));
  if (autor) notes.push(t('noteAutor')({kupPct:Math.round(autorKupRate*100), autorPct}));
  if (ppk) notes.push(t('notePpk')({}));
  notes.push(t('noteZusLimit')({}));
  notes.push(t('noteDisclaimer')({}));

  html += `<div class="results-note">${notes.join('<br>')}</div>`;

  document.getElementById('results-body').innerHTML = html;
}

// Initialise UI text in the default language
applyLang();
