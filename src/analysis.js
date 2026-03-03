const REF_RANGES = {
  fastingGlucose: { low: 70, high: 99, prediabetes: 125 },
  hba1c: { normal: 5.6, prediabetes: 6.4 },
  alt: { high: 56 },
  ast: { high: 40 },
  creatinine: { high: 1.3 },
  tsh: { low: 0.4, high: 4.5 },
  hemoglobin: { anemia: 12.0 }
};

const METRIC_PATTERNS = {
  fastingGlucose: [/fasting\s*glucose[^0-9]*([0-9]+(?:\.[0-9]+)?)/i, /glucose[^0-9]*([0-9]+(?:\.[0-9]+)?)/i],
  hba1c: [/hba1c[^0-9]*([0-9]+(?:\.[0-9]+)?)/i, /glycated\s*hemoglobin[^0-9]*([0-9]+(?:\.[0-9]+)?)/i],
  alt: [/\balt\b[^0-9]*([0-9]+(?:\.[0-9]+)?)/i, /sgpt[^0-9]*([0-9]+(?:\.[0-9]+)?)/i],
  ast: [/\bast\b[^0-9]*([0-9]+(?:\.[0-9]+)?)/i, /sgot[^0-9]*([0-9]+(?:\.[0-9]+)?)/i],
  creatinine: [/creatinine[^0-9]*([0-9]+(?:\.[0-9]+)?)/i],
  tsh: [/\btsh\b[^0-9]*([0-9]+(?:\.[0-9]+)?)/i],
  hemoglobin: [/hemoglobin[^0-9]*([0-9]+(?:\.[0-9]+)?)/i, /\bhb\b[^0-9]*([0-9]+(?:\.[0-9]+)?)/i]
};

function parseMetric(reportText, patterns) {
  for (const pattern of patterns) {
    const match = reportText.match(pattern);
    if (match && match[1]) {
      return Number.parseFloat(match[1]);
    }
  }
  return null;
}

export function extractMetricsFromText(reportText = "") {
  const extracted = {};
  const rawText = String(reportText);

  Object.entries(METRIC_PATTERNS).forEach(([key, patterns]) => {
    extracted[key] = parseMetric(rawText, patterns);
  });

  return extracted;
}

export function buildAnalysis(extracted) {
  const issues = [];
  const guidance = [];
  const tests = {};
  let highestSeverity = "low";

  const setSeverity = (newLevel) => {
    const rank = { low: 1, moderate: 2, high: 3 };
    if (rank[newLevel] > rank[highestSeverity]) {
      highestSeverity = newLevel;
    }
  };

  const fg = extracted.fastingGlucose;
  const hba1c = extracted.hba1c;
  if (fg != null || hba1c != null) {
    let diabetesStatus = "normal";
    if ((fg != null && fg >= 126) || (hba1c != null && hba1c >= 6.5)) {
      diabetesStatus = "high_risk";
      issues.push("Possible diabetes pattern");
      guidance.push("Please book a physician/endocrinology consultation soon for confirmatory testing.");
      setSeverity("high");
    } else if ((fg != null && fg >= 100) || (hba1c != null && hba1c >= 5.7)) {
      diabetesStatus = "moderate_risk";
      issues.push("Possible prediabetes pattern");
      guidance.push("Discuss lifestyle changes and follow-up labs with your doctor.");
      setSeverity("moderate");
    }
    tests.diabetes = {
      status: diabetesStatus,
      fastingGlucose: fg,
      hba1c
    };
  }

  const alt = extracted.alt;
  const ast = extracted.ast;
  if (alt != null || ast != null) {
    let lftStatus = "normal";
    if ((alt != null && alt > REF_RANGES.alt.high) || (ast != null && ast > REF_RANGES.ast.high)) {
      lftStatus = "high_risk";
      issues.push("Possible liver function abnormality");
      guidance.push("Avoid alcohol and consult a clinician for full LFT interpretation.");
      setSeverity("moderate");
    }
    tests.lft = {
      status: lftStatus,
      alt,
      ast
    };
  }

  const creatinine = extracted.creatinine;
  if (creatinine != null) {
    let kftStatus = "normal";
    if (creatinine > REF_RANGES.creatinine.high) {
      kftStatus = "high_risk";
      issues.push("Possible kidney function concern");
      guidance.push("Stay hydrated and seek nephrology/physician review if persistent.");
      setSeverity("high");
    }
    tests.kft = {
      status: kftStatus,
      creatinine
    };
  }

  const tsh = extracted.tsh;
  if (tsh != null) {
    let thyroidStatus = "normal";
    if (tsh > REF_RANGES.tsh.high || tsh < REF_RANGES.tsh.low) {
      thyroidStatus = "moderate_risk";
      issues.push("Possible thyroid imbalance");
      guidance.push("Consider thyroid profile follow-up with an endocrinologist.");
      setSeverity("moderate");
    }
    tests.thyroid = {
      status: thyroidStatus,
      tsh
    };
  }

  const hemoglobin = extracted.hemoglobin;
  if (hemoglobin != null) {
    let cbcStatus = "normal";
    if (hemoglobin < REF_RANGES.hemoglobin.anemia) {
      cbcStatus = "high_risk";
      issues.push("Possible anemia");
      guidance.push("Discuss iron, B12, and folate workup with your doctor.");
      setSeverity("high");
    }
    tests.cbc = {
      status: cbcStatus,
      hemoglobin
    };
  }

  const specialistMap = {
    "Possible diabetes pattern": "Endocrinologist",
    "Possible prediabetes pattern": "Endocrinologist",
    "Possible liver function abnormality": "Gastroenterologist",
    "Possible kidney function concern": "Nephrologist",
    "Possible thyroid imbalance": "Endocrinologist",
    "Possible anemia": "Hematologist"
  };

  const specialists = [...new Set(issues.map((issue) => specialistMap[issue]).filter(Boolean))];

  return {
    riskLevel: highestSeverity,
    extracted,
    tests,
    detectedIssues: issues,
    clinicalGuidance: guidance,
    recommendedSpecialists: specialists,
    disclaimer:
      "This is AI-assisted screening guidance, not a confirmed diagnosis. Please consult a licensed doctor."
  };
}
