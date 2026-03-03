const OPENAI_API_URL = "https://api.openai.com/v1/responses";

export async function generateClinicalChatReply({ apiKey, model, message, analysisSummary, history = [] }) {
  if (!apiKey) {
    return "OpenAI API key is not configured on the server. Add OPENAI_API_KEY to your .env file.";
  }

  const systemPrompt = [
    "You are MediScan AI assistant.",
    "Be empathetic, clear, and practical in simple language.",
    "Do not claim to be a doctor. Mention emergency escalation for severe symptoms.",
    "Use report findings context when provided.",
    "Keep responses concise (5-9 lines), human, and action-oriented."
  ].join(" ");

  const historyText = history
    .slice(-8)
    .map((h) => `${h.role}: ${h.content}`)
    .join("\n");

  const userPayload = [
    "Patient report summary:",
    JSON.stringify(analysisSummary || {}, null, 2),
    "",
    "Chat history:",
    historyText || "No previous history.",
    "",
    `User question: ${message}`
  ].join("\n");

  const response = await fetch(OPENAI_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: model || "gpt-4.1-mini",
      input: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPayload }
      ]
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI API request failed (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  const text = data.output_text?.trim();
  if (text) return text;

  const fallbackText =
    data.output?.[0]?.content?.find((c) => c.type === "output_text")?.text?.trim() ||
    "I could not generate a response right now. Please try again.";
  return fallbackText;
}

export async function generateReportAiInterpretation({ apiKey, model, reportText, extracted, analysis }) {
  if (!apiKey) {
    return {
      rawText: "AI interpretation is unavailable because OPENAI_API_KEY is not configured.",
      sections: {
        personalGuidance:
          "I understand these findings can feel stressful, but many report patterns improve with timely follow-up and consistent care. Please review your report with your doctor and follow a practical plan for diet, activity, and repeat tests.",
        symptoms: ["Based on values only: symptoms can vary person to person."],
        possibleCause: ["Unable to generate AI cause summary without API key."],
        diet: ["Prefer balanced diet with hydration and reduced processed sugar/salt."],
        medicinesToAskDoctor: ["Ask your doctor whether medicines are needed after confirmatory tests."],
        followUpTests: ["Repeat relevant lab tests and consult a physician."],
        safetyNote: "This is educational guidance, not a diagnosis."
      }
    };
  }

  const systemPrompt = [
    "You are MediScan AI clinical explainer.",
    "Provide educational, non-diagnostic interpretation of medical report findings.",
    "Keep language empathetic, clear, and human.",
    "Output ONLY valid JSON with no markdown, no code fences, no extra text.",
    "JSON schema:",
    "{",
    '  "personalGuidance": string,',
    '  "symptoms": string[],',
    '  "possibleCause": string[],',
    '  "diet": string[],',
    '  "medicinesToAskDoctor": string[],',
    '  "followUpTests": string[],',
    '  "safetyNote": string',
    "}",
    "Each array should have 3-6 concise bullet-like lines.",
    "Do not claim to be a doctor. Include a short safety disclaimer."
  ].join(" ");

  const trimmedReport = String(reportText || "").slice(0, 5000);

  const userPayload = [
    "Raw report text:",
    trimmedReport || "No raw report text provided.",
    "",
    "Extracted values:",
    JSON.stringify(extracted || {}, null, 2),
    "",
    "Rule-based analysis result:",
    JSON.stringify(analysis || {}, null, 2),
    "",
    "Write a concise patient-friendly interpretation."
  ].join("\n");

  const response = await fetch(OPENAI_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: model || "gpt-4.1-mini",
      input: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPayload }
      ]
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI API request failed (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  const raw =
    data.output_text?.trim() ||
    data.output?.[0]?.content?.find((c) => c.type === "output_text")?.text?.trim() ||
    "";

  const safeFallback = {
    personalGuidance:
      "I understand this report may feel concerning. Many findings can be managed with early follow-up, practical lifestyle changes, and guided treatment. Please discuss these results with your doctor and repeat abnormal tests as recommended.",
    symptoms: ["Symptoms depend on person and severity. Confirm with doctor examination."],
    possibleCause: ["Your report suggests findings that need clinical correlation and repeat testing."],
    diet: ["Choose balanced meals with vegetables, protein, fiber, and adequate hydration."],
    medicinesToAskDoctor: ["Ask if medicines are needed only after diagnosis is confirmed."],
    followUpTests: ["Repeat abnormal values and perform doctor-recommended confirmatory tests."],
    safetyNote: "This is educational guidance, not a diagnosis."
  };

  try {
    const parsed = JSON.parse(raw);
    return {
      rawText: raw,
      sections: {
        personalGuidance:
          typeof parsed.personalGuidance === "string" && parsed.personalGuidance.trim()
            ? parsed.personalGuidance
            : safeFallback.personalGuidance,
        symptoms: Array.isArray(parsed.symptoms) ? parsed.symptoms : safeFallback.symptoms,
        possibleCause: Array.isArray(parsed.possibleCause) ? parsed.possibleCause : safeFallback.possibleCause,
        diet: Array.isArray(parsed.diet) ? parsed.diet : safeFallback.diet,
        medicinesToAskDoctor: Array.isArray(parsed.medicinesToAskDoctor)
          ? parsed.medicinesToAskDoctor
          : safeFallback.medicinesToAskDoctor,
        followUpTests: Array.isArray(parsed.followUpTests) ? parsed.followUpTests : safeFallback.followUpTests,
        safetyNote: typeof parsed.safetyNote === "string" ? parsed.safetyNote : safeFallback.safetyNote
      }
    };
  } catch {
    return {
      rawText: raw || "AI interpretation could not be generated right now.",
      sections: safeFallback
    };
  }
}
