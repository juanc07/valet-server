import { Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";
import { connectToDatabase } from "../services/dbService";
import { User } from "../types/user";

interface UserParams {
  userId: string;
}

export const createUser = async (req: Request, res: Response) => {
  try {
    const db = await connectToDatabase();
    const user: Omit<User, "userId"> & { userId?: string } = req.body;
    if (!user.username || !user.email || !user.password) {
      res.status(400).json({ error: "username, email, and password are required" });
    } else {
      const generatedUserId = uuidv4();
      const newUser: User = {
        ...user,
        userId: generatedUserId,
      };
      const result = await db.collection("users").insertOne(newUser);
      res.status(201).json({ _id: result.insertedId, ...newUser });
    }
  } catch (error) {
    console.error("Error creating user:", error);
    res.status(500).json({ error: "Failed to create user" });
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
    const { solanaWalletAddress } = req.params;
    console.log("getUserByWallet solanaWalletAddress: ", solanaWalletAddress);
    const user = await db.collection("users").findOne({ solanaWalletAddress });
    console.log("getUserByWallet found user: ", user);

    res.status(200).json({
      user: user || null,
    });
  } catch (error) {
    console.error("Error fetching user by wallet:", error);
    res.status(500).json({ error: "Failed to fetch user" });
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