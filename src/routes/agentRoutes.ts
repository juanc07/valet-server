import { Router, Request, Response } from "express";
import * as agentController from "../controllers/agentController";
import { runTwitterServiceTests } from "../services/twitterServiceTest"; // Import the test function

const router = Router();

// Test Endpoint for Twitter Service (moved up)
router.get("/test-twitter-service", agentController.testTwitterService);
router.get("/test-twitter-api-service", agentController.testTwitterApiService);

// Agent CRUD Routes
router.post("/", agentController.createAgent);
router.get("/", agentController.getAllAgents);
router.get("/active", agentController.getActiveAgents);
router.get("/:agentId", agentController.getAgentById);
router.put("/:agentId", agentController.updateAgent);
router.delete("/:agentId", agentController.deleteAgent);
router.delete("/", agentController.deleteAllAgents);

export default router;