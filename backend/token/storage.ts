import { Bucket } from "encore.dev/storage/objects";

export const storage = new Bucket("token-assets", {
  public: true,
});
