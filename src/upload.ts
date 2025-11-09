import "dotenv/config";
import OSS from "ali-oss";

export const store = new OSS({
  accessKeyId: process.env.ACCESS_KEY_ID!,
  accessKeySecret: process.env.ACCESS_KEY_SECRET!,
  bucket: process.env.OSS_BUCKET!,
  region: process.env.OSS_REGION!,
  timeout: 120000,
});

export const uploadObject = async (objectKey: string, localPath: string) => {
  const result = await store.put(objectKey, localPath);
  return {
    objectKey,
    url: result.url ?? store.generateObjectUrl(objectKey),
    response: result.res,
  };
};

export const deleteObject = async (objectKey: string) => {
  try {
    await store.delete(objectKey);
  } catch (error) {
    // Ignore 404s; surface everything else so callers can log appropriately.
    if ((error as { statusCode?: number }).statusCode !== 404) {
      throw error;
    }
  }
};
