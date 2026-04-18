import { config } from "dotenv";
config();
import cors from "cors";
import express from "express";
import mongoose from "mongoose";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { v4 as uuidv4, validate as uuidValidate } from "uuid";

const AWS_REGION = process.env.AWS_REGION || "ap-south-1";

const S3_CLIENT = new S3Client({
  region: AWS_REGION,
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
    const raw =
      typeof req.query.contentType === "string" ? req.query.contentType : "";
    const contentType = raw.startsWith("image/") ? raw.split("/")[1] : undefined;
    const key = uuidv4() + "." + contentType;

    const command = new PutObjectCommand({
      Bucket: process.env.AWS_BUCKET_NAME,
      Key: key,
    });

    const signedUrl = await getSignedUrl(S3_CLIENT, command, {
      expiresIn: 60, // 1 minute
    });

    res.json({ signedUrl, key });
  } catch (err) {
    next(err);
  }
});

/** After browser PUTs the object to S3 using the presigned URL, persist metadata + public URL. */
app.post("/api/uploads/complete", async (req, res, next) => {
  try {
    const { key, originalName, mimeType, size } = req.body ?? {};
    if (!key || typeof key !== "string" || !uuidValidate(key.split(".")[0])) {
      res.status(400).json({ error: "key must be a valid UUID object key" });
      return;
    }
    if (
      !originalName ||
      typeof originalName !== "string" ||
      typeof mimeType !== "string" ||
      typeof size !== "number" ||
      !Number.isFinite(size) ||
      size < 0
    ) {
      res
        .status(400)
        .json({ error: "originalName, mimeType, and size are required" });
      return;
    }
    if (!mimeType.startsWith("image/")) {
      res.status(400).json({ error: "Only image mime types are allowed" });
      return;
    }
    if (size > MAX_IMAGE_BYTES) {
      res.status(400).json({
        error: `Image must be at most ${MAX_IMAGE_BYTES} bytes`,
      });
      return;
    }
    const bucket = process.env.AWS_BUCKET_NAME;
    if (!bucket) {
      res.status(500).json({ error: "Bucket not configured" });
      return;
    }
    const storageUrl = key;
    const doc = await ImageUpload.create({
      originalName: originalName.slice(0, 500),
      mimeType: mimeType.split("/")[1] || mimeType,
      size,
      storageUrl,
    });
    res.status(201).json(doc);
  } catch (err) {
    next(err);
  }
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
