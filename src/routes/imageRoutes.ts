// src/routes/imageRoutes.ts
import { Router } from "express";
import * as imageController from "../controllers/imageController";
import multer from "multer";

const upload = multer({ dest: "uploads/" });

const router = Router();

router.post(
  "/:agentId/profile-image",
  upload.single("image"), // Multer middleware
  imageController.uploadProfileImage // Controller function
);

router.get("/:agentId/profile-image", imageController.getProfileImage);

router.delete("/:agentId/profile-image", imageController.deleteProfileImage);

export default router;