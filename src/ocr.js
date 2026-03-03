import path from "node:path";
import pdfParse from "pdf-parse";
import Tesseract from "tesseract.js";

const OCR_LANGUAGE = process.env.OCR_LANGUAGE || "eng";

function normalizeExtractedText(text = "") {
  return String(text)
    .replace(/\r\n/g, "\n")
    .replace(/\u0000/g, "")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

function detectFileType(file) {
  const ext = path.extname(file.originalname || "").toLowerCase();
  const mime = String(file.mimetype || "").toLowerCase();

  const isText =
    mime.startsWith("text/") || [".txt", ".csv", ".json"].includes(ext);
  const isPdf = mime === "application/pdf" || ext === ".pdf";
  const isImage =
    mime.startsWith("image/") ||
    [".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff"].includes(ext);

  return { isText, isPdf, isImage };
}

export async function extractTextFromFile(file) {
  if (!file?.buffer) {
    throw new Error("No file content found.");
  }

  const { isText, isPdf, isImage } = detectFileType(file);

  if (isText) {
    return {
      extractedText: normalizeExtractedText(file.buffer.toString("utf8")),
      source: "text"
    };
  }

  if (isPdf) {
    const data = await pdfParse(file.buffer);
    return {
      extractedText: normalizeExtractedText(data.text || ""),
      source: "pdf"
    };
  }

  if (isImage) {
    const result = await Tesseract.recognize(file.buffer, OCR_LANGUAGE);
    return {
      extractedText: normalizeExtractedText(result?.data?.text || ""),
      source: "image_ocr"
    };
  }

  throw new Error("Unsupported file type for extraction.");
}
