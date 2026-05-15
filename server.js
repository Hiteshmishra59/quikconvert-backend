const express = require("express");
const cors = require("cors");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { exec } = require("child_process");

const app = express();

app.use(cors());

const upload = multer({
    dest: "uploads/"
});

app.get("/", (req, res) => {
    res.send("Backend running");
});

app.post("/api/convert", upload.single("file"), async (req, res) => {

    try {

        if (!req.file) {
            return res.status(400).json({
                error: "No file uploaded"
            });
        }

        const tempPath = req.file.path;

        const inputPath =
          tempPath + path.extname(req.file.originalname);

        fs.renameSync(tempPath, inputPath);

        const ext =
          path.extname(req.file.originalname).toLowerCase();

        let targetFormat = "pdf";

        if (ext === ".pdf") {
            targetFormat = "docx";
        }

        const outputDir =
          path.join(__dirname, "converted");

        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir);
        }

        const command =
          `libreoffice --headless --convert-to ${targetFormat} "${inputPath}" --outdir "${outputDir}"`;

        exec(command, (error, stdout, stderr) => {

            console.log(stdout);
            console.log(stderr);

            if (error) {

                console.log(error);

                return res.status(500).json({
                    error: "Conversion failed"
                });
            }

           const originalBaseName =
  path.parse(req.file.originalname).name;

const convertedPath =
  path.join(
    outputDir,
    `${originalBaseName}.${targetFormat}`
  );

if (!fs.existsSync(convertedPath)) {

    return res.status(500).json({
        error: "No converted file found"
    });
}

return res.download(convertedPath, () => {

    fs.unlinkSync(inputPath);

    fs.unlinkSync(convertedPath);

});

        });

    } catch (err) {

        console.log(err);

        res.status(500).json({
            error: "Server error"
        });

    }

});

app.listen(3000, () => {
    console.log("Server started");
});
