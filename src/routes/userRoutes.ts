import { Router } from "express";
import * as userController from "../controllers/userController";
import * as agentController from "../controllers/agentController";

const router = Router();

router.post("/", userController.createUser);
router.get("/:userId", userController.getUser);
router.get("/by-wallet/:solanaWalletAddress", userController.getUserByWallet);
router.get("/", userController.getAllUsers);
router.get("/:userId/agents", agentController.getAgentsByUserId);
router.get("/:userId/agents/count", userController.getAgentCount);
router.get("/:userId/agents/active/count", agentController.getActiveAgentCount);
router.put("/:userId", userController.updateUser);
router.delete("/:userId", userController.deleteUser);
router.delete("/", userController.deleteAllUsers);

export default router;