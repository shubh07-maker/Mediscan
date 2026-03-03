# MediScan AI

Full-stack starter for your project idea:
- Email OTP login and dashboard flow
- Upload/paste medical report text
- AI-based risk analysis for 5 tests: Diabetes, LFT, KFT, Thyroid, CBC
- Clinical guidance summary
- OpenAI API chatbot integration
- Nearby doctor recommendation API
- Blood bank + NGO consent/search module

## Tech Stack

- Frontend: React + Vite
- Backend: Node.js + Express
- AI Chatbot: OpenAI API (`/v1/responses`)

## Project Structure

```text
MediScan AI/
  client/
  server/
  .env.example
  mediscan-theme.svg
```

## Setup

1. Install Node.js 18+ (includes npm).
2. Copy `.env.example` to `server/.env` for backend config.
3. Add your OpenAI key:

```env
OPENAI_API_KEY=your_key_here
OPENAI_MODEL=gpt-4.1-mini
PORT=4000
OTP_SECRET=change_this_to_a_random_secret
OTP_TTL_MS=600000
OTP_MAX_ATTEMPTS=5
OTP_RESEND_COOLDOWN_MS=30000
OTP_RATE_LIMIT_WINDOW_MS=900000
OTP_RATE_LIMIT_MAX_PER_IP=10
OTP_RATE_LIMIT_MAX_PER_EMAIL=5
OCR_LANGUAGE=eng
GOOGLE_MAPS_API_KEY=your_google_maps_api_key
DOCTOR_CACHE_TTL_MS=600000
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your_email@example.com
SMTP_PASS=your_app_password
SMTP_FROM="MediScan AI <your_email@example.com>"
VITE_API_URL=http://localhost:4000
```

4. Install dependencies:

```bash
cd server && npm install
cd ../client && npm install
```

5. Start backend:

```bash
cd server
npm run dev
```

6. Start frontend in another terminal:

```bash
cd client
npm run dev
```

7. Open `http://localhost:5173`.

## API Endpoints

- `POST /api/auth/request-otp`
- `POST /api/auth/verify-otp`
- `POST /api/users/profile`
- `POST /api/reports/extract-text`
- `POST /api/reports/analyze`
- `POST /api/chat`
- `GET /api/doctors`
- `GET /api/doctors/nearby`
- `POST /api/blood/register-consent`
- `GET /api/blood/search`

## Important Notes

- This is a project starter and demo logic. It is not a certified medical device.
- Always show medical disclaimer in production.
- Add proper auth, DB, encryption, audit logs, and regulatory controls before real deployment.
- If SMTP is not configured, OTP is printed in server logs and shown as `Dev OTP` in UI for testing.
- OTP resend cooldown and request limits are enabled by default (configurable in `server/.env`).
- OCR supports text extraction from images and PDFs before analysis.
- Nearby doctors API uses Google Places first (if API key exists), then OpenStreetMap, then local fallback.
- Nearby doctor results are cached on server for 10 minutes by default.
