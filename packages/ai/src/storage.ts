import {
  S3Client,
  CreateBucketCommand,
  HeadBucketCommand,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
export const s3 = new S3Client({
  endpoint: process.env.S3_ENDPOINT || 'http://localhost:9000',
  region: process.env.S3_REGION || 'us-east-1',
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY || 'paperlens',
    secretAccessKey: process.env.S3_SECRET_KEY || 'paperlens-local-secret',
  },
});
export const bucket = process.env.S3_BUCKET || 'paperlens';
export async function ensureBucket() {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: bucket }));
  } catch (e) {
    if ((e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode !== 404)
      throw e;
    await s3.send(new CreateBucketCommand({ Bucket: bucket }));
  }
}
export const storePdf = (key: string, body: Uint8Array) =>
  s3.send(
    new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: 'application/pdf' }),
  );
export async function readPdf(key: string) {
  const r = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (!r.Body) throw new Error('Original PDF unavailable');
  return r.Body.transformToByteArray();
}
export const deletePdf = (key: string) =>
  s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
