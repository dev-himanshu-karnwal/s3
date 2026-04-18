import { config } from "dotenv";
config();
import cors from "cors";
import express from "express";
import mongoose from "mongoose";
import multer from "multer";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { v4 as uuidv4 } from "uuid";

const S3_CLIENT = new S3Client({
  region: 'ap-south-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const MONGODB_URI =
  process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/appdb";

const MAX_IMAGE_BYTES = 15 * 1024 * 1024; // 15MB

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_BYTES },
  fileFilter(_req, file, cb) {
    if (file.mimetype.startsWith("image/")) {
      cb(null, true);
    } else {
      cb(new Error("Only image files are allowed"));
    }
  },
});

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

const imageUploadSchema = new mongoose.Schema(
  {
    originalName: { type: String, required: true },
    mimeType: { type: String, required: true },
    size: { type: Number, required: true, min: 0 },
    /** Set when bytes are stored in cloud/object storage */
    storageUrl: { type: String, default: null },
  },
  { timestamps: true },
);
const ImageUpload = mongoose.model("ImageUpload", imageUploadSchema);

app.get("/health", (_req, res) => {
  const db =
    mongoose.connection.readyState === 1 ? "connected" : "disconnected";
  res.json({ ok: true, db });
});

app.get("/api/uploads", async (_req, res, next) => {
  try {
    const uploads = await ImageUpload.find()
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();
    res.json(uploads);
  } catch (err) {
    next(err);
  }
});

app.get("/api/presigned-url", async (req, res, next) => {
  try {
    const key = uuidv4();

    const command = new PutObjectCommand({
      Bucket: process.env.AWS_BUCKET_NAME,
      Key: key,
    });

    const signedUrl = await getSignedUrl(S3_CLIENT, command, {
      expiresIn: 3600, // 1 hour
    });

    res.json({ signedUrl, key });
  }
  catch (err) {
    next(err);
  }
});

app.post("/api/uploads", (req, res, next) => {
  upload.single("image")(req, res, async (err) => {
    if (err) {
      next(err);
      return;
    }
    try {
      const file = req.file;
      if (!file) {
        res
          .status(400)
          .json({ error: "image file is required (field name: image)" });
        return;
      }
      const doc = await ImageUpload.create({
        originalName: file.originalname,
        mimeType: file.mimetype,
        size: file.size,
      });
      res.status(201).json(doc);
    } catch (e) {
      next(e);
    }
  });
});

app.use((err, _req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      res.status(400).json({
        error: `Image must be at most ${MAX_IMAGE_BYTES} bytes`,
      });
      return;
    }
    res.status(400).json({ error: err.message });
    return;
  }
  if (err?.message === "Only image files are allowed") {
    res.status(400).json({ error: err.message });
    return;
  }
  next(err);
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

async function main() {
  await mongoose.connect(MONGODB_URI);
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`API listening on http://0.0.0.0:${PORT}`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
