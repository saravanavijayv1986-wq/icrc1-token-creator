import { SQLDatabase } from "encore.dev/storage/sqldb";

export const analyticsDB = new SQLDatabase("analytics", {
  migrations: "./migrations",
});
