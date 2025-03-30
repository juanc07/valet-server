import { Router, Request, Response } from 'express';
import TelegramBot from 'node-telegram-bot-api';
import { connectToDatabase } from '../services/dbService';

// Define the request body interface
interface TelegramRequestBody {
  chatId: string;
  message: string;
}

const router = Router();

// Explicitly type the handler
router.post('/:agentId/send', async (
  req: Request<{ agentId: string }, any, TelegramRequestBody>,
  res: Response
): Promise<void> => {
  try {
    const db = await connectToDatabase();
    const agentId = req.params.agentId;
    const { chatId, message } = req.body;

    if (!chatId || !message) {
      res.status(400).json({ error: 'chatId and message are required' });
      return;
    }

    const agent = await db.collection('agents').findOne({ agentId });
    if (!agent || !agent.telegramBotToken) {
      res.status(404).json({ error: 'Agent not found or no Telegram token' });
      return;
    }

    const bot = new TelegramBot(agent.telegramBotToken);
    await bot.sendMessage(chatId, message);
    res.status(200).json({ message: 'Message sent to Telegram' });
  } catch (error) {
    console.error(`Error sending Telegram message for agent ${req.params.agentId}:`, error);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

export default router;