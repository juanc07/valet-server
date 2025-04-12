import { ObjectId } from "mongodb";

export interface Task {
  _id?: ObjectId;
  task_id: string;
  channel_id: string;
  channel_user_id: string;
  unified_user_id?: string;
  temporary_user_id?: string;
  command: string;
  status: "pending" | "in_progress" | "awaiting_external" | "completed" | "failed";
  created_at: Date;
  completed_at?: Date | null;
  agent_id: string;
  result?: string;
  task_type?: "chat" | "api_call" | "blockchain_tx" | "mcp_action";
  external_service?: {
    service_name: string;
    request_data?: any;
    response_data?: any;
    status?: "pending" | "success" | "failed";
    error?: string;
    api_key?: string; // Standard key field
  };
  retries?: number;
  max_retries?: number;
  notified?: boolean; // New field to track notification status
}