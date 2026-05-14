const express = require("express");
const cors = require("cors");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const libre = require("libreoffice-convert");

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

        const inputPath = req.file.path;

        const ext = path.extname(req.file.originalname);

        let outputExt = ".pdf";

        if (ext === ".pdf") {
            outputExt = ".docx";
        }

        const file = fs.readFileSync(inputPath);

        libre.convert(file, outputExt, undefined, (err, done) => {

            if (err) {

                console.log(err);

                return res.status(500).json({
                    error: "Conversion failed"
                });
            }

            const outputFile = `converted${outputExt}`;

            fs.writeFileSync(outputFile, done);

            res.download(outputFile, () => {

                fs.unlinkSync(inputPath);

                fs.unlinkSync(outputFile);

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
