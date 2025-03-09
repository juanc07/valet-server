import { Router, Request, Response } from "express";
import { initiateTwitterOAuth, completeTwitterOAuth,postTweetManually} from "../controllers/twitterController";

const router = Router();

// Twitter-Specific Routes
router.post("/:agentId/tweet", postTweetManually);

// Twitter OAuth Routes
router.post("/oauth/request", initiateTwitterOAuth);
router.get("/oauth/callback", completeTwitterOAuth);

// Test Route for Session
router.get("/test-session", (req: Request, res: Response) => {
  const session = req.session as typeof req.session & {
    oauthToken?: string;
    oauthTokenSecret?: string;
    agentId?: string;
    test?: string;
  };
  session.test = "Session is working!";
  res.json({ message: session.test, sessionId: req.sessionID });
});

export default router;