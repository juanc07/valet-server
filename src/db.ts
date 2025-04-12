import { MongoClient, Db, WithId } from "mongodb";
import dotenv from "dotenv";
import { TemporaryUser } from "./types/user"; // Import the new type

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

// Save a temporary user profile
export async function saveTemporaryUser(tempUser: TemporaryUser): Promise<void> {
  const db = await connectToDatabase();
  await db.collection("temporaryUsers").insertOne(tempUser);
}

// Find a temporary user by channel-specific ID
export async function findTemporaryUserByChannelId(channel: string, channel_user_id: string): Promise<TemporaryUser | null> {
  const db = await connectToDatabase();
  const result = await db.collection("temporaryUsers").findOne({ [`linked_channels.${channel}`]: channel_user_id });
  return result as TemporaryUser | null; // Cast the result to TemporaryUser | null
}

// Update a temporary user profile
export async function updateTemporaryUser(temporary_user_id: string, update: Partial<TemporaryUser>): Promise<void> {
  const db = await connectToDatabase();
  await db.collection("temporaryUsers").updateOne(
    { temporary_user_id },
    { $set: update }
  );
}

// Interface for the linking code document
interface LinkingCode {
  channel_user_id: string;
  linking_code: string;
  expires_at: Date;
}

// Save a linking code
export async function saveLinkingCode(channel_user_id: string, linking_code: string, expires_at: Date): Promise<void> {
  const db = await connectToDatabase();
  await db.collection("linkingCodes").insertOne({
    channel_user_id,
    linking_code,
    expires_at,
  });
}

// Find a linking code
export async function findLinkingCode(linking_code: string): Promise<{ channel_user_id: string; expires_at: Date } | null> {
  const db = await connectToDatabase();
  const result = await db.collection("linkingCodes").findOne({ linking_code }) as WithId<LinkingCode> | null;
  if (!result) return null;
  return {
    channel_user_id: result.channel_user_id,
    expires_at: result.expires_at,
  };
}

// Delete a linking code
export async function deleteLinkingCode(linking_code: string): Promise<void> {
  const db = await connectToDatabase();
  await db.collection("linkingCodes").deleteOne({ linking_code });
}