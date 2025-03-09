import { Router } from "express";
import * as chatController from "../controllers/chatController";

const router = Router();

router.post("/:agentId", chatController.chatWithAgent);
router.post("/stream/:agentId", chatController.chatWithAgentStream);

export default router;