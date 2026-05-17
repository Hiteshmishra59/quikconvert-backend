const express = require("express");
const cors = require("cors");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { exec } = require("child_process");

const app = express();
app.use(cors());

const upload = multer({ dest: "uploads/" });

// Map conversion type → { targetExt, libreArgs }
const CONVERSIONS = {
  "word-pdf":  { targetExt: "pdf",  args: "--convert-to pdf" },
  "excel-pdf": { targetExt: "pdf",  args: "--convert-to pdf" },
  "ppt-pdf":   { targetExt: "pdf",  args: "--convert-to pdf" },
  "pdf-word":  { targetExt: "docx", args: "--infilter=\"writer_pdf_import\" --convert-to docx" },
  "pdf-excel": { targetExt: "xlsx", args: "--infilter=\"calc_pdf_import\" --convert-to xlsx" },
  "pdf-ppt":   { targetExt: "pptx", args: "--infilter=\"impress_pdf_import\" --convert-to pptx" },
};

app.get("/", (req, res) => res.send("QuikConvert backend running"));

app.post("/api/convert", upload.single("file"), (req, res) => {
  let inputPath = null;
  let convertedPath = null;

  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    // Determine conversion type from request body or auto-detect
    const type = req.body.type || "";
    const ext = path.extname(req.file.originalname).toLowerCase();

    let conversionKey = type;
    if (!conversionKey) {
      // Auto-detect: non-pdf → pdf, pdf → docx
      conversionKey = ext === ".pdf" ? "pdf-word" : "word-pdf";
    }

    const conv = CONVERSIONS[conversionKey];
    if (!conv) {
      return res.status(400).json({ error: `Unknown conversion type: ${conversionKey}` });
    }

    // Rename temp upload to include original extension (LibreOffice needs it)
    inputPath = req.file.path + ext;
    fs.renameSync(req.file.path, inputPath);

    const outputDir = path.join(__dirname, "converted");
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

    // LibreOffice uses the input file's basename (without ext) as output name
    const inputBaseName = path.parse(inputPath).name;
    convertedPath = path.join(outputDir, `${inputBaseName}.${conv.targetExt}`);

    const command = `libreoffice --headless ${conv.args} "${inputPath}" --outdir "${outputDir}"`;

    exec(command, { timeout: 120000 }, (error, stdout, stderr) => {
      // Clean up input file
      try { if (inputPath && fs.existsSync(inputPath)) fs.unlinkSync(inputPath); } catch (_) {}

      if (error) {
        console.error("LibreOffice error:", stderr || error.message);
        return res.status(500).json({ error: "Conversion failed. Make sure LibreOffice is installed." });
      }

      if (!fs.existsSync(convertedPath)) {
        // LibreOffice sometimes changes the extension — scan output dir for the file
        const files = fs.readdirSync(outputDir).filter(f => f.startsWith(inputBaseName));
        if (files.length > 0) {
          convertedPath = path.join(outputDir, files[0]);
        } else {
          console.error("No converted file found in", outputDir, "| stdout:", stdout);
          return res.status(500).json({ error: "No converted file found" });
        }
      }

      // Build a clean download filename using the original name
      const originalBase = path.parse(req.file.originalname).name;
      const downloadName = `${originalBase}.${conv.targetExt}`;

      res.download(convertedPath, downloadName, (err) => {
        // Clean up converted file after download
        try { if (convertedPath && fs.existsSync(convertedPath)) fs.unlinkSync(convertedPath); } catch (_) {}
        if (err && !res.headersSent) {
          res.status(500).json({ error: "Download failed" });
        }
      });
    });

  } catch (err) {
    console.error("Server error:", err);
    try { if (inputPath && fs.existsSync(inputPath)) fs.unlinkSync(inputPath); } catch (_) {}
    if (!res.headersSent) res.status(500).json({ error: "Server error" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`QuikConvert backend started on port ${PORT}`));
