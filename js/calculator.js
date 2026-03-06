// ═══════════════════════════════════════════════════════
// Calculator — ZUS / PIT computation logic
// ═══════════════════════════════════════════════════════
const ZUS_ANNUAL_LIMIT = 282600;

function bruttoFromEmployerCost(cost, wypRate, ppk) {
  // cost = brutto + employer ZUS + (ppk 1.5% if ppk)
  // employer ZUS = brutto * (0.0976 + 0.065 + wypRate/100 + 0.0245 + 0.001)
  const zusRate = 0.0976 + 0.065 + (wypRate / 100) + 0.0245 + 0.001;
  const ppkRate = ppk ? 0.015 : 0;
  return cost / (1 + zusRate + ppkRate);
}

function annualTaxScale(income) {
  if (income <= 0)      return 0;
  if (income <= 30000)  return 0;
  if (income <= 120000) return (income - 30000) * 0.12;
  return (120000 - 30000) * 0.12 + (income - 120000) * 0.32;
}

function calcMonth(brutto, monthIdx, cumulativeBrutto, cumPitBase, cumKupAutor, options) {
  const {pit0, joint, autor, autorPct, autorKupRate, kupdoj, pit2, ppk, limitZUS, wypRate, spouseIncome} = options;

  const MIN_WAGE_2026 = 4806;
  const PIT0_LIMIT    = 85528; // annual PIT exemption limit for persons under 26

  // ---- ZUS annual limit (30x average salary) ----
  // Applies to: pension, disability, sickness (same base)
  const cumBefore = cumulativeBrutto;
  const cumAfter = cumBefore + brutto;

  let limitedBase = brutto; // base capped at ZUS annual limit (pension, disability, sickness)
  if (limitZUS) {
    if (cumBefore >= ZUS_ANNUAL_LIMIT) {
      limitedBase = 0;
    } else if (cumAfter > ZUS_ANNUAL_LIMIT) {
      limitedBase = ZUS_ANNUAL_LIMIT - cumBefore;
    }
  }

  // ---- Employer contributions ----
  const emp_em    = limitedBase * 0.0976;
  const emp_rent  = limitedBase * 0.065;
  const emp_wyp   = brutto * (wypRate / 100);
  // FP + FS (2.45%) only applies when salary >= minimum wage; also capped at ZUS limit
  const fpBase    = limitZUS ? limitedBase : brutto;
  const emp_fp    = brutto >= MIN_WAGE_2026 ? fpBase * 0.0245 : 0;
  const emp_fgsp  = brutto * 0.001;
  const emp_ppk   = ppk ? brutto * 0.015 : 0;
  const emp_total = emp_em + emp_rent + emp_wyp + emp_fp + emp_fgsp + emp_ppk;
  const totalCost = brutto + emp_total;

  // ---- Employee ZUS (deducted from gross) ----
  const ew_em    = limitedBase * 0.0976;
  const ew_rent  = limitedBase * 0.015;
  const ew_choro = limitedBase * 0.0245; // sickness also based on limitedBase
  const ew_ppk   = ppk ? brutto * 0.02 : 0;
  const ew_zus_social = ew_em + ew_rent + ew_choro;

  // Health contribution: base = gross − employee social contributions
  const healthBase = brutto - ew_zus_social;
  const ew_health  = healthBase * 0.09;

  // ---- KUP ----
  const KUP_AUTOR_LIMIT = 120000;
  let kup, kupAutorUsed = 0;
  if (autor) {
    const autorBase       = brutto * (autorPct / 100);
    const kupAutorRaw     = autorBase * autorKupRate;
    const autorRemaining  = Math.max(0, KUP_AUTOR_LIMIT - cumKupAutor);
    const kupAutor        = Math.min(kupAutorRaw, autorRemaining);
    const nonAutorBase    = brutto - autorBase;
    const kupStandard     = nonAutorBase > 0 ? (kupdoj ? 300 : 250) : 0;
    kup          = kupAutor + kupStandard;
    kupAutorUsed = kupAutor; // tracks annual KUP limit accumulation
  } else {
    kup = kupdoj ? 300 : 250;
  }


  // ---- PIT (Polski Ład 2022+) — YTD cumulative method ----
  // Monthly advance = tax(YTD incl. this month) − tax(YTD excl. this month)
  // This ensures the 30,000 and 120,000 zł brackets are applied in exactly the right month.


  let pit = 0;
  let pitDebug = {};
  let halfCombined = null;

  const pitBase = Math.max(0, Math.round(brutto - ew_zus_social - kup));

  if (pit0) {
    // Zerowy PIT — exemption up to 85,528 zł of annual taxable base
    const exemptRemaining = Math.max(0, PIT0_LIMIT - cumPitBase);
    const taxableBase     = Math.max(0, pitBase - exemptRemaining);

    if (taxableBase <= 0) {
      pit = 0;
      const usedBefore = cumPitBase;
      pitDebug = { exempt: true, pitBase, exemptRemaining, taxableBase: 0, usedBefore };
    } else {
      // Part or all of the month exceeds the Zerowy PIT limit.
      const ytdFull  = cumPitBase + pitBase;
      const prevFull = cumPitBase;

      let taxOnFull, taxOnPrev;
      if (joint) {
        // Joint PIT + Zerowy: employee's proportional share of combined tax
        const spouseYtd  = spouseIncome / 12 * (monthIdx + 1);
        const spousePrev = spouseIncome / 12 * monthIdx;
        const jointFull  = 2 * annualTaxScale((ytdFull  + spouseYtd)  / 2) - 2 * annualTaxScale((Math.min(ytdFull,  PIT0_LIMIT) + spouseYtd)  / 2);
        const jointPrev  = 2 * annualTaxScale((prevFull + spousePrev) / 2) - 2 * annualTaxScale((Math.min(prevFull, PIT0_LIMIT) + spousePrev) / 2);
        const workerShareFull = ytdFull > 0 ? ytdFull / (ytdFull + spouseYtd) : 0.5;
        const workerSharePrev = prevFull > 0 ? prevFull / (prevFull + spousePrev) : 0.5;
        taxOnFull = jointFull * workerShareFull;
        taxOnPrev = jointPrev * workerSharePrev;
        halfCombined = (ytdFull + spouseYtd) / 2;
      } else {
        // Zerowy only: scale on full YTD minus scale on exempt portion
        taxOnFull = annualTaxScale(ytdFull)  - annualTaxScale(Math.min(ytdFull,  PIT0_LIMIT));
        taxOnPrev = annualTaxScale(prevFull) - annualTaxScale(Math.min(prevFull, PIT0_LIMIT));
      }

      const taxThisMonth   = Math.max(0, taxOnFull - taxOnPrev);
      const pit2reduction  = pit2 ? Math.min(300, taxThisMonth) : 0;
      pit = Math.round(Math.max(0, taxThisMonth - pit2reduction));
      pitDebug = {
        exempt: false, pit0limitExceeded: true,
        pitBase, exemptRemaining, taxableBase,
        ytdFull, prevFull,
        monthlyTax: taxThisMonth,
        taxThisMonth, pit2reduction, pit,
        halfCombined: halfCombined ?? null,
      };
    }

  } else {
    // Standard YTD cumulative calculation
    const ytdBase  = cumPitBase + pitBase; // YTD base including this month
    const prevBase = cumPitBase;           // YTD base excluding this month

    let ytdTax, prevTax, halfCombined = null;

    if (joint) {
      // Joint PIT cumulative YTD calculation.
      // Spouse income is spread evenly — their YTD = spouseIncome / 12 * (monthIdx+1)
      const spouseYtd  = spouseIncome / 12 * (monthIdx + 1);
      const spousePrev = spouseIncome / 12 * monthIdx;
      halfCombined     = (ytdBase + spouseYtd) / 2; // for display purposes
      // Full joint YTD tax
      const ytdTaxJoint  = 2 * annualTaxScale((ytdBase  + spouseYtd)  / 2);
      const prevTaxJoint = 2 * annualTaxScale((prevBase + spousePrev) / 2);
      // Employee pays proportionally to their share of combined income
      const workerShare = ytdBase > 0 ? ytdBase / (ytdBase + spouseYtd) : 0.5;
      ytdTax  = ytdTaxJoint  * workerShare;
      prevTax = prevTaxJoint * (prevBase > 0 ? prevBase / (prevBase + spousePrev) : 0.5);
    } else {
      // Standard YTD: scale applied directly to cumulative base
      ytdTax  = annualTaxScale(ytdBase);
      prevTax = annualTaxScale(prevBase);
    }

    const taxThisMonth  = Math.max(0, ytdTax - prevTax);
    const pit2reduction = pit2 ? Math.min(300, taxThisMonth) : 0;
    pit = Math.round(Math.max(0, taxThisMonth - pit2reduction));

    pitDebug = {
      exempt: false,
      pitBase,
      ytdBase,          // YTD cumulative base incl. this month
      prevBase,         // YTD cumulative base excl. this month
      ytdTax,           // tax on YTD base
      prevTax,          // tax on previous YTD base
      taxThisMonth,     // tax for this month = ytdTax − prevTax
      monthlyTax: taxThisMonth,
      pit2reduction,
      halfCombined,
      pit,
      // for compatibility with bracket display
      annualBase: ytdBase,
      annualTax:  ytdTax,
    };
  }


  const netto = brutto - ew_zus_social - ew_health - pit - ew_ppk;

  return {
    brutto,
    totalCost,
    // employer
    emp_em, emp_rent, emp_wyp, emp_fp, emp_fgsp, emp_ppk, emp_total,
    // employee
    ew_em, ew_rent, ew_choro, ew_ppk, ew_zus_social,
    ew_health, kup, kupAutorUsed,
    pit, pitDebug,
    netto,
    // flags
    limitApplied: limitZUS && (limitedBase < brutto)
  };
}
