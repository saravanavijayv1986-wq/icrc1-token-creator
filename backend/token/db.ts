import { SQLDatabase } from "encore.dev/storage/sqldb";

export const tokenDB = new SQLDatabase("token", {
  migrations: "./migrations",
});
