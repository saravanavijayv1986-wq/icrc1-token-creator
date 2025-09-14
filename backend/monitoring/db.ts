import { SQLDatabase } from "encore.dev/storage/sqldb";

export const monitoringDB = new SQLDatabase("monitoring", {
  migrations: "./migrations",
});
