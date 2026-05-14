const express = require("express");
const cors = require("cors");
const multer = require("multer");

const app = express();

app.use(cors());

const upload = multer({
    dest: "uploads/"
});

app.get("/", (req, res) => {
    res.send("Backend running");
});

app.post("/api/convert", upload.single("file"), async (req, res) => {

    console.log(req.file);

    if (!req.file) {
        return res.status(400).json({
            error: "No file uploaded"
        });
    }

    res.json({
        success: true
    });

});

app.listen(3000, () => {
    console.log("Server started");
});