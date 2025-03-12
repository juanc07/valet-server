// src/controllers/imageController.ts
import { Request, Response, NextFunction } from "express";
import { v2 as cloudinary } from "cloudinary";
import { connectToDatabase } from "../services/dbService";

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Extend Request type to include Multer's file
interface MulterRequest extends Request<{ agentId: string }> {
  file?: Express.Multer.File;
}

export const uploadProfileImage = async (
  req: MulterRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const db = await connectToDatabase();
    const agentId = req.params.agentId;

    const agent = await db.collection("agents").findOne({ agentId });
    if (!agent) {
      res.status(404).json({ error: "Agent not found" });
      return;
    }

    if (!req.file) {
      res.status(400).json({ error: "No image file provided" });
      return;
    }

    // Check if an existing profile image exists and delete it
    if (agent.profileImageId) {
      try {
        await cloudinary.uploader.destroy(agent.profileImageId);
        console.log(`Deleted old profile image with ID: ${agent.profileImageId}`);
      } catch (deleteError) {
        console.error("Error deleting old profile image:", deleteError);
        // Optionally, you could fail the request here if deletion is critical
        // res.status(500).json({ error: "Failed to delete old profile image" });
        // return;
      }
    }

    // Upload the new image
    const result = await cloudinary.uploader.upload(req.file.path, {
      folder: "agent_profile_images",
      public_id: `agent_${agentId}_${Date.now()}`,
      overwrite: true, // This won't affect existing images since public_id is unique
    });

    // Update the agent's profileImageId
    await db.collection("agents").updateOne(
      { agentId },
      { $set: { profileImageId: result.public_id } }
    );

    res.status(200).json({
      message: "Profile image uploaded successfully",
      profileImageId: result.public_id,
      url: result.secure_url,
    });
  } catch (error) {
    console.error("Error uploading profile image:", error);
    res.status(500).json({ error: "Failed to upload profile image" });
  }
};

export const getProfileImage = async (
  req: Request<{ agentId: string }>,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const db = await connectToDatabase();
    const agentId = req.params.agentId;

    const agent = await db.collection("agents").findOne({ agentId });
    if (!agent) {
      res.status(404).json({ error: "Agent not found" });
      return;
    }

    if (!agent.profileImageId) {
      res.status(404).json({ error: "No profile image found for this agent" });
      return;
    }

    const imageUrl = cloudinary.url(agent.profileImageId, {
      secure: true,
      transformation: [{ width: 200, height: 200, crop: "fill" }],
    });

    res.status(200).json({ profileImageId: agent.profileImageId, url: imageUrl });
  } catch (error) {
    console.error("Error fetching profile image:", error);
    res.status(500).json({ error: "Failed to fetch profile image" });
  }
};

export const deleteProfileImage = async (
  req: Request<{ agentId: string }>,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const db = await connectToDatabase();
    const agentId = req.params.agentId;

    const agent = await db.collection("agents").findOne({ agentId });
    if (!agent) {
      res.status(404).json({ error: "Agent not found" });
      return;
    }

    if (!agent.profileImageId) {
      res.status(404).json({ error: "No profile image to delete" });
      return;
    }

    await cloudinary.uploader.destroy(agent.profileImageId);

    await db.collection("agents").updateOne(
      { agentId },
      { $unset: { profileImageId: "" } }
    );

    res.status(200).json({ message: "Profile image deleted successfully" });
  } catch (error) {
    console.error("Error deleting profile image:", error);
    res.status(500).json({ error: "Failed to delete profile image" });
  }
};