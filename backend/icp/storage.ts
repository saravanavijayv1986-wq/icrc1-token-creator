import { Bucket } from "encore.dev/storage/objects";

export const storage = new Bucket("icp-artifacts", {
  public: false,
  versioned: true,
});
