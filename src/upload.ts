import "dotenv/config";
import OSS from "ali-oss";

import { config } from "./config.js";

export const store = new OSS({
  accessKeyId: process.env.ACCESS_KEY_ID!,
  accessKeySecret: process.env.ACCESS_KEY_SECRET!,
  bucket: process.env.OSS_BUCKET!,
  region: process.env.OSS_REGION!,
  timeout: config.upload.timeoutMs,
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

export const deleteObjectsByOriginId = async (originId: string) => {
  const prefixes = [`clips/${originId}/`, `animations/${originId}/`];
  const deletedKeys: string[] = [];

  for (const prefix of prefixes) {
    let continuationToken: string | undefined;

    do {
      const result = await store.list(
        {
          prefix,
          "max-keys": 1000,
          marker: continuationToken,
        },
        {},
      );

      const objects = result.objects || [];
      if (objects.length > 0) {
        const keys = objects.map((obj) => obj.name);

        // Delete in batches (OSS supports up to 1000 objects per deleteMulti call)
        await store.deleteMulti(keys, { quiet: true });
        deletedKeys.push(...keys);
      }

      continuationToken = result.nextMarker;
    } while (continuationToken);
  }

  return deletedKeys;
};
