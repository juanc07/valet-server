import { MongoClient, Db } from "mongodb";
import dotenv from "dotenv";

dotenv.config();

const uri = process.env.MONGODB_URI as string;
let db: Db;

export async function connectToDatabase(): Promise<Db> {
  if (db) return db;

  const client = new MongoClient(uri);
  await client.connect();
  db = client.db("valet-db");
  console.log("Connected to MongoDB");
  return db;
}