const express = require("express");
const cors = require("cors");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { exec } = require("child_process");
const crypto = require("crypto");

const app = express();
app.use(cors());

const upload = multer({
  dest: "uploads/",
  limits: { fileSize: 100 * 1024 * 1024 },
});

// targetExt = what we ask LibreOffice to produce
// fallbackExts = other extensions LibreOffice might actually output
const CONVERSIONS = {
  "word-pdf":  { targetExt: "pdf",  args: '--convert-to pdf',                    fallbackExts: ["pdf"] },
  "excel-pdf": { targetExt: "pdf",  args: '--convert-to pdf',                    fallbackExts: ["pdf"] },
  "ppt-pdf":   { targetExt: "pdf",  args: '--convert-to pdf',                    fallbackExts: ["pdf"] },
  "pdf-word":  { targetExt: "docx", args: '--convert-to docx',                   fallbackExts: ["docx","doc","odt"] },
  "pdf-excel": { targetExt: "ods",  args: '--convert-to ods',                    fallbackExts: ["ods","xlsx","xls","csv"] },
  "pdf-ppt":   { targetExt: "pptx", args: '--convert-to pptx',                   fallbackExts: ["pptx","ppt","odp"] },
};

// Env that prevents LibreOffice display/Java init errors in headless Docker
const LO_ENV = Object.assign({}, process.env, {
  HOME:               "/tmp",
  SAL_USE_VCLPLUGIN:  "svp",
  DISPLAY:            "",
});

app.get("/", (_req, res) => res.send("QuikConvert backend running ✓"));

app.post("/api/convert", upload.single("file"), (req, res) => {
  let inputPath  = null;
  let loUserDir  = null;

  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    const convKey = req.body.type || "word-pdf";
    const conv    = CONVERSIONS[convKey];
    if (!conv) return res.status(400).json({ error: `Unknown type: ${convKey}` });

    // Give LibreOffice the correct file extension so it auto-detects format
    const origExt = path.extname(req.file.originalname).toLowerCase() || ".pdf";
    inputPath     = req.file.path + origExt;
    fs.renameSync(req.file.path, inputPath);

    const outputDir = path.join(__dirname, "converted");
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

    // Unique per-request user installation dir avoids profile locking across concurrent requests
    const uid   = crypto.randomBytes(6).toString("hex");
    loUserDir   = `/tmp/lo_${uid}`;
    const loUrl = `file://${loUserDir}`;

    const cmd = [
      "libreoffice",
      "--headless",
      "--norestore",
      "--nofirststartwizard",
      `-env:UserInstallation="${loUrl}"`,
      conv.args,
      `"${inputPath}"`,
      `--outdir "${outputDir}"`,
    ].join(" ");

    exec(cmd, { timeout: 180000, env: LO_ENV }, (error, stdout, stderr) => {
      // Clean up input and temp profile
      try { fs.unlinkSync(inputPath); inputPath = null; } catch (_) {}
      try { fs.rmSync(loUserDir, { recursive: true, force: true }); loUserDir = null; } catch (_) {}

      // javaldx warning is non-fatal — only fail on real errors
      const isRealError = error && !/javaldx/i.test(stderr);
      if (isRealError) {
        console.error("LibreOffice error:", stderr || error.message);
        return res.status(500).json({ error: "Conversion failed: " + (stderr || error.message).slice(0, 300) });
      }

      const inputBase = path.parse(inputPath || req.file.path).name + origExt.slice(0, -origExt.length + path.parse(inputPath || req.file.path).name.length + origExt.length);
      const baseName  = path.parse(req.file.path).name + origExt.replace(/\.[^.]+$/, "");

      // Scan output dir: try all known fallback extensions first
      let convertedPath = null;
      for (const ext of conv.fallbackExts) {
        const candidate = path.join(outputDir, `${path.parse(req.file.path).name}${origExt.replace(/\.[^.]+$/, "")}.${ext}`);
        if (fs.existsSync(candidate)) { convertedPath = candidate; break; }
      }

      // Broader scan: any file in outputDir starting with the base name
      if (!convertedPath) {
        const base = path.parse(req.file.path).name;
        const files = fs.readdirSync(outputDir).filter(f => f.startsWith(base));
        if (files.length > 0) {
          files.sort((a, b) => fs.statSync(path.join(outputDir, b)).mtimeMs - fs.statSync(path.join(outputDir, a)).mtimeMs);
          convertedPath = path.join(outputDir, files[0]);
        }
      }

      if (!convertedPath) {
        const hint = convKey.startsWith("pdf-")
          ? "This PDF may be image-only (scanned). Try converting with online OCR tools first."
          : "Conversion produced no output. The file may be password-protected.";
        return res.status(500).json({ error: hint });
      }

      const actualExt   = path.extname(convertedPath).slice(1);
      const origBase    = path.parse(req.file.originalname).name;
      const downloadName = `${origBase}.${actualExt}`;

      res.download(convertedPath, downloadName, (err) => {
        try { fs.unlinkSync(convertedPath); } catch (_) {}
        if (err && !res.headersSent) res.status(500).json({ error: "Download failed" });
      });
    });

  } catch (err) {
    console.error("Server error:", err);
    try { if (inputPath) fs.unlinkSync(inputPath); } catch (_) {}
    try { if (loUserDir) fs.rmSync(loUserDir, { recursive: true, force: true }); } catch (_) {}
    if (!res.headersSent) res.status(500).json({ error: "Server error: " + err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`QuikConvert backend on port ${PORT}`));
