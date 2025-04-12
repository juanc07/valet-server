import { Request, Response } from "express";
import { connectToDatabase } from "../services/dbService";
import { Task } from "../types/task";

export async function saveTask(task: Task): Promise<void> {
  const db = await connectToDatabase();
  await db.collection("tasks").insertOne(task);
}

export async function getRecentTasks(
  identifier: { unified_user_id?: string; temporary_user_id?: string; channel_user_id?: string },
  max_memory_context: number
): Promise<Task[]> {
  const db = await connectToDatabase();
  const query: any = {};
  if (identifier.unified_user_id) {
    query.unified_user_id = identifier.unified_user_id;
  } else if (identifier.temporary_user_id) {
    query.temporary_user_id = identifier.temporary_user_id;
  } else {
    query.channel_user_id = identifier.channel_user_id;
  }

  const tasks = await db.collection("tasks")
    .find(query)
    .sort({ created_at: -1 })
    .limit(max_memory_context)
    .toArray();

  return tasks.map((task: any) => ({
    task_id: task.task_id,
    channel_id: task.channel_id,
    channel_user_id: task.channel_user_id,
    unified_user_id: task.unified_user_id,
    temporary_user_id: task.temporary_user_id,
    command: task.command,
    status: task.status,
    result: task.result,
    created_at: task.created_at,
    agent_id: task.agent_id,
    task_type: task.task_type,
    external_service: task.external_service,
    retries: task.retries,
    max_retries: task.max_retries,
  })) as Task[];
}

export async function updateTask(task_id: string, update: Partial<Task>): Promise<void> {
  const db = await connectToDatabase();
  await db.collection("tasks").updateOne(
    { task_id },
    { $set: update }
  );
}

export async function getTaskStatus(req: Request<{ task_id: string }>, res: Response): Promise<void> {
  try {
    const db = await connectToDatabase();
    const task = await db.collection<Task>("tasks").findOne({ task_id: req.params.task_id });
    if (!task) {
      res.status(404).json({ error: "Task not found" });
      return;
    }
    // Modified: Return full task object instead of subset to include external_service and result for image handling
    res.status(200).json(task);
  } catch (error) {
    console.error(`Error fetching task status for task ${req.params.task_id}:`, error);
    res.status(500).json({ error: "Failed to fetch task status" });
  }
}