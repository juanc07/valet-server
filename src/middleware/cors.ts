import cors from "cors";
import { FRONTEND_URL } from "../config";

console.log("CORS FRONTEND_URL:", FRONTEND_URL); // Debug

const corsOptions: cors.CorsOptions = {
  origin: (origin, callback) => {
    const allowedOrigins = [
      FRONTEND_URL,
      "http://localhost:3001",
      "http://localhost:5173",
      "http://localhost:5174",
      "http://localhost:3000",
    ];
    console.log("CORS Origin:", origin, "Allowed:", allowedOrigins); // Debug
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.log(`CORS rejected origin: ${origin}`);
      callback(new Error("Not allowed by CORS"));
    }
  },
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Accept"],
  credentials: true,
};

export default cors(corsOptions);
