import { Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";
import { connectToDatabase } from "../services/dbService";
import { User } from "../types/user";
import { verifySolPaymentWithAmount } from "../services/solanaService";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { RECEIVER_PUBLIC_KEY, SOLANA_ENDPOINT } from "../config";


interface UserParams {
  userId: string;
}

interface AddCreditsRequestBody {
  userId: string;
  txSignature: string;
  code: string; // Secret code to determine credits
}

// Secret code configuration (shared between frontend and backend)
const CREDIT_CODES = {
  "SECRET_CREDIT_10": 10,  // Example: "SECRET_CREDIT_10" maps to 10 credits
  "SECRET_CREDIT_50": 50,  // Example: "SECRET_CREDIT_50" maps to 50 credits
  "SECRET_CREDIT_100": 100, // Example: "SECRET_CREDIT_100" maps to 100 credits
} as const;

export const createUser = async (req: Request, res: Response) => {
  try {
    const db = await connectToDatabase();
    const user: Omit<User, "userId"> & { userId?: string } = req.body;
    if (!user.username || !user.email || !user.password) {
      console.log("Missing required fields:", { username: user.username, email: user.email, password: user.password });
      return res.status(400).json({ error: "username, email, and password are required" });
    }
    const generatedUserId = uuidv4();
    const newUser: User = {
      ...user,
      userId: generatedUserId,
    };
    console.log("Creating user:", newUser);
    const result = await db.collection("users").insertOne(newUser);
    console.log("User created, insertedId:", result.insertedId);
    res.status(201).json({ _id: result.insertedId, ...newUser });
  } catch (error) {
    console.error("Error creating user:", error);
    res.status(500).json({ error: "Failed to create user", details: error });
  }
};

export const getUser = async (req: Request<UserParams>, res: Response) => {
  try {
    const db = await connectToDatabase();
    const userId = req.params.userId;
    const user = await db.collection("users").findOne({ userId });
    if (!user) {
      res.status(404).json({ error: "User not found" });
    } else {
      res.status(200).json(user);
    }
  } catch (error) {
    console.error("Error fetching user:", error);
    res.status(500).json({ error: "Failed to fetch user" });
  }
};

export const getUserByWallet = async (req: Request<{ solanaWalletAddress: string }>, res: Response) => {
  console.log("1st getUserByWallet");
  try {
    const db = await connectToDatabase();
    console.log("DB connected successfully");
    const { solanaWalletAddress } = req.params;
    if (!solanaWalletAddress) {
      console.log("No solanaWalletAddress provided");
      return res.status(400).json({ error: "solanaWalletAddress is required" });
    }
    console.log("getUserByWallet solanaWalletAddress:", solanaWalletAddress);

    // Ensure collection exists (optional, MongoDB auto-creates on insert)
    const collections = await db.listCollections({ name: "users" }).toArray();
    console.log("Collections:", collections);

    const user = await db.collection("users").findOne({ solanaWalletAddress });
    console.log("getUserByWallet found user:", user || "null");

    res.status(200).json({
      user: user || null,
    });
  } catch (error) {
    console.error("Error fetching user by wallet:", error);
    res.status(500).json({ error: "Failed to fetch user", details: error});
  }
};

export const getAllUsers = async (req: Request, res: Response) => {
  try {
    const db = await connectToDatabase();
    const users = await db.collection("users").find().toArray();
    res.status(200).json(users);
  } catch (error) {
    console.error("Error fetching all users:", error);
    res.status(500).json({ error: "Failed to fetch users" });
  }
};

export const updateUser = async (req: Request<UserParams>, res: Response) => {
  try {
    const db = await connectToDatabase();
    const userId = req.params.userId;
    const updatedUser: Partial<User> = req.body;
    if ("username" in updatedUser && !updatedUser.username) {
      res.status(400).json({ error: "username cannot be empty" });
    } else if ("email" in updatedUser && !updatedUser.email) {
      res.status(400).json({ error: "email cannot be empty" });
    } else if ("password" in updatedUser && !updatedUser.password) {
      res.status(400).json({ error: "password cannot be empty" });
    } else {
      const result = await db.collection("users").updateOne(
        { userId },
        { $set: updatedUser }
      );
      if (result.matchedCount === 0) {
        res.status(404).json({ error: "User not found" });
      } else {
        res.status(200).json({ message: "User updated" });
      }
    }
  } catch (error) {
    console.error("Error updating user:", error);
    res.status(500).json({ error: "Failed to update user" });
  }
};

export const deleteUser = async (req: Request<UserParams>, res: Response) => {
  try {
    const db = await connectToDatabase();
    const userId = req.params.userId;
    const result = await db.collection("users").deleteOne({ userId });
    if (result.deletedCount === 0) {
      res.status(404).json({ error: "User not found" });
    } else {
      res.status(200).json({ message: "User deleted" });
    }
  } catch (error) {
    console.error("Error deleting user:", error);
    res.status(500).json({ error: "Failed to delete user" });
  }
};

export const deleteAllUsers = async (req: Request, res: Response) => {
  try {
    const db = await connectToDatabase();
    await db.collection("users").deleteMany({});
    res.status(200).json({ message: "All users deleted" });
  } catch (error) {
    console.error("Error deleting all users:", error);
    res.status(500).json({ error: "Failed to delete all users" });
  }
};

export const getAgentCount = async (req: Request<UserParams>, res: Response) => {
  try {
    console.log("1st getAgentCount");
    const db = await connectToDatabase();
    const userId = req.params.userId;
    console.log("getAgentCount userId: ", userId);
    const count = await db.collection("agents").countDocuments({ createdBy: userId });
    console.log("2nd getAgentCount count: ", count);
    res.status(200).json({ count });
  } catch (error) {
    console.error("Error fetching agent count:", error);
    res.status(500).json({ error: "Failed to fetch agent count" });
  }
};

export const addUserCredits = async (req: Request<{}, {}, AddCreditsRequestBody>, res: Response) => {
  console.log("1st addUserCredits");
  try {
    const db = await connectToDatabase();
    const { userId, txSignature, code } = req.body;

    console.log("addUserCredits request:", { userId, txSignature, code });

    // Validate input
    if (!userId || typeof userId !== "string" || userId.trim() === "") {
      res.status(400).json({ error: "userId is required and must be a non-empty string" });
      return;
    }
    if (!txSignature || typeof txSignature !== "string" || txSignature.trim() === "") {
      res.status(400).json({ error: "txSignature is required and must be a non-empty string" });
      return;
    }
    if (!code || typeof code !== "string" || !(code in CREDIT_CODES)) {
      res.status(400).json({ error: "Invalid or missing code" });
      return;
    }

    // Fetch user
    const user = (await db.collection("users").findOne({ userId })) as User | null;
    if (!user || !user.solanaWalletAddress) {
      res.status(400).json({ error: "User not found or no Solana wallet address associated" });
      return;
    }

    // Determine required SOL amount based on credit code
    const CREDIT_PRICES = {
      "SECRET_CREDIT_10": 0.05 * LAMPORTS_PER_SOL,
      "SECRET_CREDIT_50": 0.2 * LAMPORTS_PER_SOL,
      "SECRET_CREDIT_100": 0.5 * LAMPORTS_PER_SOL,
    } as const;

    const requiredSolAmount = CREDIT_PRICES[code as keyof typeof CREDIT_PRICES];
    
    // Verify Solana payment with dynamic amount
    const paymentValid = await verifySolPaymentWithAmount(txSignature, user.solanaWalletAddress, requiredSolAmount);
    if (!paymentValid) {
      res.status(400).json({ 
        error: `Transaction does not contain valid SOL transfer of ${requiredSolAmount / LAMPORTS_PER_SOL} SOL to receiver ${RECEIVER_PUBLIC_KEY}` 
      });
      return;
    }

    // Determine credits to add based on secret code
    const creditsToAdd = CREDIT_CODES[code as keyof typeof CREDIT_CODES];

    // Update user credits
    const result = await db.collection("users").updateOne(
      { userId },
      { $inc: { credit: creditsToAdd } }
    );

    if (result.matchedCount === 0) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    // Fetch updated user
    const updatedUser = (await db.collection("users").findOne({ userId })) as User | null;
    console.log("Updated user credits:", updatedUser?.credit);

    res.status(200).json({ 
      message: "Credits added successfully", 
      newCreditBalance: updatedUser?.credit 
    });
  } catch (error) {
    console.error("Error adding user credits:", error);
    res.status(500).json({ error: "Failed to add credits" });
  }
};