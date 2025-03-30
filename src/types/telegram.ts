export interface TelegramMessage {
    message_id: number;
    chat: {
      id: number;
      type: string;
    };
    text?: string;
  }