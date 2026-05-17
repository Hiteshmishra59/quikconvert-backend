const express = require("express");
const cors = require("cors");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { exec } = require("child_process");

const app = express();
app.use(cors());

// Allow large uploads (100 MB)
const upload = multer({
  dest: "uploads/",
  limits: { fileSize: 100 * 1024 * 1024 },
});

// Conversion map — targetExt is what LibreOffice outputs
const CONVERSIONS = {
  "word-pdf":  { targetExt: "pdf",  args: "--convert-to pdf" },
  "excel-pdf": { targetExt: "pdf",  args: '--convert-to pdf:"calc_pdf_Export:PageRange=,IsSkipEmptyPages=false"' },
  "ppt-pdf":   { targetExt: "pdf",  args: "--convert-to pdf" },
  "pdf-word":  { targetExt: "docx", args: '--convert-to docx:"Microsoft Word 2007-2019 XML (.docx)"' },
  "pdf-excel": { targetExt: "xlsx", args: '--convert-to xlsx:"Calc MS Excel 2007 XML"' },
  "pdf-ppt":   { targetExt: "pptx", args: '--convert-to pptx:"Impress MS PowerPoint 2007 XML"' },
};

// Possible output extensions LibreOffice might produce
const FALLBACK_EXTS = {
  "pdf":  ["pdf"],
  "docx": ["docx", "doc", "odt"],
  "xlsx": ["xlsx", "xls", "ods", "csv"],
  "pptx": ["pptx", "ppt", "odp"],
};

app.get("/", (_req, res) => res.send("QuikConvert backend running ✓"));

app.post("/api/convert", upload.single("file"), (req, res) => {
  let inputPath = null;

  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    const type = req.body.type || "";
    const ext  = path.extname(req.file.originalname).toLowerCase();

    const conversionKey = type || (ext === ".pdf" ? "pdf-word" : "word-pdf");
    const conv = CONVERSIONS[conversionKey];
    if (!conv) return res.status(400).json({ error: `Unknown conversion type: ${conversionKey}` });

    // Rename temp file so LibreOffice can detect format from extension
    inputPath = req.file.path + ext;
    fs.renameSync(req.file.path, inputPath);

    const outputDir = path.join(__dirname, "converted");
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

    const inputBaseName = path.parse(inputPath).name;
    const command = `libreoffice --headless ${conv.args} "${inputPath}" --outdir "${outputDir}"`;

    exec(command, { timeout: 180000 }, (error, stdout, stderr) => {
      // Always clean up input
      try { fs.unlinkSync(inputPath); inputPath = null; } catch (_) {}

      if (error) {
        console.error("LibreOffice error:", stderr || error.message);
        return res.status(500).json({ error: "Conversion failed. " + (stderr || error.message).slice(0, 200) });
      }

      // Search output dir for the converted file — try primary ext then fallbacks
      const tryExts = FALLBACK_EXTS[conv.targetExt] || [conv.targetExt];
      let convertedPath = null;
      for (const tryExt of tryExts) {
        const candidate = path.join(outputDir, `${inputBaseName}.${tryExt}`);
        if (fs.existsSync(candidate)) { convertedPath = candidate; break; }
      }

      // Last resort: scan output dir for any new file starting with the base name
      if (!convertedPath) {
        const files = fs.readdirSync(outputDir).filter(f => f.startsWith(inputBaseName));
        if (files.length > 0) convertedPath = path.join(outputDir, files[0]);
      }

      if (!convertedPath) {
        console.error("No converted file found. stdout:", stdout, "stderr:", stderr);
        return res.status(500).json({ error: "Conversion produced no output. The file may be password-protected or unsupported." });
      }

      const actualExt   = path.extname(convertedPath).slice(1);
      const originalBase = path.parse(req.file.originalname).name;
      const downloadName = `${originalBase}.${actualExt}`;

      res.download(convertedPath, downloadName, (err) => {
        try { fs.unlinkSync(convertedPath); } catch (_) {}
        if (err && !res.headersSent) res.status(500).json({ error: "Download failed" });
      });
    });

  } catch (err) {
    console.error("Server error:", err);
    try { if (inputPath) fs.unlinkSync(inputPath); } catch (_) {}
    if (!res.headersSent) res.status(500).json({ error: "Server error: " + err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`QuikConvert backend started on port ${PORT}`));
