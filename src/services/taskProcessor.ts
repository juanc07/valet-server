import { connectToDatabase } from "./dbService";
import { Task } from "../types/task";
import { processExternalTask } from "./externalServiceHandler";

export async function startTaskProcessor(): Promise<void> {
  const db = await connectToDatabase();
  console.log("Task processor started");

  setInterval(async () => {
    try {
      // Only pick up tasks that are in "pending" state to avoid reprocessing
      const tasks = await db.collection<Task>("tasks").find({
        status: "pending", // Only process "pending" tasks
      }).toArray();

      console.log(`Found ${tasks.length} tasks to process`);

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
                  notified: false, // Ensure failed tasks can be notified
                },
              }
            );
            console.log(`Task ${task.task_id} failed: Max retries exceeded`);
            continue;
          }

          console.log(`Processing task ${task.task_id}: type=${task.task_type}, status=${task.status}`);
          await processTask(task);
        } catch (error) {
          console.error(`Error processing task ${task.task_id}:`, error);
          await db.collection<Task>("tasks").updateOne(
            { task_id: task.task_id },
            {
              $set: {
                status: "failed",
                "external_service.error": error instanceof Error ? error.message : "Unknown error",
                notified: false, // Ensure failed tasks can be notified
              },
              $inc: { retries: 1 },
            }
          );
          console.log(`Marked task ${task.task_id} as failed with retries=${(task.retries ?? 0) + 1}`);
        }
      }
    } catch (error) {
      console.error("Error in task processor polling:", error);
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
    console.log(`Updated task ${task.task_id} to in_progress`);
  }

  if (task.task_type === "chat") {
    await db.collection<Task>("tasks").updateOne(
      { task_id: task.task_id },
      { $set: { status: "completed", completed_at: new Date(), notified: false } }
    );
    console.log(`Completed chat task ${task.task_id}`);
  } else if (["api_call", "blockchain_tx", "mcp_action"].includes(task.task_type || "")) {
    await db.collection<Task>("tasks").updateOne(
      { task_id: task.task_id },
      { $set: { status: "awaiting_external" } }
    );
    console.log(`Updated task ${task.task_id} to awaiting_external`);

    const result = await processExternalTask(task);
    console.log(`External task ${task.task_id} result: success=${result.success}, data=${result.data}, error=${result.error}`);

    if (result.success) {
      if (task.external_service?.service_name === "image_generation") {
        if (!result.data || !isValidImageUrl(result.data)) {
          await db.collection<Task>("tasks").updateOne(
            { task_id: task.task_id },
            {
              $set: {
                status: "failed",
                "external_service.response_data": result.data,
                "external_service.status": "failed",
                "external_service.error": "Invalid image URL",
                notified: false, // Ensure failed tasks can be notified
              },
              $inc: { retries: 1 },
            }
          );
          console.log(`Failed task ${task.task_id}: Invalid image URL`);
          return;
        }
      }

      await db.collection<Task>("tasks").updateOne(
        { task_id: task.task_id },
        {
          $set: {
            status: "completed",
            result: result.data,
            completed_at: new Date(),
            "external_service.response_data": result.data,
            "external_service.status": "success",
            notified: false, // Mark as not notified
          },
        }
      );
      console.log(`Completed task ${task.task_id} with result: ${result.data}`);
    } else {
      await db.collection<Task>("tasks").updateOne(
        { task_id: task.task_id },
        {
          $set: {
            status: "failed",
            "external_service.response_data": result.data,
            "external_service.status": "failed",
            "external_service.error": result.error || "Unknown error",
            notified: false, // Ensure failed tasks can be notified
          },
          $inc: { retries: 1 },
        }
      );
      console.log(`Failed task ${task.task_id} with error: ${result.error}`);
    }
  }
}

function isValidImageUrl(url: string): boolean {
  try {
    const urlObj = new URL(url);
    // Split the pathname to ignore query parameters
    const pathname = urlObj.pathname;
    const isValid = /\.(jpg|jpeg|png|gif|bmp)$/i.test(pathname);
    console.log(`Validated image URL ${url}: isValid=${isValid}, pathname=${pathname}`);
    return isValid;
  } catch (error) {
    console.error(`Invalid image URL ${url}:`, error);
    return false;
  }
}