import { createS3PresignedUpload } from "../src/lib/s3Presign";

function getS3Config() {
  const bucket = process.env.S3_BUCKET_NAME ?? "grk-outputs";
  const region = process.env.S3_REGION ?? "ap-south-1";
  const accessKeyId = process.env.S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
  const sessionToken = process.env.S3_SESSION_TOKEN;
  const objectPrefix = process.env.S3_OBJECT_PREFIX ?? "grok-video-edits";
  if (!accessKeyId || !secretAccessKey) {
    throw new Error("Missing S3 credentials");
  }
  return { bucket, region, accessKeyId, secretAccessKey, sessionToken, objectPrefix };
}

export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const fileName = typeof (payload as { fileName?: unknown }).fileName === "string"
      ? (payload as { fileName: string }).fileName
      : "";
    const contentType = typeof (payload as { contentType?: unknown }).contentType === "string"
      ? (payload as { contentType: string }).contentType
      : "video/mp4";

    if (!fileName) {
      return new Response(JSON.stringify({ error: "fileName is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (!contentType.startsWith("video/")) {
      return new Response(JSON.stringify({ error: "contentType must be a video MIME type" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    try {
      const presigned = await createS3PresignedUpload({
        ...getS3Config(),
        fileName,
        contentType,
      });

      return new Response(JSON.stringify(presigned), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    } catch (err) {
      return new Response(
        JSON.stringify({ error: err instanceof Error ? err.message : "Failed to create presigned URL" }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }
      );
    }
  },
};
