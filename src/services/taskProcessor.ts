// src/services/taskProcessor.ts
import { connectToDatabase } from "./dbService";
import { Task } from "../types/task";
import { processExternalTask } from "./externalServiceHandler";

export async function startTaskProcessor(): Promise<void> {
  const db = await connectToDatabase();
  console.log("Task processor started");

  setInterval(async () => {
    const tasks = await db.collection<Task>("tasks").find({
      status: { $in: ["pending", "awaiting_external"] },
    }).toArray();

    for (const task of tasks) {
      try {
        // Skip tasks that have exceeded max retries
        const effectiveMaxRetries = task.max_retries ?? 3;
        const currentRetries = task.retries ?? 0;
        if (currentRetries >= effectiveMaxRetries) {
          await db.collection<Task>("tasks").updateOne(
            { task_id: task.task_id },
            {
              $set: {
                status: "failed",
                "external_service.error": "Max retries exceeded",
              },
            }
          );
          console.log(`Task ${task.task_id} failed: Max retries exceeded`);
          continue;
        }

        await processTask(task);
      } catch (error) {
        console.error(`Error processing task ${task.task_id}:`, error);
        await db.collection<Task>("tasks").updateOne(
          { task_id: task.task_id },
          {
            $set: {
              status: "failed",
              "external_service.error": error instanceof Error ? error.message : "Unknown error",
            },
            $inc: { retries: 1 },
          }
        );
      }
    }
  }, 5000); // Poll every 5 seconds
}

async function processTask(task: Task): Promise<void> {
  const db = await connectToDatabase();

  if (task.status === "pending") {
    await db.collection<Task>("tasks").updateOne(
      { task_id: task.task_id },
      { $set: { status: "in_progress" } }
    );
  }

  if (task.task_type === "chat") {
    await db.collection<Task>("tasks").updateOne(
      { task_id: task.task_id },
      { $set: { status: "completed", completed_at: new Date() } }
    );
  } else if (["api_call", "blockchain_tx", "mcp_action"].includes(task.task_type || "")) {
    await db.collection<Task>("tasks").updateOne(
      { task_id: task.task_id },
      { $set: { status: "awaiting_external" } }
    );

    const result = await processExternalTask(task);

    await db.collection<Task>("tasks").updateOne(
      { task_id: task.task_id },
      {
        $set: {
          status: result.success ? "completed" : "failed",
          result: result.success ? result.data : undefined,
          completed_at: result.success ? new Date() : undefined,
          "external_service.response_data": result.data,
          "external_service.status": result.success ? "success" : "failed",
          "external_service.error": result.error,
        },
        $inc: { retries: result.success ? 0 : 1 },
      }
    );
  }
}