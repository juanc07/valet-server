// src/routes/taskRoutes.ts
import { Router } from "express";
import { getTaskStatus } from "../controllers/taskController";

const router = Router();

// Get task status by task_id
router.get("/:task_id/status", getTaskStatus);

export default router;