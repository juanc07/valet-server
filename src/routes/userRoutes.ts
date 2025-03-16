import { Router, RequestHandler, Request, Response } from "express";
import * as userController from "../controllers/userController";
import * as agentController from "../controllers/agentController";

const router = Router();

// Define param interfaces
interface UserParams {
  userId: string;
}

interface WalletParams {
  solanaWalletAddress: string;
}

// Type-safe handler assertions
router.post("/", userController.createUser as RequestHandler);
router.get("/:userId", userController.getUser as RequestHandler<UserParams, any, any, any>);
router.get("/by-wallet/:solanaWalletAddress", userController.getUserByWallet as RequestHandler<WalletParams, any, any, any>);
router.get("/", userController.getAllUsers as RequestHandler);
router.get("/:userId/agents", agentController.getAgentsByUserId as RequestHandler<UserParams, any, any, any>);
router.get("/:userId/agents/count", userController.getAgentCount as RequestHandler<UserParams, any, any, any>);
router.get("/:userId/agents/active/count", agentController.getActiveAgentCount as RequestHandler<UserParams, any, any, any>);
router.put("/:userId", userController.updateUser as RequestHandler<UserParams, any, any, any>);
router.delete("/:userId", userController.deleteUser as RequestHandler<UserParams, any, any, any>);
router.delete("/", userController.deleteAllUsers as RequestHandler);
router.post("/credits", userController.addUserCredits as RequestHandler);

export default router;