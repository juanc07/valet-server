import { Router, Request, Response } from "express";
import * as agentController from "../controllers/agentController";

const router = Router();

// Agent CRUD Routes
router.post("/", agentController.createAgent);
router.get("/", agentController.getAllAgents);
router.get("/active", agentController.getActiveAgents);
router.get("/:agentId", agentController.getAgentById);
router.put("/:agentId", agentController.updateAgent);
router.delete("/:agentId", agentController.deleteAgent);
router.delete("/", agentController.deleteAllAgents);

export default router;