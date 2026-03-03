import "dotenv/config";
import cors from "cors";
import express from "express";
import multer from "multer";
import { buildAnalysis, extractMetricsFromText } from "./analysis.js";
import { createOtpChallenge, verifyOtpChallenge } from "./auth.js";
import { bloodSupportCenters, consentedDonors, doctors } from "./data.js";
import { fetchNearbyDoctorsFromGoogle } from "./googleDoctors.js";
import { extractTextFromFile } from "./ocr.js";
import { generateClinicalChatReply, generateReportAiInterpretation } from "./openai.js";
import { fetchNearbyDoctors } from "./realDoctors.js";
import { buildAuthPayload, updateUserProfile } from "./users.js";

const app = express();
const port = Number(process.env.PORT || 4000);
const DOCTOR_CACHE_TTL_MS = Number(process.env.DOCTOR_CACHE_TTL_MS || 10 * 60 * 1000);
const doctorNearbyCache = new Map();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }
});

function buildDoctorCacheKey(location, specialty) {
  return `${String(location || "").trim().toLowerCase()}|${String(specialty || "").trim().toLowerCase()}`;
}

function getCachedDoctors(key) {
  const cached = doctorNearbyCache.get(key);
  if (!cached) return null;
  if (Date.now() > cached.expiresAt) {
    doctorNearbyCache.delete(key);
    return null;
  }
  return cached.payload;
}

function setCachedDoctors(key, payload) {
  doctorNearbyCache.set(key, {
    expiresAt: Date.now() + DOCTOR_CACHE_TTL_MS,
    payload
  });
}

app.use(cors());
app.use(express.json({ limit: "2mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "MediScan AI API" });
});

app.post("/api/auth/request-otp", async (req, res) => {
  try {
    const { email, name } = req.body || {};
    const normalizedEmail = String(email || "").trim().toLowerCase();
    const requesterIp = String(req.headers["x-forwarded-for"] || req.ip || "unknown")
      .split(",")[0]
      .trim();

    if (!normalizedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      return res.status(400).json({ error: "Valid email is required." });
    }

    const result = await createOtpChallenge({
      email: normalizedEmail,
      name: String(name || "").trim(),
      requesterIp
    });

    return res.json({
      success: true,
      message: "OTP sent successfully.",
      expiresInSec: result.expiresInSec,
      resendCooldownSec: result.resendCooldownSec,
      devOtp: result.devOtp
    });
  } catch (error) {
    if (error?.statusCode === 429) {
      return res.status(429).json({
        error: error.message || "Too many OTP requests. Please try again later.",
        retryAfterSec: error.retryAfterSec || 30
      });
    }
    return res.status(500).json({ error: "Failed to send OTP.", details: error.message });
  }
});

app.post("/api/auth/verify-otp", (req, res) => {
  try {
    const { email, otp, name } = req.body || {};
    const normalizedEmail = String(email || "").trim().toLowerCase();
    const normalizedOtp = String(otp || "").trim();

    if (!normalizedEmail || !normalizedOtp) {
      return res.status(400).json({ error: "Email and OTP are required." });
    }

    const auth = verifyOtpChallenge({
      email: normalizedEmail,
      otp: normalizedOtp,
      name: String(name || "").trim()
    });

    const payload = buildAuthPayload({
      token: auth.token,
      email: auth.user.email,
      defaultName: auth.user.name
    });

    return res.json(payload);
  } catch (error) {
    return res.status(400).json({ error: error.message || "OTP verification failed." });
  }
});

app.post("/api/users/profile", (req, res) => {
  try {
    const { email, name, age, bloodGroup, gender, phone, photoDataUrl } = req.body || {};
    const result = updateUserProfile({
      email,
      name,
      age,
      bloodGroup,
      gender,
      phone,
      photoDataUrl
    });
    return res.json(result);
  } catch (error) {
    return res.status(400).json({ error: error.message || "Profile update failed." });
  }
});

app.post("/api/reports/analyze", async (req, res) => {
  try {
    const { reportText = "", manualValues = {} } = req.body || {};
    const extractedFromText = extractMetricsFromText(reportText);
    const merged = { ...extractedFromText, ...manualValues };
    const analysis = buildAnalysis(merged);

    let aiInterpretation = "";
    let aiInterpretationSections = null;
    try {
      const aiResult = await generateReportAiInterpretation({
        apiKey: process.env.OPENAI_API_KEY,
        model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
        reportText,
        extracted: merged,
        analysis
      });
      aiInterpretation = aiResult.rawText || "";
      aiInterpretationSections = aiResult.sections || null;
    } catch (aiError) {
      aiInterpretation = `AI interpretation failed: ${aiError.message}`;
      aiInterpretationSections = null;
    }

    return res.json({
      ...analysis,
      aiInterpretation,
      aiInterpretationSections
    });
  } catch (error) {
    return res.status(500).json({
      error: "Report analysis failed.",
      details: error.message
    });
  }
});

app.post("/api/reports/extract-text", upload.single("file"), async (req, res) => {
  try {
    const file = req.file;
    if (!file) {
      return res.status(400).json({ error: "File is required." });
    }

    const extracted = await extractTextFromFile(file);
    if (!extracted.extractedText) {
      return res.status(422).json({
        error: "No readable text found in file. Try a clearer file or enter values manually."
      });
    }

    return res.json({
      extractedText: extracted.extractedText,
      source: extracted.source
    });
  } catch (error) {
    if (error?.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({ error: "File too large. Max allowed size is 10MB." });
    }
    return res.status(500).json({
      error: "Failed to extract text from file.",
      details: error.message
    });
  }
});

app.post("/api/chat", async (req, res) => {
  try {
    const { message, analysisSummary, history } = req.body || {};
    if (!message || !String(message).trim()) {
      return res.status(400).json({ error: "Message is required." });
    }

    const reply = await generateClinicalChatReply({
      apiKey: process.env.OPENAI_API_KEY,
      model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
      message: String(message),
      analysisSummary,
      history: Array.isArray(history) ? history : []
    });

    return res.json({ reply });
  } catch (error) {
    return res.status(500).json({
      error: "Chat generation failed.",
      details: error.message
    });
  }
});

app.get("/api/doctors", (req, res) => {
  const specialty = String(req.query.specialty || "").toLowerCase();
  const city = String(req.query.city || "").toLowerCase();

  let filtered = doctors;
  if (specialty) {
    filtered = filtered.filter((doc) => doc.specialty.toLowerCase().includes(specialty));
  }
  if (city) {
    filtered = filtered.filter((doc) => doc.city.toLowerCase().includes(city));
  }

  filtered = [...filtered].sort((a, b) => a.distanceKm - b.distanceKm);
  res.json({ doctors: filtered });
});

app.get("/api/doctors/nearby", async (req, res) => {
  const location = String(req.query.location || "").trim();
  const specialty = String(req.query.specialty || "").trim();

  if (!location) {
    return res.status(400).json({ error: "Location is required." });
  }

  const cacheKey = buildDoctorCacheKey(location, specialty);
  const cachedPayload = getCachedDoctors(cacheKey);
  if (cachedPayload) {
    return res.json({ ...cachedPayload, cached: true });
  }

  const failures = [];

  try {
    const googleResult = await fetchNearbyDoctorsFromGoogle({
      apiKey: process.env.GOOGLE_MAPS_API_KEY,
      location,
      specialty,
      limit: 12
    });
    if (googleResult.doctors?.length) {
      const payload = {
        ...googleResult,
        source: "google_places",
        fallbackLevel: 0
      };
      setCachedDoctors(cacheKey, payload);
      return res.json(payload);
    }
  } catch (error) {
    failures.push(`Google: ${error.message}`);
  }

  try {
    const osmResult = await fetchNearbyDoctors({
      location,
      specialty,
      radiusMeters: 12000,
      limit: 12
    });
    if (osmResult.doctors?.length) {
      const payload = {
        ...osmResult,
        source: "openstreetmap",
        fallbackLevel: 1,
        warnings: failures
      };
      setCachedDoctors(cacheKey, payload);
      return res.json(payload);
    }
  } catch (error) {
    failures.push(`OpenStreetMap: ${error.message}`);
  }

  // Always return a usable fallback list instead of hard-failing.
  let fallbackDoctors = doctors
    .filter((d) => {
      if (!specialty) return true;
      const keyword = specialty.toLowerCase();
      return d.specialty.toLowerCase().includes(keyword) || d.name.toLowerCase().includes(keyword);
    })
    .slice(0, 8);

  if (fallbackDoctors.length === 0) {
    fallbackDoctors = doctors.slice(0, 8);
  }

  const payload = {
    center: { location, lat: null, lon: null },
    doctors: fallbackDoctors.map((d, idx) => ({
      id: `fallback-${d.id}`,
      name: d.name,
      specialty: d.specialty,
      address: `${d.area}, ${d.city}`,
      distanceKm: d.distanceKm ?? Number((2 + idx * 0.8).toFixed(1)),
      source: "MediScan Fallback"
    })),
    source: "fallback_local",
    fallbackLevel: 2,
    warnings: failures.length ? failures : ["No live providers were reachable at this moment."]
  };

  setCachedDoctors(cacheKey, payload);
  return res.json(payload);
});

app.post("/api/blood/register-consent", (req, res) => {
  const { name, bloodGroup, city, area, phone } = req.body || {};
  if (!name || !bloodGroup || !city || !area || !phone) {
    return res.status(400).json({ error: "Name, blood group, city, area, and phone are required." });
  }

  const entry = {
    id: `dn-${consentedDonors.length + 1}`,
    name,
    bloodGroup: bloodGroup.toUpperCase(),
    city,
    area,
    phone
  };

  consentedDonors.push(entry);
  return res.json({ success: true, donor: entry });
});

app.get("/api/blood/search", (req, res) => {
  const bloodGroup = String(req.query.bloodGroup || "").toUpperCase();
  const city = String(req.query.city || "").toLowerCase();

  const centers = bloodSupportCenters.filter((item) => {
    const matchesGroup = bloodGroup ? item.bloodGroup === bloodGroup : true;
    const matchesCity = city ? item.city.toLowerCase().includes(city) : true;
    return matchesGroup && matchesCity;
  });

  const donors = consentedDonors.filter((item) => {
    const matchesGroup = bloodGroup ? item.bloodGroup === bloodGroup : true;
    const matchesCity = city ? item.city.toLowerCase().includes(city) : true;
    return matchesGroup && matchesCity;
  });

  res.json({ centers, donors });
});

app.listen(port, () => {
  console.log(`MediScan AI server running on http://localhost:${port}`);
});
